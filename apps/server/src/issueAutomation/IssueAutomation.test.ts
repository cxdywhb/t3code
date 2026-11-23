import { describe, expect, it } from "@effect/vitest";
import { ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import {
  extractZenTaoImageUrls,
  markdownToZenTaoHtml,
  normalizeZenTaoBaseUrl,
  sortZenTaoScopesDesc,
  zenTaoHtmlToMarkdown,
  ZenTaoSessionClient,
} from "./connectors/zentao/ZenTaoClient.ts";
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
        const probe = yield* client.probeAndListScopes({
          baseUrl,
          account: "alice",
          secret: "secret-pass",
        });
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
        const probeA = yield* clientA.probeAndListScopes({
          baseUrl: "https://zentao.example.com",
          account: "alice",
          secret: "secret-pass",
        });
        expect(probeA.normalizedBaseUrl).toBe("https://zentao.example.com/zentao");

        const clientB = new ZenTaoSessionClient();
        const probeB = yield* clientB.probeAndListScopes({
          baseUrl: "https://zentao.example.com/custom-pms/bug/browse/68",
          account: "alice",
          secret: "secret-pass",
        });
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
            return jsonResponse(
              {
                version: "10.6",
                requestType: "PATH_INFO",
                requestFix: "-",
                sessionName: "zentaosid",
                sessionID: "sid-123",
                rand: 42,
              },
              "https://pms.example.com/zentao/index.php?mode=getconfig",
            );
          }
          if (url.startsWith("https://pms.example.com/zentao/")) {
            const hit = handleStandardZenTaoEndpoints(url, "https://pms.example.com/zentao");
            if (hit) return hit;
          }
          return new Response("Not Found", { status: 404 });
        });

        const bareClient = new ZenTaoSessionClient();
        const bareProbe = yield* bareClient.probeAndListScopes({
          baseUrl: "zentao.example.internal",
          account: "alice",
          secret: "secret-pass",
        });
        expect(bareProbe.normalizedBaseUrl).toBe("http://zentao.example.internal/zentao");

        requestedUrls.length = 0;
        const httpsClient = new ZenTaoSessionClient();
        const explicitHttpsExit = yield* Effect.exit(
          httpsClient.probeAndListScopes({
            baseUrl: "https://zentao.example.internal",
            account: "alice",
            secret: "secret-pass",
          }),
        );
        expect(explicitHttpsExit._tag).toBe("Failure");
        expect(requestedUrls.some((u) => u.startsWith("http://"))).toBe(false);

        requestedUrls.length = 0;
        const upgradeClient = new ZenTaoSessionClient();
        const upgradeProbe = yield* upgradeClient.probeAndListScopes({
          baseUrl: "http://pms.example.com/zentao/",
          account: "alice",
          secret: "secret-pass",
        });
        expect(upgradeProbe.normalizedBaseUrl).toBe("https://pms.example.com/zentao");
        expect(
          requestedUrls.some(
            (u) => u === "https://pms.example.com/zentao/user-login.json?zentaosid=sid-123",
          ),
        ).toBe(true);
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
        client.probeAndListScopes({
          baseUrl: "https://zentao.example.com",
          account: "alice",
          secret: "secret-pass",
        }),
      );
      expect(exit._tag).toBe("Failure");
      expect(requestedUrls.some((u) => u.includes("evil.example.net"))).toBe(false);
    }),
  );
});
