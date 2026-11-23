import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  IssueAutomationPlatformKind,
  ProjectId,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import {
  extractZenTaoImageUrls,
  markdownToZenTaoHtml,
  normalizeZenTaoBaseUrl,
  sortZenTaoScopesDesc,
  zenTaoHtmlToMarkdown,
  ZenTaoSessionClient,
} from "./connectors/zentao/ZenTaoClient.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as IssueAutomation from "./IssueAutomationService.ts";
import { resolveTargetRepositories } from "./MultiRepoRouter.ts";

describe("ZenTaoClient helpers", () => {
  it("normalizes page URLs and controller suffixes to the ZenTao root", () => {
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/bug-browse.html")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/index.php")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(normalizeZenTaoBaseUrl("https://pms.example.com/api.php/v1/tokens")).toBe(
      "https://pms.example.com",
    );
    expect(normalizeZenTaoBaseUrl("zentao.example.com")).toBe("https://zentao.example.com");
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com")).toBe("https://zentao.example.com");
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com/")).toBe(
      "https://zentao.example.com",
    );
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(
      normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/bug-browse-68-0-all-0.html"),
    ).toBe("https://zentao.example.com/zentao");
    expect(
      normalizeZenTaoBaseUrl(
        "https://zentao.example.com/zentao/bug-browse-68-0-all-0.html?tid=abc#app=qa",
      ),
    ).toBe("https://zentao.example.com/zentao");
    expect(normalizeZenTaoBaseUrl("zentao.example.com/zentao/bug-browse-68-0-all-0.html")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(
      normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/user-login-L3plbnRhby8=.html"),
    ).toBe("https://zentao.example.com/zentao");
    expect(normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/my.html")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(
      normalizeZenTaoBaseUrl("https://zentao.example.com/zentao/index.php/bug-browse-68.html"),
    ).toBe("https://zentao.example.com/zentao");
    expect(normalizeZenTaoBaseUrl("//zentao.example.com/zentao/")).toBe(
      "https://zentao.example.com/zentao",
    );
    expect(normalizeZenTaoBaseUrl("192.168.1.20:8080/zentao/bug-browse.html")).toBe(
      "http://192.168.1.20:8080/zentao",
    );
  });

  it("extracts inline ZenTao image URLs and converts steps HTML to Markdown", () => {
    const html = `
      <p><strong>【重现步骤】</strong></p>
      <p>1. 打开系统设置页</p>
      <p><img onload="setImageSize(this,0)" src="/zentao/file-read-10001.png" alt="" /></p>
      <p><img src="{10002.jpg}" alt="" /></p>
    `;
    const base = "https://zentao.example.com/zentao";
    const images = extractZenTaoImageUrls(html, base);
    expect(images).toEqual([
      "https://zentao.example.com/zentao/file-read-10001.png",
      "https://zentao.example.com/zentao/file-read-10002.jpg",
    ]);

    const md = zenTaoHtmlToMarkdown(html, base);
    expect(md).toContain("**【重现步骤】**");
    expect(md).toContain("https://zentao.example.com/zentao/file-read-10001.png");
  });

  it("converts Markdown diagnosis reports into ZenTao HTML comments", () => {
    const html = markdownToZenTaoHtml(
      "## 问题根因分析\n- 位于 `OrderService.ts:42` 缺少空指针校验\n```ts\nif (!order) return;\n```",
    );
    expect(html).toContain("<strong>【问题根因分析】</strong>");
    expect(html).toContain("<code>OrderService.ts:42</code>");
    expect(html).toContain('<pre class="prettyprint">if (!order) return;</pre>');
  });

  it("sorts ZenTao product scopes by numeric ID descending so newer projects appear first", () => {
    const sorted = sortZenTaoScopesDesc([
      { id: "22", name: "Example Product A" },
      { id: "105", name: "Example Product C" },
      { id: "9", name: "Legacy Example" },
      { id: "83", name: "Example Product B" },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["105", "83", "22", "9"]);
  });
});

