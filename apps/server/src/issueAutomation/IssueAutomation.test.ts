import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  IssueAutomationPlatformKind,
  ProjectId,
  ProviderInstanceId,
  type IssueAutomationSaveProfileInput,
  type IssueAutomationTaskId,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  extractZenTaoImageUrls,
  markdownToZenTaoHtml,
  normalizeZenTaoBaseUrl,
  sortZenTaoScopesDesc,
  zenTaoHtmlToMarkdown,
} from "./connectors/zentao/ZenTaoClient.ts";
import * as IssueAutomationRepository from "./IssueAutomationRepository.ts";
import * as IssueAutomationService from "./IssueAutomationService.ts";
import { resolveTargetRepositories } from "./MultiRepoRouter.ts";
import type { IssuePlatformPlugin, PlatformIssueDetail } from "./plugin/IssuePlatformPlugin.ts";
import * as PluginRegistry from "./plugin/PluginRegistry.ts";

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

it.effect("uses the latest Feishu settings for finished tasks and skips manual cancellations", () =>
  Effect.gen(function* () {
    const pollStarted = yield* Deferred.make<void>();
    const finishPoll = yield* Deferred.make<void>();
    const cancellableTaskStarted = yield* Deferred.make<void>();
    const outbound: Array<{ readonly url: string; readonly body: unknown }> = [];
    const webhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook";
    const baseUrl = "https://zentao.example.com/zentao";
    const scope = { id: "5", name: "好轻 App" };
    const platform = IssueAutomationPlatformKind.make("zentao");
    const detail: PlatformIssueDetail = {
      key: "2846",
      displayKey: "#2846",
      scopeId: scope.id,
      scopeName: scope.name,
      title: "体重记录未刷新",
      url: `${baseUrl}/bug-view-2846.html`,
      moduleId: null,
      moduleName: null,
      severity: null,
      priority: null,
      status: "resolved",
      statusLabel: "已解决",
      confirmed: true,
      author: null,
      assignee: "陈晓",
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
      stepsHtml: "",
      stepsMarkdown: "",
      imageUrls: [],
      openedBuild: "",
      availableBuilds: [],
      availableUsers: [],
      comments: [],
    };
    const plugin: IssuePlatformPlugin = {
      kind: platform,
      descriptor: {
        platform,
        displayName: "ZenTao",
        description: "",
        implemented: true,
        scopeNoun: "产品",
        issueNoun: "Bug",
        authFields: [],
      },
      normalizeBaseUrl: (url) => url,
      probeAndListScopes: () =>
        Effect.succeed({
          normalizedBaseUrl: baseUrl,
          viewerName: "test",
          serverVersion: null,
          scopes: [scope],
        }),
      listIssues: () =>
        Deferred.succeed(pollStarted, undefined).pipe(
          Effect.andThen(Deferred.await(finishPoll)),
          Effect.as({ items: [{ ...detail, status: "active" }], total: 1, page: 1, pageSize: 30 }),
        ),
      getIssueDetail: ({ issueKey }) =>
        issueKey === "2847"
          ? Deferred.succeed(cancellableTaskStarted, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(detail),
      writeBack: () => Effect.die("Unexpected write-back"),
    };
    const dependencies = Layer.mergeAll(
      IssueAutomationRepository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
      Layer.succeed(PluginRegistry.IssuePlatformPluginRegistry, {
        descriptors: [plugin.descriptor],
        get: () => plugin,
        requirePlugin: () => Effect.succeed(plugin),
      }),
      ServerSecretStore.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-issue-feishu-" })),
        Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
      ),
      Layer.mock(ProjectService.ProjectService)({ listShells: () => Effect.succeed([]) }),
      Layer.mock(GitWorkflow.GitWorkflowService)({}),
      Layer.mock(ThreadIssueService.ThreadIssueService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, async (url, init) => {
            outbound.push({ url: String(url), body: JSON.parse(String(init?.body)) });
            return Response.json({ code: outbound.length === 1 ? 0 : 9499 });
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* IssueAutomationService.IssueAutomationService;
      const connector = yield* service.saveConnector({
        platform,
        name: "ZenTao",
        baseUrl,
        account: "test",
        secret: "connector-secret",
      });
      const input = {
        connectorId: connector.id,
        name: scope.name,
        enabled: false,
        scopeId: scope.id,
        scopeName: scope.name,
        repositories: {
          primaryProjectId: ProjectId.make("missing-project"),
          linkedProjectIds: [],
          moduleMappings: [],
        },
        models: {
          primaryModel: { instanceId: ProviderInstanceId.make("codex"), model: "example" },
          triageModel: null,
          highSeverityModel: null,
          reviewModel: null,
          fallbackModel: null,
        },
        filter: {
          browseType: "unresolved",
          onlyUnconfirmed: false,
          assignedToAccount: null,
          maxSeverity: null,
          keyword: null,
          pollIntervalMinutes: 5,
          maxConcurrency: 1,
        },
        policy: {
          actionMode: "diagnose_only",
          autoWriteComment: false,
          baseBranch: null,
          customPromptInstructions: null,
        },
      } satisfies IssueAutomationSaveProfileInput;
      const rule = yield* service.saveProfile(input);
      expect(rule.feishuNotification).toEqual({ enabled: false, hasWebhook: false });
      const missing = yield* service
        .saveProfile({
          ...input,
          id: rule.id,
          feishuNotification: { enabled: true },
        })
        .pipe(Effect.flip);
      expect(missing.operation).toBe("saveProfile");

      const enable = { ...input, id: rule.id, feishuNotification: { enabled: true } };
      const configured = yield* service.saveProfile({
        ...enable,
        feishuNotification: { enabled: true, webhook: Redacted.make(webhook) },
      });
      expect(configured.feishuNotification).toEqual({ enabled: true, hasWebhook: true });
      expect(JSON.stringify(configured)).not.toMatch(/test-webhook|feishuWebhookSecretId/);

      const snapshots = yield* Stream.toQueue(service.subscribe, { capacity: "unbounded" });
      yield* Queue.take(snapshots);
      const whenSettled = (taskId?: IssueAutomationTaskId) =>
        Stream.fromQueue(snapshots).pipe(
          Stream.filter(
            (snapshot) =>
              snapshot.activeRunCount === 0 &&
              snapshot.tasks.some(
                (task) => (!taskId || task.id === taskId) && task.completedAt !== null,
              ),
          ),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );

      const poll = yield* service.triggerPoll({ profileId: rule.id }).pipe(Effect.forkChild);
      yield* Deferred.await(pollStarted);
      yield* service.saveProfile({ ...enable, feishuNotification: { enabled: false } });
      yield* Deferred.succeed(finishPoll, undefined);
      expect((yield* Fiber.join(poll)).enqueuedCount).toBe(1);
      const afterPoll = yield* whenSettled();
      expect(afterPoll.profiles[0]?.feishuNotification).toEqual({
        enabled: false,
        hasWebhook: true,
      });
      expect(outbound).toEqual([]);

      yield* service.saveProfile(enable);
      const run = (issueKey: string) =>
        service
          .analyzeIssues({
            connectorId: connector.id,
            scopeId: scope.id,
            scopeName: "Client-supplied name",
            issueKeys: [issueKey],
          })
          .pipe(Effect.map(({ tasks }) => tasks[0]!.id));
      yield* whenSettled(yield* run("2846"));
      expect(outbound).toEqual([
        {
          url: webhook,
          body: {
            msg_type: "post",
            content: {
              post: {
                zh_cn: {
                  content: [
                    [{ tag: "text", text: "任务状态：失败" }],
                    [
                      { tag: "text", text: "禅道 Bug：" },
                      { tag: "a", text: "#2846 体重记录未刷新", href: detail.url },
                    ],
                    [{ tag: "text", text: "Bug 状态：已解决" }],
                    [{ tag: "text", text: "项目名：好轻 App" }],
                    [{ tag: "text", text: "负责人：陈晓" }],
                  ],
                },
              },
            },
          },
        },
      ]);

      const rejectedId = yield* run("2848");
      const afterRejection = yield* whenSettled(rejectedId);
      const rejectedTask = afterRejection.tasks.find((task) => task.id === rejectedId);
      expect(rejectedTask?.stage).toBe("failed");
      expect(rejectedTask?.steps.at(-1)?.message).toContain("飞书通知发送失败");

      const cancelled = yield* run("2847");
      yield* Deferred.await(cancellableTaskStarted);
      yield* service.cancelTask({ taskId: cancelled });
      const afterCancel = yield* whenSettled(cancelled);
      expect(afterCancel.tasks.find((task) => task.id === cancelled)?.stage).toBe("cancelled");
      expect(outbound).toHaveLength(2);
    }).pipe(Effect.provide(IssueAutomationService.layer.pipe(Layer.provide(dependencies))));
  }),
);
