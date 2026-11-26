import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  IssueAutomationPlatformKind,
  IssueAutomationConnectorId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type IssueAutomationSaveProfileInput,
  type IssueAutomationConnector,
  type IssueAutomationTaskId,
  type IssueAutomationWriteBackAction,
  type OrchestrationProjectShell,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
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
import { sendFeishuTaskNotification } from "./FeishuTaskNotification.ts";
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

it.effect("handles diagnosis retries, repair review and write-back, and Feishu notifications", () =>
  Effect.gen(function* () {
    const pollStarted = yield* Deferred.make<void>();
    const finishPoll = yield* Deferred.make<void>();
    const cancellableTaskStarted = yield* Deferred.make<void>();
    const runWaiting = yield* Deferred.make<void>();
    const stopRequested = yield* Deferred.make<void>();
    const confirmStop = yield* Deferred.make<void>();
    const outbound: Array<{ readonly url: string; readonly body: unknown }> = [];
    const writeBacks: IssueAutomationWriteBackAction[] = [];
    const startedMessages: ThreadLaunchService.ThreadLaunchInitialMessage[] = [];
    const project: OrchestrationProjectShell = {
      id: ProjectId.make("proj-example"),
      title: "example-app",
      workspaceRoot: "/repos/example-app",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const webhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook";
    const baseUrl = "https://zentao.example.com/zentao";
    const scope = { id: "5", name: "好轻 App" };
    const platform = IssueAutomationPlatformKind.make("zentao");
    const threadId = ThreadId.make("thread:issue-diagnosis:2849");
    const oldRunId = RunId.make("run:issue-2849:1");
    const newRunId = RunId.make("run:issue-2849:2");
    const repairThreadId = ThreadId.make("thread:repair-2849");
    const repairRunId = RunId.make("run:repair-2849");
    let repairMessageId = MessageId.make("repair-message");
    let repairBranch = "";
    const at = DateTime.makeUnsafe("2026-11-24T00:00:00Z");
    const instanceId = ProviderInstanceId.make("codex");
    const modelSelection = { instanceId, model: "example" };
    const runs: OrchestrationV2Run[] = [];
    const makeRun = (
      id: RunId,
      messageId: MessageId,
      status: OrchestrationV2Run["status"],
    ): OrchestrationV2Run => ({
      id,
      threadId,
      ordinal: runs.length + 1,
      providerInstanceId: instanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: messageId,
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: at,
      startedAt: at,
      completedAt: status === "running" ? null : at,
      checkpointId: null,
      contextHandoffId: null,
    });
    const baseProjection = emptyProjection({
      id: EventId.make("event:issue-2849"),
      type: "thread.created",
      threadId,
      occurredAt: at,
      payload: {
        id: threadId,
        projectId: project.id,
        title: "Diagnosis",
        createdBy: "user",
        creationSource: "web",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    });
    const reply = (runId: RunId, text: string) => ({
      id: MessageId.make(`reply:${runId}`),
      threadId,
      runId,
      nodeId: null,
      role: "assistant" as const,
      createdBy: "agent" as const,
      creationSource: "provider" as const,
      text,
      attachments: [],
      streaming: false,
      createdAt: at,
      updatedAt: at,
    });
    let oldPermissions = false;
    const projection = () => ({
      ...baseProjection,
      thread: oldPermissions
        ? { ...baseProjection.thread, runtimeMode: "full-access" as const }
        : baseProjection.thread,
      runs: [...runs],
      messages: [
        ...(runs.length > 1 ? [reply(newRunId, "New diagnosis")] : []),
        reply(oldRunId, "Cancelled diagnosis fragment"),
      ],
    });
    const repairRun = () => ({
      ...makeRun(repairRunId, repairMessageId, "completed"),
      threadId: repairThreadId,
      ordinal: 1,
    });
    const repairProjection = () => ({
      ...baseProjection,
      thread: {
        ...baseProjection.thread,
        id: repairThreadId,
        worktreePath: "/repos/example-worktree",
        branch: repairBranch,
      },
      runs: [repairRun()],
      messages: [
        { ...reply(repairRunId, "Applied and tested the repair"), threadId: repairThreadId },
      ],
      checkpoints: [
        {
          id: CheckpointId.make("repair-checkpoint"),
          threadId: repairThreadId,
          scopeId: CheckpointScopeId.make("repair-scope"),
          runId: repairRunId,
          nodeId: NodeId.make("repair-node"),
          parentCheckpointId: null,
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          ref: CheckpointRef.make("refs/t3/checkpoint/repair"),
          status: "ready" as const,
          files: [],
          filesTotal: { count: 1, additions: 1, deletions: 0 },
          capturedAt: at,
        },
      ],
    });
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
      stepsMarkdown: "打开体重记录页面，查看最新记录。",
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
          writeActions: ["comment", "resolve"],
          scopes: [scope],
        }),
      listIssues: ({ page, pageSize, browseType, keyword, scopeId }) => {
        if (browseType === "all") {
          expect({ keyword, scopeId }).toEqual({ keyword: "体重", scopeId: scope.id });
          const matched = { ...detail, severity: 1, confirmed: false, assignee: "Chen (chen)" };
          return Effect.succeed({
            items:
              page === 1
                ? [
                    { ...matched, confirmed: true },
                    { ...matched, severity: 3 },
                    { ...matched, assignee: "Someone else" },
                  ]
                : Array.from({ length: 26 }, (_, index) => ({
                    ...matched,
                    key: String(3000 + index),
                  })),
            total: pageSize + 26,
            page,
            pageSize,
          });
        }
        return Deferred.succeed(pollStarted, undefined).pipe(
          Effect.andThen(Deferred.await(finishPoll)),
          Effect.as({ items: [{ ...detail, status: "active" }], total: 1, page: 1, pageSize: 30 }),
        );
      },
      getIssueDetail: ({ issueKey }) =>
        issueKey === "2847"
          ? Deferred.succeed(cancellableTaskStarted, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(
              issueKey === "2849"
                ? {
                    ...detail,
                    key: issueKey,
                    displayKey: "#2849",
                    status: "active",
                    statusLabel: "激活",
                    availableBuilds: [{ id: "7", name: "v1.2.0" }],
                  }
                : detail,
            ),
      writeBack: ({ action }) =>
        Effect.sync(() => {
          writeBacks.push(action);
          return { ok: true };
        }),
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
      Layer.mock(ProjectService.ProjectService)({ listShells: () => Effect.succeed([project]) }),
      Layer.mock(GitWorkflow.GitWorkflowService)({ currentBranch: () => Effect.succeed("main") }),
      Layer.mock(ThreadIssueService.ThreadIssueService)({
        link: () => Effect.succeed({ alreadyLinked: false }),
      }),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: (input) => {
          if (input.initialMessage) startedMessages.push(input.initialMessage);
          if (input.workspaceStrategy?.type === "worktree") {
            expect(input.initialMessage?.text).toContain("New diagnosis");
            expect(input.initialMessage?.context?.issueAutomation?.mode).toBe("repair");
            expect(input.workspaceStrategy).toMatchObject({
              baseRef: "main",
              startFromOrigin: false,
            });
            repairMessageId = input.initialMessage!.messageId!;
            repairBranch = input.workspaceStrategy.branch!;
            return Effect.succeed({
              threadId: repairThreadId,
              projection: repairProjection(),
              resumed: false,
            });
          }
          if (input.initialMessage?.context?.issueAutomation?.issueKey === "#2849") {
            expect(input.threadId).toMatch(/^thread:issue-diagnosis:/);
            expect(input.runtimeMode).toBe("approval-required");
            runs.push(makeRun(oldRunId, input.initialMessage.messageId!, "running"));
            return Effect.succeed({ threadId, projection: projection(), resumed: false });
          }
          return Effect.fail(
            new ThreadLaunchService.ThreadLaunchError({
              operation: "dispatch-message",
              commandId: input.commandId,
              projectId: input.projectId,
              cause: "provider unavailable",
            }),
          );
        },
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadProjection: (id) =>
          Effect.sync(id === repairThreadId ? repairProjection : projection),
        interruptThread: (input) =>
          Effect.gen(function* () {
            expect(input).toMatchObject({ threadId, runId: oldRunId });
            yield* Deferred.succeed(stopRequested, undefined);
            return {
              type: "interrupt_requested" as const,
              run: runs[0]!,
              dispatch: { sequence: 1, storedEvents: [] },
            };
          }),
        waitForThread: (input) =>
          Effect.gen(function* () {
            if (input.threadId === repairThreadId) {
              expect(input.runId).toBe(repairRunId);
              return { threadId: repairThreadId, run: repairRun(), timedOut: false };
            }
            expect(input.threadId).toBe(threadId);
            if (input.runId === oldRunId && input.untilDelegatedWorkSettled) {
              yield* Deferred.succeed(runWaiting, undefined);
              return yield* Effect.never;
            }
            if (input.runId === oldRunId) {
              yield* Deferred.await(confirmStop);
              runs[0] = { ...runs[0]!, status: "interrupted", completedAt: at };
              return { threadId, run: runs[0], timedOut: false };
            }
            expect(input.runId).toBe(newRunId);
            return { threadId, run: runs[1]!, resultRun: runs[0]!, timedOut: false };
          }),
        sendToThread: (input) =>
          Effect.sync(() => {
            expect(input).toMatchObject({
              threadId,
              freshContext: true,
              context: { issueAutomation: { attemptNumber: 2 } },
            });
            const run = makeRun(newRunId, input.messageId, "completed");
            runs.push(run);
            const message = {
              ...reply(run.id, input.text),
              id: input.messageId,
              role: "user" as const,
            };
            return {
              dispatch: { sequence: 2, storedEvents: [] },
              projection: projection(),
              message,
              run,
              turnItem: null,
              delivery: "started" as const,
            };
          }),
      }),
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
      const repository = yield* IssueAutomationRepository.IssueAutomationRepository;
      const connector = {
        id: IssueAutomationConnectorId.make("example-connector"),
        platform,
        name: "ZenTao",
        baseUrl,
        mcpUrl: "https://mcp.example.com/zentao/mcp",
        writeActions: ["comment", "resolve"],
        status: "connected",
        viewerName: null,
        serverVersion: null,
        statusDetail: null,
        scopes: [scope],
        updatedAt: DateTime.formatIso(at),
      } satisfies IssueAutomationConnector;
      yield* repository.upsertConnector(connector);
      const input = {
        connectorId: connector.id,
        name: scope.name,
        enabled: false,
        scopeId: scope.id,
        scopeName: scope.name,
        repositories: {
          primaryProjectId: project.id,
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
      const scanRule = yield* service.saveProfile({
        ...input,
        filter: {
          ...input.filter,
          browseType: "all",
          keyword: "体重",
          onlyUnconfirmed: true,
          assignedToAccount: " chen ",
          maxSeverity: 2,
        },
      });
      const firstPage = yield* service.scanProfileIssues({ profileId: scanRule.id });
      expect(firstPage.issues.map((issue) => issue.key)).toEqual(
        Array.from({ length: 25 }, (_, index) => String(3000 + index)),
      );
      expect(firstPage.hasNextPage).toBe(true);
      const lastPage = yield* service.scanProfileIssues({ profileId: scanRule.id, page: 2 });
      expect(lastPage.issues.map((issue) => issue.key)).toEqual(["3025"]);
      expect(lastPage.hasNextPage).toBe(false);
      const afterScan = yield* service.getState;
      expect(afterScan.tasks).toEqual([]);
      expect(
        afterScan.profiles.find((profile) => profile.id === scanRule.id)?.lastPolledAt,
      ).toBeNull();
      yield* service.deleteProfile({ profileId: scanRule.id });
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
      const reopened = (yield* service.getState).profiles.find((profile) => profile.id === rule.id);
      expect(reopened?.feishuNotification).toEqual({ enabled: true, hasWebhook: true });
      expect(JSON.stringify(reopened)).not.toMatch(/test-webhook|feishuWebhookSecretId/);

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
      expect(startedMessages.at(-1)).toMatchObject({
        text: expect.stringContaining(detail.stepsMarkdown),
        context: {
          issueAutomation: {
            mode: "diagnose",
            scopeName: scope.name,
            moduleName: null,
            platform,
            issueKey: detail.displayKey,
            issueUrl: detail.url,
          },
        },
      });
      expect(outbound).toEqual([
        {
          url: webhook,
          body: {
            msg_type: "post",
            content: {
              post: {
                zh_cn: {
                  title: "T3 Code · 禅道问题自动分析",
                  content: [
                    [{ tag: "text", text: "任务状态：诊断失败" }],
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
      const cancelledTask = afterCancel.tasks.find((task) => task.id === cancelled);
      expect(cancelledTask?.stage).toBe("cancelled");
      expect(cancelledTask?.steps.map((step) => step.stage)).toContain("cancelling");
      expect(outbound).toHaveLength(2);

      yield* service.saveProfile({ ...enable, feishuNotification: { enabled: false } });
      const running = yield* run("2849");
      yield* Deferred.await(runWaiting);
      const stop = yield* service.cancelTask({ taskId: running }).pipe(Effect.forkChild);
      yield* Deferred.await(stopRequested);
      expect((yield* service.getState).tasks.find((task) => task.id === running)).toMatchObject({
        stage: "cancelling",
        primaryThreadId: threadId,
        primaryRunId: oldRunId,
        completedAt: null,
      });
      const retry = service.analyzeIssues({
        connectorId: connector.id,
        scopeId: scope.id,
        scopeName: scope.name,
        issueKeys: ["2849"],
        retryTaskId: running,
      });
      expect((yield* Effect.result(retry))._tag).toBe("Failure");
      yield* Deferred.succeed(confirmStop, undefined);
      yield* Fiber.join(stop);
      oldPermissions = true;
      expect((yield* Effect.result(retry))._tag).toBe("Failure");
      oldPermissions = false;
      const restarted = (yield* retry).tasks[0]!;
      const final = yield* whenSettled(restarted.id);
      expect(final.tasks.find((task) => task.id === running)).toMatchObject({
        stage: "cancelled",
        primaryRunId: oldRunId,
      });
      expect(final.tasks.find((task) => task.id === restarted.id)).toMatchObject({
        stage: "completed",
        primaryThreadId: threadId,
        primaryRunId: newRunId,
        diagnosisReport: "New diagnosis",
      });
      expect(
        startedMessages.filter((message) => message.context?.issueAutomation?.issueKey === "#2849"),
      ).toHaveLength(1);

      const repairInput = {
        connectorId: connector.id,
        scopeId: scope.id,
        scopeName: scope.name,
        issueKeys: ["2849"],
        repairFromTaskId: restarted.id,
      };
      const diagnosticPolicy = { ...input.policy, autoWriteComment: true };
      yield* service.saveProfile({
        ...input,
        id: rule.id,
        policy: diagnosticPolicy,
        feishuNotification: { enabled: false },
      });
      const repair = (yield* service.analyzeIssues(repairInput)).tasks[0]!;
      expect(repair).toMatchObject({
        issueKey: "2849",
        actionMode: "fix_worktree_review",
        repairOfTaskId: restarted.id,
      });
      expect((yield* Effect.result(service.analyzeIssues(repairInput)))._tag).toBe("Failure");
      const reviewed = yield* whenSettled(repair.id);
      const repairPrompt = startedMessages.find(
        (message) => message.context?.issueAutomation?.mode === "repair",
      )?.text;
      expect(repairPrompt).toContain("New diagnosis");
      expect(repairPrompt).not.toContain("请先定位根本原因");
      expect(repairPrompt).not.toContain("## 问题根因分析");
      expect(reviewed.tasks.find((task) => task.id === repair.id)).toMatchObject({
        stage: "needs_human",
        primaryThreadId: repairThreadId,
        diagnosisReport: "Applied and tested the repair",
      });
      const sync = (writeComment: boolean, resolvedBuild?: string) =>
        service.writeBack({
          connectorId: connector.id,
          action: {
            kind: "sync_repair",
            taskId: repair.id,
            writeComment,
            ...(resolvedBuild === undefined ? {} : { resolvedBuild }),
          },
        });
      expect((yield* Effect.result(sync(true)))._tag).toBe("Failure");
      expect(writeBacks).toEqual([]);
      yield* service.confirmRepair({ taskId: repair.id });
      expect((yield* Effect.result(sync(false)))._tag).toBe("Failure");
      expect((yield* Effect.result(sync(false, "unknown")))._tag).toBe("Failure");
      expect(writeBacks).toEqual([]);
      yield* sync(true);
      yield* sync(true);
      expect(writeBacks).toEqual([
        {
          kind: "comment",
          issueKey: "2849",
          comment: expect.stringContaining("Applied and tested the repair"),
        },
      ]);
      yield* sync(false, "7");
      expect(writeBacks[1]).toEqual({
        kind: "resolve",
        issueKey: "2849",
        resolution: "fixed",
        resolvedBuild: "7",
      });
      const persisted = yield* service.getState;
      expect(persisted.tasks.find((task) => task.id === repair.id)).toMatchObject({
        stage: "completed",
        issueStatus: "resolved",
        repairConfirmedAt: expect.any(String),
        commentSyncedAt: expect.any(String),
        stateSyncedAt: expect.any(String),
      });
      expect(persisted.profiles.find((profile) => profile.id === rule.id)?.policy).toEqual(
        diagnosticPolicy,
      );
    }).pipe(Effect.provide(IssueAutomationService.layer.pipe(Layer.provideMerge(dependencies))));
  }),
);

it.effect.each([
  {
    actionMode: "diagnose_only",
    stage: "completed",
    hasConfirmedRepair: false,
    expectedStatus: "诊断完成",
  },
  {
    actionMode: "fix_worktree_review",
    stage: "completed",
    hasConfirmedRepair: true,
    expectedStatus: "修复完成",
  },
  {
    actionMode: "auto_resolve",
    stage: "completed",
    hasConfirmedRepair: false,
    expectedStatus: "修复任务结束，待确认",
  },
  {
    actionMode: "fix_worktree_review",
    stage: "needs_human",
    hasConfirmedRepair: true,
    expectedStatus: "修复待人工复核",
  },
  {
    actionMode: "auto_resolve",
    stage: "failed",
    hasConfirmedRepair: false,
    expectedStatus: "修复任务失败",
  },
] as const)(
  "formats the Feishu result for $actionMode / $stage / repair evidence $hasConfirmedRepair",
  ({ actionMode, stage, hasConfirmedRepair, expectedStatus }) =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const sent = yield* sendFeishuTaskNotification(
        http,
        Effect.succeed("https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook"),
        {
          platform: IssueAutomationPlatformKind.make("zentao"),
          stage,
          actionMode,
          displayKey: "#2846",
          issueTitle: "Pairing screen stays blank",
          issueUrl: "https://zentao.example.com/bug-view-2846.html",
          issueStatus: "active",
          scopeName: "Example App",
          assignee: null,
        },
        { appDisplayName: "Example T3 (Dev)", hasConfirmedRepair },
      ).pipe(
        Effect.provideService(FetchHttpClient.Fetch, async (_url, init) => {
          const payload = JSON.parse(String(init?.body));
          expect(payload.content.post.zh_cn.title).toBe("Example T3 (Dev) · 禅道问题自动分析");
          expect(payload.content.post.zh_cn.content[0]).toEqual([
            { tag: "text", text: `任务状态：${expectedStatus}` },
          ]);
          return Response.json({ code: 0 });
        }),
      );
      expect(sent).toBe(true);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
);