describe("MultiRepoRouter", () => {
  const pWeb = ProjectId.make("proj-web");
  const pApi = ProjectId.make("proj-api");
  const pWorker = ProjectId.make("proj-worker");

  const availableProjects: ReadonlyArray<OrchestrationProjectShell> = [
    {
      id: pWeb,
      title: "storefront-web",
      workspaceRoot: "/repos/storefront-web",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: pApi,
      title: "checkout-api",
      workspaceRoot: "/repos/checkout-api",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: pWorker,
      title: "billing-worker",
      workspaceRoot: "/repos/billing-worker",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("routes by explicit module/keyword rule first and preserves sibling reference repos", () => {
    const routed = resolveTargetRepositories({
      binding: {
        primaryProjectId: pApi,
        linkedProjectIds: [pWeb, pApi, pWorker],
        moduleMappings: [
          { pattern: "前端", projectId: pWeb },
          { pattern: "账单", projectId: pWorker },
        ],
      },
      availableProjects,
      moduleName: "商城前端",
      issueTitle: "【前端】多语言文案换行异常",
      stepsMarkdown: "",
    });

    expect(routed.targetProjectId).toBe(pWeb);
    expect(routed.referenceProjectIds).toEqual([pApi, pWorker]);
  });

  it("falls back to repository name match in steps/stacktrace, then primary repo", () => {
    const byHeuristic = resolveTargetRepositories({
      binding: {
        primaryProjectId: pWeb,
        linkedProjectIds: [pWeb, pApi],
        moduleMappings: [],
      },
      availableProjects,
      moduleName: null,
      issueTitle: "订单分页查询返回 500",
      stepsMarkdown: "报错日志来自 checkout-api/src/orders.ts",
    });
    expect(byHeuristic.targetProjectId).toBe(pApi);
    expect(byHeuristic.referenceProjectIds).toEqual([pWeb]);
  });
});

function jsonResponse(payload: unknown, url?: string): Response {
  const res = Response.json(payload);
  if (url) {
    Object.defineProperty(res, "url", { value: url });
  }
  return res;
}

function handleStandardZenTaoEndpoints(url: string, validBaseUrl: string): Response | null {
  if (url === `${validBaseUrl}/index.php?mode=getconfig`) {
    return jsonResponse(
      {
        version: "10.6",
        requestType: "PATH_INFO",
        requestFix: "-",
        sessionName: "zentaosid",
        sessionID: "sid-123",
        rand: 42,
      },
      url,
    );
  }
  if (url === `${validBaseUrl}/api-getSessionID.json?zentaosid=sid-123`) {
    return jsonResponse({
      status: "success",
      data: JSON.stringify({ sessionName: "zentaosid", sessionID: "sid-123", rand: 42 }),
    });
  }
  if (url === `${validBaseUrl}/user-login.json?zentaosid=sid-123`) {
    return jsonResponse({
      status: "success",
      user: { account: "alice", realname: "Alice" },
    });
  }
  if (url === `${validBaseUrl}/bug-browse.json?zentaosid=sid-123`) {
    return jsonResponse({
      status: "success",
      data: JSON.stringify({
        products: {
          "0": "",
          "68": "Core Product",
        },
      }),
    });
  }
  return null;
}

const connectorTestLayer = IssueAutomation.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Sqlite.layerMemory,
      ServerSecretStore.layer,
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(GitWorkflow.GitWorkflowService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(ThreadIssueService.ThreadIssueService)({}),
    ),
  ),
  Layer.provide(ServerConfig.layerTest(import.meta.dirname, { prefix: "t3-connector-edit-" })),
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);

it.effect("keeps the saved ZenTao instance when renaming an unavailable connector", () =>
  Effect.gen(function* () {
    const service = yield* IssueAutomation.IssueAutomationService;
    const original = "https://pms.example.com/team";
    const other = "https://pms.example.com/zentao";
    let online = original;
    using requests = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (input) =>
          handleStandardZenTaoEndpoints(String(input), online) ??
          new Response(null, { status: 404 }),
      );
    const input = {
      platform: IssueAutomationPlatformKind.make("zentao"),
      name: "Original",
      baseUrl: original,
      account: "alice",
    };
    const saved = yield* service.saveConnector({ ...input, secret: "test" });
    online = other;
    requests.mockClear();
    const edit = { ...input, id: saved.id, name: "Renamed" };
    expect((yield* Effect.result(service.saveConnector(edit)))._tag).toBe("Failure");
    expect(requests.mock.calls.map(([url]) => String(url))).toEqual([
      original + "/index.php?mode=getconfig",
    ]);
    expect((yield* service.getState).connectors).toEqual([saved]);
    const moved = yield* service.saveConnector({ ...edit, baseUrl: "https://pms.example.com" });
    expect(moved.baseUrl).toBe(other);
    expect(moved.id).toBe(saved.id);
  }).pipe(Effect.provide(connectorTestLayer)),
);

describe("ZenTaoSessionClient discovery & probe", () => {
  it.effect("discovers /zentao from the welcome HTML page across all 4 user input formats", () =>
    Effect.gen(function* () {
      const welcomeHtml = `
        <html xmlns='http://www.w3.org/1999/xhtml'>
        <head>
          <meta http-equiv='Content-Type' content='text/html; charset=utf-8' />
          <title>Welcome to use zentao!</title>
          <script>window.location.replace("/zentao");</script>
        </head>
        <body>
          <a id='zentao' href='/zentao/' class='btn'>Zentao</a>
        </body>
        </html>
      `;
      using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://zentao.example.com/index.php?mode=getconfig") {
          return new Response(welcomeHtml, {
            status: 200,
            headers: { "content-type": "text/html; charset=UTF-8" },
          });
        }
        const matched = handleStandardZenTaoEndpoints(url, "https://zentao.example.com/zentao");
        if (matched) return matched;
        return new Response("Not Found", { status: 404 });
      });

      const inputs = [
        "zentao.example.com",
        "https://zentao.example.com",
        "https://zentao.example.com/zentao/",
        "https://zentao.example.com/zentao/bug-browse-68-0-all-0.html",
      ];
      for (const baseUrl of inputs) {
        const client = new ZenTaoSessionClient();
        const probe = yield* client.probeAndListScopes(
          {
            baseUrl,
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(probe.normalizedBaseUrl).toBe("https://zentao.example.com/zentao");
        expect(probe.viewerName).toBe("Alice (alice)");
        expect(probe.serverVersion).toBe("10.6");
        expect(probe.scopes).toEqual([{ id: "68", name: "Core Product" }]);
      }
    }),
  );

  it.effect(
    "falls back to common /zentao subpath on 404 and walks ancestor paths for deep URLs",
    () =>
      Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const zentaoHit = handleStandardZenTaoEndpoints(url, "https://zentao.example.com/zentao");
          if (zentaoHit) return zentaoHit;
          const customHit = handleStandardZenTaoEndpoints(
            url,
            "https://zentao.example.com/custom-pms",
          );
          if (customHit) return customHit;
          return new Response("Not Found", { status: 404 });
        });

        const clientA = new ZenTaoSessionClient();
        const probeA = yield* clientA.probeAndListScopes(
          {
            baseUrl: "https://zentao.example.com",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(probeA.normalizedBaseUrl).toBe("https://zentao.example.com/zentao");

        const clientB = new ZenTaoSessionClient();
        const probeB = yield* clientB.probeAndListScopes(
          {
            baseUrl: "https://zentao.example.com/custom-pms/bug/browse/68",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(probeB.normalizedBaseUrl).toBe("https://zentao.example.com/custom-pms");
      }),
  );

  it.effect(
    "handles bare-domain http fallback, preserves explicit https errors, and upgrades http redirects",
    () =>
      Effect.gen(function* () {
        const requestedUrls: string[] = [];
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          requestedUrls.push(url);
          if (url.startsWith("https://zentao.example.internal")) {
            throw new TypeError("fetch failed: connection refused");
          }
          if (url.startsWith("http://zentao.example.internal")) {
            const hit = handleStandardZenTaoEndpoints(url, "http://zentao.example.internal/zentao");
            if (hit) return hit;
            return new Response("Not Found", { status: 404 });
          }
          if (url === "http://pms.example.com/zentao/index.php?mode=getconfig") {
            return Response.redirect(
              "https://pms.example.com/zentao/index.php?mode=getconfig",
              302,
            );
          }
          if (url.startsWith("https://pms.example.com/zentao/")) {
            const hit = handleStandardZenTaoEndpoints(url, "https://pms.example.com/zentao");
            if (hit) return hit;
          }
          return new Response("Not Found", { status: 404 });
        });

        const bareClient = new ZenTaoSessionClient();
        const bareProbe = yield* bareClient.probeAndListScopes(
          {
            baseUrl: "zentao.example.internal",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(bareProbe.normalizedBaseUrl).toBe("http://zentao.example.internal/zentao");

        requestedUrls.length = 0;
        const httpsClient = new ZenTaoSessionClient();
        const explicitHttpsExit = yield* Effect.exit(
          httpsClient.probeAndListScopes(
            {
              baseUrl: "https://zentao.example.internal",
              account: "alice",
              secret: "secret-pass",
            },
            "discover",
          ),
        );
        expect(explicitHttpsExit._tag).toBe("Failure");
        expect(requestedUrls.some((u) => u.startsWith("http://"))).toBe(false);

        requestedUrls.length = 0;
        const upgradeClient = new ZenTaoSessionClient();
        const upgradeProbe = yield* upgradeClient.probeAndListScopes(
          {
            baseUrl: "http://pms.example.com/zentao/",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(upgradeProbe.normalizedBaseUrl).toBe("https://pms.example.com/zentao");
        expect(
          requestedUrls.some(
            (u) => u === "https://pms.example.com/zentao/user-login.json?zentaosid=sid-123",
          ),
        ).toBe(true);
        requestedUrls.length = 0;
        const saved = yield* new ZenTaoSessionClient().probeAndListScopes(
          { baseUrl: "http://pms.example.com/zentao", account: "alice", secret: "test" },
          "saved",
        );
        expect(saved.normalizedBaseUrl).toBe("https://pms.example.com/zentao");
        expect(requestedUrls.filter((url) => url.startsWith("http:"))).toEqual([
          "http://pms.example.com/zentao/index.php?mode=getconfig",
        ]);
      }),
  );

  it.effect("reserves probes for common subpaths on the fallback protocol", () =>
    Effect.gen(function* () {
      for (const preferred of [true, false]) {
        const expectedBase = preferred
          ? "https://pms.example.com/zentao"
          : "http://pms.example.com/pms";
        using requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url = String(input);
          return (
            handleStandardZenTaoEndpoints(url, expectedBase) ??
            (preferred ? handleStandardZenTaoEndpoints(url, "http://pms.example.com") : null) ??
            new Response(null, { status: 404 })
          );
        });
        const result = yield* new ZenTaoSessionClient().probeAndListScopes(
          { baseUrl: "pms.example.com", account: "alice", secret: "test" },
          "discover",
        );
        expect(result.normalizedBaseUrl).toBe(expectedBase);
        for (const scheme of ["http:", "https:"]) {
          expect(
            requests.mock.calls.filter(
              ([url]) => String(url).startsWith(scheme) && /mode=getconfig|\/$/.test(String(url)),
            ).length,
          ).toBeLessThanOrEqual(10);
        }
      }
    }),
  );

  it.effect("pins custom PATH_INFO separators for root and subdirectory installations", () =>
    Effect.gen(function* () {
      for (const base of ["https://pms.example.com", "https://pms.example.com/team"]) {
        let reads = 0;
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes("getconfig"))
            return Response.json({ requestType: "PATH_INFO", requestFix: "/", sessionID: "sid" });
          if (url.includes("/bug/browse.json")) {
            if (++reads === 1) return Response.redirect(base + "/user/login.html", 302);
            return Response.json({ products: { "1": "Core" } });
          }
          return Response.json({ status: "success" });
        });
        const result = yield* new ZenTaoSessionClient().probeAndListScopes(
          { baseUrl: base, account: "alice", secret: "test" },
          "saved",
        );
        expect(result.scopes).toEqual([{ id: "1", name: "Core" }]);
        expect(reads).toBe(2);
      }
    }),
  );

  it.effect(
    "limits attachment credentials to the saved instance and reads same-site public images",
    () =>
      Effect.gen(function* () {
        const base = "https://pms.example.com/team";
        const credentials = { baseUrl: base, account: "alice", secret: "test" };
        using requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url = String(input);
          return (
            handleStandardZenTaoEndpoints(url, base) ??
            new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })
          );
        });
        const client = new ZenTaoSessionClient();
        for (const path of ["/team/static/image.png", "/shared/image.png"]) {
          const url = "https://pms.example.com" + path;
          const asset = yield* client.downloadAttachment({ credentials, url });
          expect(asset.bytes).toEqual(new Uint8Array([1]));
          const [destination, init] = requests.mock.calls.at(-1)!;
          expect(new URL(String(destination)).searchParams.has("zentaosid")).toBe(
            path.startsWith("/team/"),
          );
          expect(new Headers(init?.headers).has("cookie")).toBe(path.startsWith("/team/"));
        }
        const external = "https://external.example.com/image.png";
        expect(
          (yield* Effect.result(client.downloadAttachment({ credentials, url: external })))._tag,
        ).toBe("Failure");
        expect(requests.mock.calls.every(([url]) => !String(url).startsWith(external))).toBe(true);
      }),
  );

  it.effect("validates each HTTP redirect before a probe or login can follow it", () =>
    Effect.gen(function* () {
      const base = "https://pms.example.com/team";
      const config = base + "/index.php?mode=getconfig";
      for (const target of [
        "https://other.example.com/",
        "http://pms.example.com/",
        "https://pms.example.com:8443/",
      ]) {
        for (const stage of ["config", "login"]) {
          using requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url === config && stage === "config")
              return Response.redirect(base + "/route", 302);
            if (url === base + "/route" || url.includes("user-login.json"))
              return Response.redirect(target, 307);
            return handleStandardZenTaoEndpoints(url, base) ?? new Response(null, { status: 404 });
          });
          const result = yield* Effect.result(
            new ZenTaoSessionClient().probeAndListScopes(
              {
                baseUrl: base,
                account: "alice",
                secret: "test",
              },
              "discover",
            ),
          );
          expect(result._tag).toBe("Failure");
          expect(requests.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
          expect(requests.mock.calls.some(([url]) => String(url) === target)).toBe(false);
        }
      }
    }),
  );

  it.effect("keeps saved scope refreshes and writes on the configured instance", () =>
    Effect.gen(function* () {
      const base = "https://pms.example.com/team";
      const credentials = { baseUrl: base, account: "alice", secret: "test" };
      for (const response of [
        () => new Response(null, { status: 404 }),
        () => Response.redirect("https://pms.example.com/zentao/index.php?mode=getconfig", 302),
      ]) {
        using requests = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async (input) =>
            String(input).startsWith(base + "/")
              ? response()
              : (handleStandardZenTaoEndpoints(String(input), "https://pms.example.com/zentao") ??
                Response.json({ result: "success" })),
          );
        const client = new ZenTaoSessionClient();
        expect((yield* Effect.result(client.probeAndListScopes(credentials, "saved")))._tag).toBe(
          "Failure",
        );
        expect(
          (yield* Effect.result(
            client.writeBack({
              credentials,
              action: { kind: "comment", issueKey: "1", comment: "review" },
            }),
          ))._tag,
        ).toBe("Failure");
        expect(requests.mock.calls.every(([url]) => String(url).startsWith(base + "/"))).toBe(true);
      }
    }),
  );

  it.effect("reports uncertain writes without repeating comments or issue creation", () =>
    Effect.gen(function* () {
      const base = "https://pms.example.com/team";
      const credentials = { baseUrl: base, account: "alice", secret: "test" };
      for (const action of [
        { kind: "comment", issueKey: "1", comment: "review" },
        { kind: "create", scopeId: "1", title: "review", steps: "" },
      ] as const) {
        for (const response of [
          () => new Response('<p>Saved</p><a href="user-login.html">Log in</a>'),
          () => Response.json({ locate: "index.php?m=user&f=login" }),
          () => Response.redirect(base + "/user-login.html", 307),
        ]) {
          let writes = 0;
          using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const standard = handleStandardZenTaoEndpoints(String(input), base);
            if (standard) return standard;
            writes++;
            return response();
          });
          const result = yield* Effect.result(
            new ZenTaoSessionClient().writeBack({ credentials, action }),
          );
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { detail: expect.stringContaining("写入结果待确认") },
          });
          expect(writes).toBe(1);
        }
      }
    }),
  );

  it.effect("recovers GET login routes once and reports a session that stays expired", () =>
    Effect.gen(function* () {
      const base = "https://pms.example.com/team";
      const credentials = { baseUrl: base, account: "alice", secret: "test" };
      for (const response of [
        () => new Response('<script>location.href="?f=login&amp;m=user"</script>'),
        () => Response.json({ locate: "index.php?f=login&m=user" }),
        () => Response.redirect(base + "/index.php?f=login&m=user", 302),
      ]) {
        for (const staysExpired of [false, true]) {
          let reads = 0;
          using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = new URL(String(input));
            if (url.searchParams.has("mode"))
              return Response.json({ requestType: "GET", sessionID: "test" });
            if (url.searchParams.get("m") === "bug") {
              reads++;
              if (staysExpired || reads === 1) return response();
              return Response.json({ products: { "1": "Core" } });
            }
            return Response.json({ status: "success" });
          });
          const result = yield* Effect.result(
            new ZenTaoSessionClient().probeAndListScopes(credentials, "saved"),
          );
          expect(reads).toBe(2);
          if (staysExpired)
            expect(result).toMatchObject({
              _tag: "Failure",
              failure: { detail: expect.stringContaining("会话已过期") },
            });
          else
            expect(result).toMatchObject({
              _tag: "Success",
              success: { scopes: [{ id: "1", name: "Core" }] },
            });
        }
      }
    }),
  );

  it.effect("ignores cross-host redirects in welcome HTML to prevent SSRF", () =>
    Effect.gen(function* () {
      const requestedUrls: string[] = [];
      using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requestedUrls.push(url);
        if (url === "https://zentao.example.com/index.php?mode=getconfig") {
          return new Response(
            `<script>window.location.replace("https://evil.example.net/zentao");</script>`,
            { status: 200, headers: { "content-type": "text/html" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      });

      const client = new ZenTaoSessionClient();
      const exit = yield* Effect.exit(
        client.probeAndListScopes(
          {
            baseUrl: "https://zentao.example.com",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        ),
      );
      expect(exit._tag).toBe("Failure");
      expect(requestedUrls.some((u) => u.includes("evil.example.net"))).toBe(false);
    }),
  );

  it.effect(
    "re-authenticates when a ZenTao .json endpoint returns an HTML user-login redirect",
    () =>
      Effect.gen(function* () {
        let authCount = 0;
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const base = "https://zentao.example.com/zentao";
          if (url === `${base}/index.php?mode=getconfig`) {
            authCount += 1;
            const sid = authCount === 1 ? "sid-stale" : "sid-fresh";
            return jsonResponse(
              {
                version: "10.6",
                requestType: "PATH_INFO",
                requestFix: "-",
                sessionName: "zentaosid",
                sessionID: sid,
                rand: 42,
              },
              url,
            );
          }
          const sid = authCount === 1 ? "sid-stale" : "sid-fresh";
          if (url === `${base}/api-getSessionID.json?zentaosid=${sid}`) {
            return jsonResponse({
              status: "success",
              data: JSON.stringify({ sessionName: "zentaosid", sessionID: sid, rand: 42 }),
            });
          }
          if (url === `${base}/user-login.json?zentaosid=${sid}`) {
            return jsonResponse({
              status: "success",
              user: { account: "alice", realname: "Alice" },
            });
          }
          if (url === `${base}/bug-browse.json?zentaosid=sid-stale`) {
            return new Response(
              `<html><script>self.location='/zentao/user-login-L3plbnRhby9idWctYnJvd3NlLmpzb24=.json';</script></html>`,
              { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
            );
          }
          if (url === `${base}/bug-browse.json?zentaosid=sid-fresh`) {
            return jsonResponse({
              status: "success",
              data: JSON.stringify({ products: { "0": "", "68": "Core Product" } }),
            });
          }
          return new Response("Not Found", { status: 404 });
        });

        const client = new ZenTaoSessionClient();
        const probe = yield* client.probeAndListScopes(
          {
            baseUrl: "https://zentao.example.com/zentao",
            account: "alice",
            secret: "secret-pass",
          },
          "discover",
        );
        expect(authCount).toBe(2);
        expect(probe.normalizedBaseUrl).toBe("https://zentao.example.com/zentao");
        expect(probe.scopes).toEqual([{ id: "68", name: "Core Product" }]);
      }),
  );
});
