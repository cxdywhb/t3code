// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  CommandId,
  isIssueAutomationFeishuWebhook,
  isOrchestrationV2WorkActive,
  IssueAutomationConnectorId,
  IssueAutomationError,
  IssueAutomationProfileId,
  IssueAutomationTaskId,
  IssueTrackerKind,
  MessageId,
  T3_APP_BASE_NAME,
  type IssueAutomationActionMode,
  type IssueAutomationAnalyzeIssuesInput,
  type IssueAutomationAnalyzeIssuesResult,
  type IssueAutomationCancelTaskInput,
  type IssueAutomationConnector,
  type IssueAutomationDeleteConnectorInput,
  type IssueAutomationDeleteProfileInput,
  type IssueAutomationGetRemoteIssueDetailInput,
  type IssueAutomationListRemoteIssuesInput,
  type IssueAutomationListRemoteIssuesResult,
  type IssueAutomationMessageSummary,
  type IssueAutomationModelStrategy,
  type IssueAutomationPolicy,
  type IssueAutomationProfile,
  type IssueAutomationRefreshScopesInput,
  type IssueAutomationRemoteIssue,
  type IssueAutomationRemoteIssueDetail,
  type IssueAutomationRepoBinding,
  type IssueAutomationSaveConnectorInput,
  type IssueAutomationSaveProfileInput,
  type IssueAutomationScanProfileIssuesInput,
  type IssueAutomationScanProfileIssuesResult,
  type IssueAutomationSetProfileEnabledInput,
  type IssueAutomationStage,
  type IssueAutomationStateSnapshot,
  type IssueAutomationTask,
  type IssueAutomationTriggerPollInput,
  type IssueAutomationTriggerPollResult,
  type IssueAutomationWriteBackInput,
  type IssueAutomationWriteBackResult,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadProjection,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  matchesIssueAutomationFilter,
  scanIssueAutomationPage,
} from "@t3tools/shared/issueAutomationScan";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { buildZenTaoBugWebUrl } from "./connectors/zentao/ZenTaoClient.ts";
import { sendFeishuTaskNotification } from "./FeishuTaskNotification.ts";
import * as IssueAutomationRepository from "./IssueAutomationRepository.ts";
import { resolveTargetRepositories } from "./MultiRepoRouter.ts";
import type {
  IssuePlatformPlugin,
  PlatformCredentials,
  PlatformIssueDetail,
  PlatformIssueSummary,
} from "./plugin/IssuePlatformPlugin.ts";
import * as PluginRegistry from "./plugin/PluginRegistry.ts";

const BOT_SIGNATURE_MARKER = "[T3-Auto-Analysis]";
const THREAD_WAIT_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_TICK_INTERVAL = Duration.seconds(30);
const isIssueAutomationError = Schema.is(IssueAutomationError);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function connectorSecretKey(id: IssueAutomationConnectorId): string {
  return `issue-automation-connector-${id}-secret`;
}

function profileForClient({
  feishuWebhookSecretId: _secretId,
  ...profile
}: IssueAutomationRepository.StoredProfile): IssueAutomationProfile {
  return profile;
}

function formatModelLabel(selection: ModelSelection): string {
  return `${selection.instanceId}:${selection.model}`;
}

function extractHostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

function buildDiagnosisPrompt(input: {
  readonly detail: PlatformIssueDetail;
  readonly actionMode: IssueAutomationActionMode;
  readonly targetProject: OrchestrationProjectShell;
  readonly referenceProjects: ReadonlyArray<OrchestrationProjectShell>;
  readonly downloadedImagePaths: ReadonlyArray<string>;
  readonly customInstructions: string | null;
}): string {
  const modeGuidance =
    input.actionMode === "diagnose_only"
      ? [
          "当前运行模式为【只读自动诊断模式】：",
          "- 请深入阅读代码库定位根本原因、完整调用链、触发条件以及具体到文件与行号的修复方案代码示例；",
          "- **严禁修改、删除或新建任何项目源码文件**，仅做静态与只读命令排查。",
        ].join("\n")
      : [
          `当前运行模式为【自动诊断与代码修复模式 (${input.actionMode})】：`,
          "- 当前会话已运行在独立的 Git Worktree 隔离分支中，可安全修改源码；",
          "- 请先定位根本原因，实施最小且稳健的代码修复，并在终端执行相关的类型检查/构建/单元测试验证修复有效；",
          "- 不要执行 `git push` 或合并主分支，保持修改清晰可审阅。",
        ].join("\n");

  const siblingLines =
    input.referenceProjects.length === 0
      ? "（无额外关联代码库）"
      : input.referenceProjects
          .map(
            (proj) =>
              `- **${proj.title}**: \`${proj.workspaceRoot}\`（可跨目录只读查阅接口/公共定义）`,
          )
          .join("\n");

  const imageLines =
    input.downloadedImagePaths.length === 0
      ? ""
      : [
          "",
          "### 已自动下载的内网问题截图（请用读文件工具查看图片内容辅助诊断）",
          ...input.downloadedImagePaths.map((p, idx) => `${String(idx + 1)}. \`${p}\``),
        ].join("\n");

  const recentComments =
    input.detail.comments.length === 0
      ? "（暂无历史备注）"
      : input.detail.comments
          .slice(-8)
          .map(
            (c) => `- [${c.createdAt}] **${c.actor}** (${c.action}): ${c.body || "（无文字备注）"}`,
          )
          .join("\n");

  return [
    `# 企业问题自动诊断与解决任务：${input.detail.displayKey} - ${input.detail.title}`,
    "",
    "## 1. 外部平台问题元数据",
    `- **所属产品/项目**: ${input.detail.scopeName} (#${input.detail.scopeId})`,
    `- **所属模块**: ${input.detail.moduleName ?? "未分类"}`,
    `- **问题链接**: ${input.detail.url}`,
    `- **严重度 / 优先级**: S${String(input.detail.severity ?? "-")} / P${String(input.detail.priority ?? "-")}`,
    `- **当前状态**: ${input.detail.statusLabel} (${input.detail.status})`,
    `- **创建人 / 当前指派**: ${input.detail.author ?? "-"} / ${input.detail.assignee ?? "-"}`,
    `- **影响版本**: ${input.detail.openedBuild}`,
    "",
    "## 2. 本地多代码库上下文",
    `- **当前主工作代码库**: **${input.targetProject.title}** (\`${input.targetProject.workspaceRoot}\`)`,
    "- **关联协同参考代码库**:",
    siblingLines,
    "",
    "## 3. 问题重现步骤与详情",
    input.detail.stepsMarkdown || "（问题未填写详细重现步骤，请结合标题与代码库全局检索分析）",
    imageLines,
    "",
    "## 4. 历史处理动态与备注",
    recentComments,
    "",
    "## 5. 执行要求",
    modeGuidance,
    ...(input.customInstructions?.trim()
      ? ["", "### 团队附加规范要求", input.customInstructions.trim()]
      : []),
    "",
    "## 6. 最终输出报告格式（必须严格输出以下结构化章节，系统将自动提取回写至禅道备注）",
    "请在完成全部分析（及修复验证）后的最后一条回复中，输出清晰的中文结构化报告：",
    "1. `## 问题根因分析`：说明导致该问题的准确代码位置（文件路径 + 函数/行号）与触发机理；",
    "2. `## 影响范围评估`：说明是否影响其他模块或上下游仓库；",
    "3. `## 修复方案与改动说明`：列出实际修改的文件及核心逻辑变更（只读模式下给出具体修改建议代码）；",
    "4. `## 验证结果`：说明编译、类型检查或单元测试的执行情况与结论。",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function buildCrossReviewPrompt(input: {
  readonly detail: PlatformIssueDetail;
  readonly diagnosisReport: string;
}): string {
  return [
    `# 异构大模型独立交叉审查：${input.detail.displayKey} - ${input.detail.title}`,
    "",
    "前序主力模型已在当前 Git Worktree 中完成了问题诊断与代码修复。请你作为独立审查模型执行以下检查：",
    "1. 运行 `git status` 与 `git diff` 检查当前工作区的所有代码改动；",
    "2. 核对改动是否真正解决了下述原始问题，是否存在边界遗漏、回归风险、未通过的测试或多余改动；",
    "3. 给出明确的审查结论（`【审查通过】` 或 `【需人工复核】`）以及简要审查意见。",
    "",
    "### 原始问题摘要",
    input.detail.stepsMarkdown || input.detail.title,
    "",
    "### 主力模型诊断与修复报告",
    input.diagnosisReport,
  ].join("\n");
}

function formatWriteBackComment(input: {
  readonly assignedModelLabel: string;
  readonly worktreeBranch: string | null;
  readonly diagnosisReport: string;
  readonly reviewReport: string | null;
}): string {
  const sections = [
    `## 🤖 自动诊断分析报告`,
    `- **执行模型**: \`${input.assignedModelLabel}\``,
    ...(input.worktreeBranch ? [`- **本地修复分支**: \`${input.worktreeBranch}\``] : []),
    "",
    input.diagnosisReport.trim(),
  ];
  if (input.reviewReport && input.reviewReport.trim().length > 0) {
    sections.push("", "## 🔍 异构模型交叉审查意见", input.reviewReport.trim());
  }
  sections.push("", `\`${BOT_SIGNATURE_MARKER}\``);
  return sections.join("\n");
}

function isTerminalStage(stage: IssueAutomationStage): boolean {
  return (
    stage === "completed" || stage === "needs_human" || stage === "failed" || stage === "cancelled"
  );
}

function hasRunBackgroundWork(projection: OrchestrationV2ThreadProjection, runId: RunId): boolean {
  return (
    projection.providerThreads.some((thread) =>
      thread.pendingBackgroundTasks?.some((task) => task.runId === runId),
    ) ||
    projection.subagents.some(
      (task) => task.runId === runId && isOrchestrationV2WorkActive(task.status),
    )
  );
}

export class IssueAutomationService extends Context.Service<
  IssueAutomationService,
  {
    readonly getState: Effect.Effect<IssueAutomationStateSnapshot, IssueAutomationError>;
    readonly subscribe: Stream.Stream<IssueAutomationStateSnapshot, IssueAutomationError>;
    readonly saveConnector: (
      input: IssueAutomationSaveConnectorInput,
    ) => Effect.Effect<IssueAutomationConnector, IssueAutomationError>;
    readonly deleteConnector: (
      input: IssueAutomationDeleteConnectorInput,
    ) => Effect.Effect<void, IssueAutomationError>;
    readonly refreshScopes: (
      input: IssueAutomationRefreshScopesInput,
    ) => Effect.Effect<IssueAutomationConnector, IssueAutomationError>;
    readonly listRemoteIssues: (
      input: IssueAutomationListRemoteIssuesInput,
    ) => Effect.Effect<IssueAutomationListRemoteIssuesResult, IssueAutomationError>;
    readonly scanProfileIssues: (
      input: IssueAutomationScanProfileIssuesInput,
    ) => Effect.Effect<IssueAutomationScanProfileIssuesResult, IssueAutomationError>;
    readonly getRemoteIssueDetail: (
      input: IssueAutomationGetRemoteIssueDetailInput,
    ) => Effect.Effect<IssueAutomationRemoteIssueDetail, IssueAutomationError>;
    readonly saveProfile: (
      input: IssueAutomationSaveProfileInput,
    ) => Effect.Effect<IssueAutomationProfile, IssueAutomationError>;
    readonly deleteProfile: (
      input: IssueAutomationDeleteProfileInput,
    ) => Effect.Effect<void, IssueAutomationError>;
    readonly setProfileEnabled: (
      input: IssueAutomationSetProfileEnabledInput,
    ) => Effect.Effect<IssueAutomationProfile, IssueAutomationError>;
    readonly triggerPoll: (
      input: IssueAutomationTriggerPollInput,
    ) => Effect.Effect<IssueAutomationTriggerPollResult, IssueAutomationError>;
    readonly analyzeIssues: (
      input: IssueAutomationAnalyzeIssuesInput,
    ) => Effect.Effect<IssueAutomationAnalyzeIssuesResult, IssueAutomationError>;
    readonly cancelTask: (
      input: IssueAutomationCancelTaskInput,
    ) => Effect.Effect<void, IssueAutomationError>;
    readonly writeBack: (
      input: IssueAutomationWriteBackInput,
    ) => Effect.Effect<IssueAutomationWriteBackResult, IssueAutomationError>;
  }
>()("t3/issueAutomation/IssueAutomationService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const repo = yield* IssueAutomationRepository.IssueAutomationRepository;
  const plugins = yield* PluginRegistry.IssuePlatformPluginRegistry;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflow.GitWorkflowService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const threadIssues = yield* ThreadIssueService.ThreadIssueService;
  const serviceScope = yield* Effect.scope;

  const updatesPubSub = yield* PubSub.unbounded<IssueAutomationStateSnapshot>();
  const activeTaskFibers = yield* Ref.make<ReadonlyMap<IssueAutomationTaskId, Fiber.Fiber<void>>>(
    new Map(),
  );
  const globalSemaphore = yield* Semaphore.make(3);
  const profileWrites = yield* Semaphore.make(1);
  const taskWrites = yield* Semaphore.make(1);
  const taskStarts = yield* Semaphore.make(1);
  const pendingCancellations = new Set<IssueAutomationTaskId>();
  const profileSemaphores = new Map<string, { max: number; sem: Semaphore.Semaphore }>();

  const getProfileSemaphore = Effect.fn("IssueAutomationService.getProfileSemaphore")(function* (
    profileKey: string,
    maxConcurrency: number,
  ) {
    const clamped = Math.max(1, Math.min(8, maxConcurrency));
    const existing = profileSemaphores.get(profileKey);
    if (existing && existing.max === clamped) {
      return existing.sem;
    }
    const sem = yield* Semaphore.make(clamped);
    profileSemaphores.set(profileKey, { max: clamped, sem });
    return sem;
  });

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const mapRepoErr = (operation: string) => (cause: unknown) =>
    isIssueAutomationError(cause)
      ? cause
      : new IssueAutomationError({
          operation,
          detail: cause instanceof Error ? cause.message : "持久化存储操作失败",
          cause,
        });

  const hasConnectorSecret = (id: IssueAutomationConnectorId) =>
    secrets.get(connectorSecretKey(id)).pipe(
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
    );

  const readConnectorCredentials = Effect.fn("IssueAutomationService.readConnectorCredentials")(
    function* (connectorId: IssueAutomationConnectorId) {
      const connectors = yield* repo
        .listConnectors(hasConnectorSecret)
        .pipe(Effect.mapError(mapRepoErr("readConnector")));
      const connector = connectors.find((item) => item.id === connectorId);
      if (!connector) {
        return yield* new IssueAutomationError({
          operation: "readConnector",
          detail: "未找到对应的问题平台连接配置",
        });
      }
      const storedSecret = yield* secrets
        .get(connectorSecretKey(connector.id))
        .pipe(Effect.mapError(mapRepoErr("readConnectorSecret")));
      if (Option.isNone(storedSecret)) {
        return yield* new IssueAutomationError({
          operation: "readConnectorSecret",
          detail: `平台连接 "${connector.name}" 尚未配置密码或凭据已清除`,
        });
      }
      const plugin = yield* plugins.requirePlugin(connector.platform);
      const credentials: PlatformCredentials = {
        baseUrl: connector.baseUrl,
        account: connector.account,
        secret: decoder.decode(storedSecret.value),
      };
      return { connector, plugin, credentials };
    },
  );

  const buildSnapshot: Effect.Effect<IssueAutomationStateSnapshot, IssueAutomationError> =
    Effect.gen(function* () {
      const [connectors, profiles, tasks, runningMap] = yield* Effect.all([
        repo.listConnectors(hasConnectorSecret).pipe(Effect.mapError(mapRepoErr("listConnectors"))),
        repo.listProfiles.pipe(Effect.mapError(mapRepoErr("listProfiles"))),
        repo.listTasks(1000).pipe(Effect.mapError(mapRepoErr("listTasks"))),
        Ref.get(activeTaskFibers),
      ]);
      return {
        platforms: plugins.descriptors,
        connectors,
        profiles: profiles.map(profileForClient),
        tasks,
        activeRunCount:
          runningMap.size +
          tasks.filter((task) => task.stage === "cancelling" && !runningMap.has(task.id)).length,
      };
    });

  const publishSnapshot = buildSnapshot.pipe(
    Effect.flatMap((snapshot) => PubSub.publish(updatesPubSub, snapshot)),
    Effect.ignore,
  );

  const notifyTaskEnded = Effect.fn("IssueAutomationService.notifyTaskEnded")(function* (
    task: IssueAutomationTask,
    hasConfirmedRepair: boolean,
  ) {
    if (!task.profileId) return;
    const profileId = task.profileId;
    const getWebhook = Effect.gen(function* () {
      const profile = yield* repo.getProfile(profileId);
      if (
        !profile?.feishuNotification?.enabled ||
        !profile.feishuWebhookSecretId ||
        profile.connectorId !== task.connectorId ||
        profile.scopeId !== task.scopeId
      )
        return;
      const webhook = yield* secrets.get(profile.feishuWebhookSecretId);
      return Option.isSome(webhook) ? decoder.decode(webhook.value) : "";
    }).pipe(profileWrites.withPermits(1));
    const delivered = yield* sendFeishuTaskNotification(httpClient, getWebhook, task, {
      appDisplayName: config.desktopAppDisplayName ?? T3_APP_BASE_NAME,
      hasConfirmedRepair,
    });
    if (!delivered) {
      yield* repo
        .appendTaskStep(task.id, {
          at: yield* nowIso,
          stage: task.stage,
          message: "飞书通知发送失败，请检查值守规则中的群机器人 Webhook",
        })
        .pipe(Effect.ignore);
    }
  });

  const updateTaskState = Effect.fn("IssueAutomationService.updateTaskState")(function* (
    task: IssueAutomationTask,
    patch: Partial<IssueAutomationTask>,
    stepMessage?: {
      readonly stage?: IssueAutomationStage;
      readonly modelLabel?: string;
      readonly message: string;
    },
  ) {
    const updated = yield* taskWrites.withPermits(1)(
      Effect.gen(function* () {
        const latest =
          (yield* repo.getTask(task.id).pipe(Effect.mapError(mapRepoErr("getTask")))) ?? task;
        const nextStage = patch.stage ?? latest.stage;
        if (
          nextStage !== latest.stage &&
          (isTerminalStage(latest.stage) ||
            (latest.stage === "cancelling" && nextStage !== "cancelled"))
        ) {
          return latest;
        }
        const at = yield* nowIso;
        const updated: IssueAutomationTask = {
          ...latest,
          ...patch,
          stage: nextStage,
          steps: stepMessage
            ? [
                ...latest.steps,
                {
                  at,
                  stage: stepMessage.stage ?? nextStage,
                  ...(stepMessage.modelLabel ? { modelLabel: stepMessage.modelLabel } : {}),
                  message: stepMessage.message,
                },
              ]
            : (patch.steps ?? latest.steps),
          updatedAt: at,
          completedAt:
            patch.completedAt !== undefined
              ? patch.completedAt
              : isTerminalStage(nextStage)
                ? (latest.completedAt ?? at)
                : latest.completedAt,
        };
        yield* repo.upsertTask(updated).pipe(Effect.mapError(mapRepoErr("upsertTask")));
        return updated;
      }),
    );
    yield* publishSnapshot;
    return updated;
  });

  const downloadIssueImages = Effect.fn("IssueAutomationService.downloadIssueImages")(function* (
    plugin: IssuePlatformPlugin,
    credentials: PlatformCredentials,
    taskId: IssueAutomationTaskId,
    imageUrls: ReadonlyArray<string>,
  ) {
    if (!plugin.downloadAttachment || imageUrls.length === 0) return [] as string[];
    const targetDir = NodePath.join(config.stateDir, "issue-automation-assets", taskId);
    yield* Effect.sync(() => NodeFS.mkdirSync(targetDir, { recursive: true }));
    const downloaded: string[] = [];
    for (const [idx, url] of imageUrls.slice(0, 6).entries()) {
      const assetResult = yield* Effect.result(plugin.downloadAttachment({ credentials, url }));
      if (assetResult._tag === "Success") {
        const safeName = `screenshot-${String(idx + 1)}-${assetResult.success.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const fullPath = NodePath.join(targetDir, safeName);
        yield* Effect.sync(() => NodeFS.writeFileSync(fullPath, assetResult.success.bytes));
        downloaded.push(fullPath);
      }
    }
    return downloaded;
  });

  const runModelTurnAndExtractText = Effect.fn("IssueAutomationService.runModelTurnAndExtractText")(
    function* (input: {
      readonly projectId: ProjectId;
      readonly title: string;
      readonly modelSelection: ModelSelection;
      readonly workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy;
      readonly prompt: string;
      readonly summary: IssueAutomationMessageSummary;
      readonly existingThreadId?: ThreadId | undefined;
      readonly onStarted: (
        threadId: ThreadId,
        runId: RunId,
      ) => Effect.Effect<void, IssueAutomationError>;
    }) {
      const commandId = CommandId.make(`issue-automation:${NodeCrypto.randomUUID()}`);
      const messageId = MessageId.make(NodeCrypto.randomUUID());
      const message = {
        messageId,
        text: input.prompt,
        attachments: [],
        context: { version: 1, records: [], issueAutomation: input.summary },
      } as const;
      const sender = {
        commandId,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        createdBy: "user",
        creationSource: "web",
      } as const;
      // A cancel can interrupt the wait once the accepted run can be addressed by id.
      const { threadId, runId } = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          let threadId: ThreadId;
          let runId: RunId | undefined;
          if (input.existingThreadId !== undefined) {
            threadId = input.existingThreadId;
            const sent = yield* threadManagement.sendToThread({
              ...sender,
              ...message,
              threadId,
              mode: "queue",
              freshContext: true,
            });
            runId = sent.run.id;
          } else {
            const launched = yield* threadLaunch.launch({
              ...sender,
              title: input.title,
              runtimeMode: "full-access",
              interactionMode: "default",
              workspaceStrategy: input.workspaceStrategy,
              initialMessage: message,
            });
            threadId = launched.threadId;
            runId = launched.projection.runs.find((run) => run.userMessageId === messageId)?.id;
          }
          if (runId === undefined) {
            return yield* new IssueAutomationError({
              operation: "runModelTurn",
              detail: "未找到刚启动的模型轮次",
            });
          }
          yield* input.onStarted(threadId, runId);
          return { threadId, runId };
        }),
      );

      const waited = yield* threadManagement.waitForThread({
        projectId: input.projectId,
        threadId,
        runId,
        timeoutMs: THREAD_WAIT_TIMEOUT_MS,
        untilDelegatedWorkSettled: true,
      });

      const projection = yield* threadManagement.getThreadProjection(threadId);
      const result = waited.resultRun;
      const resultMessage = projection.messages.find(
        (message) => message.id === result?.userMessageId,
      );
      const terminalRun =
        result &&
        (input.existingThreadId === undefined ||
          result.userMessageId === messageId ||
          resultMessage?.delegatedCompletion?.parentRunId === runId)
          ? result
          : waited.run;
      const assistantMessages = projection.messages.filter(
        (m) => m.runId === terminalRun?.id && m.role === "assistant" && m.text.trim().length > 0,
      );
      const latestText = assistantMessages.at(-1)?.text.trim() ?? "";

      if (waited.timedOut) {
        return yield* new IssueAutomationError({
          operation: "runModelTurn",
          detail: "模型执行超时（超过 25 分钟）",
        });
      }
      if (
        terminalRun &&
        (terminalRun.status === "failed" ||
          terminalRun.status === "cancelled" ||
          terminalRun.status === "interrupted") &&
        latestText.length === 0
      ) {
        return yield* new IssueAutomationError({
          operation: "runModelTurn",
          detail: `模型会话以状态 ${terminalRun.status} 结束`,
        });
      }
      return {
        threadId,
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
        reportText: latestText || "（模型已完成运行，请点击关联会话查看详细操作记录）",
        hasConfirmedChanges:
          terminalRun?.status === "completed" &&
          projection.checkpoints.some(
            (checkpoint) =>
              checkpoint.runId === terminalRun.id &&
              checkpoint.status === "ready" &&
              (checkpoint.filesTotal?.count ?? checkpoint.files.length) > 0,
          ),
      };
    },
  );

  const executeTaskPipeline = Effect.fn("IssueAutomationService.executeTaskPipeline")(function* (
    initialTask: IssueAutomationTask,
    binding: IssueAutomationRepoBinding,
    models: IssueAutomationModelStrategy,
    policy: IssueAutomationPolicy,
    maxConcurrency: number,
    retry?: { readonly threadId: ThreadId | null; readonly attemptNumber: number },
  ) {
    const profileSem = yield* getProfileSemaphore(
      initialTask.profileId ?? initialTask.connectorId,
      maxConcurrency,
    );

    let current = initialTask;
    const recordPrimaryRun = Effect.fn("IssueAutomationService.recordPrimaryRun")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      current = yield* updateTaskState(current, { primaryThreadId: threadId, primaryRunId: runId });
    });
    const recordReviewRun = Effect.fn("IssueAutomationService.recordReviewRun")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      current = yield* updateTaskState(current, { reviewThreadId: threadId, reviewRunId: runId });
    });
    let hasConfirmedRepair = false;
    const withGlobalPermit = globalSemaphore.withPermits(1);
    const finishedTask = yield* withGlobalPermit(
      profileSem.withPermits(1)(
        Effect.gen(function* () {
          current = yield* updateTaskState(
            initialTask,
            { stage: "enriching", lastError: null },
            {
              stage: "enriching",
              message: `正在从平台拉取 ${initialTask.displayKey} 完整详情与报错截图...`,
            },
          );
          if (current.stage === "cancelling" || isTerminalStage(current.stage)) return current;

          const { connector, plugin, credentials } = yield* readConnectorCredentials(
            current.connectorId,
          );
          const detail = yield* plugin.getIssueDetail({
            credentials,
            scopeId: current.scopeId,
            issueKey: current.issueKey,
          });

          const issueDetails = {
            issueTitle: detail.title,
            issueUrl: detail.url,
            moduleName: detail.moduleName,
            severity: detail.severity,
            priority: detail.priority,
            issueStatus: detail.status,
            assignee: detail.assignee,
            remoteUpdatedMarker: detail.updatedAt,
          };
          const downloadedImages = yield* downloadIssueImages(
            plugin,
            credentials,
            current.id,
            detail.imageUrls,
          );

          // Step 2: Multi-Repository Routing
          current = yield* updateTaskState(
            current,
            { ...issueDetails, stage: "routing" },
            {
              stage: "routing",
              ...(models.triageModel ? { modelLabel: formatModelLabel(models.triageModel) } : {}),
              message:
                downloadedImages.length > 0
                  ? `已解析详情并下载 ${String(downloadedImages.length)} 张内网截图，正在执行多代码库定位...`
                  : "已拉取完整重现步骤与历史记录，正在匹配目标本地代码库...",
            },
          );

          const allProjects = yield* projects
            .listShells()
            .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<OrchestrationProjectShell>));

          const route = retry
            ? {
                targetProjectId: binding.primaryProjectId,
                referenceProjectIds: binding.linkedProjectIds.filter(
                  (id) => id !== binding.primaryProjectId,
                ),
                matchedReason: "沿用上次诊断的代码库",
              }
            : resolveTargetRepositories({
                binding,
                availableProjects: allProjects,
                moduleName: detail.moduleName,
                issueTitle: detail.title,
                stepsMarkdown: detail.stepsMarkdown,
              });

          const targetProject = allProjects.find((p) => p.id === route.targetProjectId);
          if (!targetProject) {
            return yield* updateTaskState(
              current,
              {
                stage: "failed",
                lastError: "未找到已绑定的本地代码库，请检查项目绑定配置",
              },
              { stage: "failed", message: "定位本地代码库失败：目标仓库不存在或已移除" },
            );
          }

          const referenceProjects = route.referenceProjectIds
            .map((id) => allProjects.find((p) => p.id === id))
            .filter((p): p is OrchestrationProjectShell => p !== undefined);

          // Step 3: Select Primary / High-Severity Model & Prepare Worktree Strategy
          const chosenPrimaryModel =
            detail.severity !== null && detail.severity <= 2 && models.highSeverityModel !== null
              ? models.highSeverityModel
              : models.primaryModel;
          const chosenModelLabel = formatModelLabel(chosenPrimaryModel);

          const slugTick = yield* Clock.currentTimeMillis;
          const branchSlug = `fix/${connector.platform}-${detail.key}-${String(slugTick).slice(-5)}`;
          let workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy = {
            type: "root",
          };
          if (policy.actionMode !== "diagnose_only") {
            const currentBranch = yield* git
              .currentBranch(targetProject.workspaceRoot)
              .pipe(Effect.orElseSucceed(() => null));
            const baseRef = policy.baseBranch?.trim() || currentBranch || "HEAD";
            workspaceStrategy = {
              type: "worktree",
              baseRef,
              branch: branchSlug,
              startFromOrigin: false,
            };
          }

          current = yield* updateTaskState(
            current,
            {
              stage: "diagnosing",
              targetProjectId: targetProject.id,
              referenceProjectIds: [...route.referenceProjectIds],
              assignedModelLabel: chosenModelLabel,
              worktreeBranch: policy.actionMode === "diagnose_only" ? null : branchSlug,
            },
            {
              stage: "diagnosing",
              modelLabel: chosenModelLabel,
              message: `${route.matchedReason} -> [${targetProject.title}]，已调度模型 ${chosenModelLabel} 开始深度分析${policy.actionMode === "diagnose_only" ? "" : `（隔离分支 ${branchSlug}）`}`,
            },
          );
          if (current.stage === "cancelling" || isTerminalStage(current.stage)) return current;

          const prompt = buildDiagnosisPrompt({
            detail,
            actionMode: policy.actionMode,
            targetProject,
            referenceProjects,
            downloadedImagePaths: downloadedImages,
            customInstructions: policy.customPromptInstructions,
          });
          const summary = {
            mode: policy.actionMode === "diagnose_only" ? "diagnose" : "repair",
            scopeName: detail.scopeName,
            moduleName: detail.moduleName,
            platform: connector.platform,
            issueKey: detail.displayKey,
            issueUrl: detail.url,
            ...(retry === undefined ? {} : { attemptNumber: retry.attemptNumber }),
          } satisfies IssueAutomationMessageSummary;

          const threadTitle = `[自动诊断] ${detail.displayKey} ${detail.title.slice(0, 60)}`;
          let primaryOutcome = yield* Effect.result(
            runModelTurnAndExtractText({
              projectId: targetProject.id,
              title: threadTitle,
              modelSelection: chosenPrimaryModel,
              workspaceStrategy,
              prompt,
              summary,
              existingThreadId: retry?.threadId ?? undefined,
              onStarted: recordPrimaryRun,
            }),
          );

          // Automatic Failover to Fallback Model if primary model failed
          if (primaryOutcome._tag === "Failure" && models.fallbackModel !== null) {
            const fallbackLabel = formatModelLabel(models.fallbackModel);
            const fbTick = yield* Clock.currentTimeMillis;
            const fallbackBranch =
              policy.actionMode === "diagnose_only"
                ? null
                : `fix/${connector.platform}-${detail.key}-fb-${String(fbTick).slice(-4)}`;
            const fallbackWorkspace: ThreadLaunchService.ThreadLaunchWorkspaceStrategy =
              fallbackBranch === null
                ? { type: "root" }
                : {
                    type: "worktree",
                    baseRef:
                      workspaceStrategy.type === "worktree" ? workspaceStrategy.baseRef : "HEAD",
                    branch: fallbackBranch,
                    startFromOrigin: false,
                  };

            current = yield* updateTaskState(
              current,
              { assignedModelLabel: fallbackLabel, worktreeBranch: fallbackBranch },
              {
                stage: "diagnosing",
                modelLabel: fallbackLabel,
                message: `主模型执行异常（${primaryOutcome.failure instanceof Error ? primaryOutcome.failure.message : String(primaryOutcome.failure)}），自动降级切换至备用模型 ${fallbackLabel}`,
              },
            );

            primaryOutcome = yield* Effect.result(
              runModelTurnAndExtractText({
                projectId: targetProject.id,
                title: threadTitle,
                modelSelection: models.fallbackModel,
                workspaceStrategy: fallbackWorkspace,
                prompt,
                summary,
                existingThreadId: retry?.threadId ?? undefined,
                onStarted: recordPrimaryRun,
              }),
            );
          }

          if (primaryOutcome._tag === "Failure") {
            const errMsg =
              primaryOutcome.failure instanceof Error
                ? primaryOutcome.failure.message
                : String(primaryOutcome.failure);
            return yield* updateTaskState(
              current,
              { stage: "failed", lastError: errMsg },
              { stage: "failed", message: `模型诊断执行失败: ${errMsg}` },
            );
          }

          const solved = primaryOutcome.success;
          hasConfirmedRepair =
            policy.actionMode !== "diagnose_only" &&
            solved.worktreePath !== null &&
            solved.hasConfirmedChanges;

          // Link issue to the T3 Thread for seamless cross-navigation in native UI
          yield* threadIssues
            .link({
              threadId: solved.threadId,
              ref: {
                projectId: targetProject.id,
                tracker: IssueTrackerKind.make(connector.platform),
                host: extractHostFromUrl(connector.baseUrl),
                scope: detail.scopeId,
                key: detail.key,
              },
              url: detail.url,
              displayKey: detail.displayKey,
              title: detail.title,
              source: "agent",
            })
            .pipe(Effect.ignore);

          current = yield* updateTaskState(
            current,
            {
              primaryThreadId: solved.threadId,
              worktreeBranch: solved.branch ?? current.worktreeBranch,
              diagnosisReport: solved.reportText,
            },
            {
              stage: "diagnosing",
              modelLabel: current.assignedModelLabel,
              message: "主力模型已完成根因定位与验证，已生成结构化诊断报告",
            },
          );

          // Step 4: Optional Cross-Review by a Second Heterogeneous Model
          let reviewReport: string | null = null;
          let reviewThreadId: ThreadId | null = null;
          if (
            models.reviewModel !== null &&
            policy.actionMode !== "diagnose_only" &&
            solved.worktreePath !== null
          ) {
            const reviewLabel = formatModelLabel(models.reviewModel);
            current = yield* updateTaskState(
              current,
              { stage: "reviewing" },
              {
                stage: "reviewing",
                modelLabel: reviewLabel,
                message: `正在唤醒异构审查模型 ${reviewLabel} 对修复代码 Diff 与根因结论进行交叉审查...`,
              },
            );

            const reviewOutcome = yield* Effect.result(
              runModelTurnAndExtractText({
                projectId: targetProject.id,
                title: `[交叉审查] ${detail.displayKey} ${detail.title.slice(0, 50)}`,
                modelSelection: models.reviewModel,
                workspaceStrategy: {
                  type: "existing_worktree",
                  worktreePath: solved.worktreePath,
                  ...(solved.branch ? { branch: solved.branch } : {}),
                },
                prompt: buildCrossReviewPrompt({
                  detail,
                  diagnosisReport: solved.reportText,
                }),
                summary: { ...summary, mode: "review" },
                onStarted: recordReviewRun,
              }),
            );

            if (reviewOutcome._tag === "Success") {
              reviewReport = reviewOutcome.success.reportText;
              reviewThreadId = reviewOutcome.success.threadId;
              current = yield* updateTaskState(
                current,
                { reviewThreadId, reviewReport },
                {
                  stage: "reviewing",
                  modelLabel: reviewLabel,
                  message: "异构模型交叉审查完成",
                },
              );
            } else {
              current = yield* updateTaskState(
                current,
                {},
                {
                  stage: "reviewing",
                  modelLabel: reviewLabel,
                  message: "交叉审查模型未能完成，保留主模型报告继续后续流程",
                },
              );
            }
          }

          const needsHumanReview = reviewReport !== null && reviewReport.includes("【需人工复核】");

          // Step 5: Write-back to ZenTao / Issue Platform
          if (policy.autoWriteComment) {
            current = yield* updateTaskState(
              current,
              { stage: "writing_back" },
              { stage: "writing_back", message: "正在将结构化诊断报告写回问题平台..." },
            );

            const formattedComment = formatWriteBackComment({
              assignedModelLabel: current.assignedModelLabel,
              worktreeBranch: current.worktreeBranch,
              diagnosisReport: solved.reportText,
              reviewReport,
            });

            if (policy.actionMode === "auto_resolve" && !needsHumanReview) {
              const wbResult = yield* Effect.result(
                plugin.writeBack({
                  credentials,
                  action: {
                    kind: "resolve",
                    issueKey: detail.key,
                    resolution: "fixed",
                    resolvedBuild: detail.openedBuild || "trunk",
                    comment: formattedComment,
                  },
                }),
              );
              const syncedAt = yield* nowIso;
              if (wbResult._tag === "Success") {
                return yield* updateTaskState(
                  current,
                  {
                    stage: "completed",
                    commentSyncedAt: syncedAt,
                    stateSyncedAt: syncedAt,
                    issueStatus: "resolved",
                  },
                  {
                    stage: "completed",
                    message: "已自动回写诊断报告并将平台问题状态标记为「已解决」",
                  },
                );
              }
            }

            const commentRes = yield* Effect.result(
              plugin.writeBack({
                credentials,
                action: {
                  kind: "comment",
                  issueKey: detail.key,
                  comment: formattedComment,
                },
              }),
            );
            const syncedAt = yield* nowIso;
            if (commentRes._tag === "Success") {
              const finalStage: IssueAutomationStage = needsHumanReview
                ? "needs_human"
                : "completed";
              return yield* updateTaskState(
                current,
                { stage: finalStage, commentSyncedAt: syncedAt },
                {
                  stage: finalStage,
                  message: needsHumanReview
                    ? "已将诊断报告写回平台备注（交叉审查建议人工复核代码修改）"
                    : "已成功将诊断分析报告自动写回平台评论",
                },
              );
            }
          }

          const finalStage: IssueAutomationStage = needsHumanReview ? "needs_human" : "completed";
          return yield* updateTaskState(
            current,
            { stage: finalStage },
            {
              stage: finalStage,
              message: "本地自动诊断与修复已完成，可在工作台预览并一键同步至平台",
            },
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : updateTaskState(
                  current,
                  {
                    stage: "failed",
                    lastError: Cause.pretty(cause).slice(0, 400),
                  },
                  {
                    stage: "failed",
                    message: `执行过程中发生异常: ${Cause.pretty(cause).slice(0, 200)}`,
                  },
                ),
          ),
          Effect.option,
        ),
      ),
    );
    if (Option.isSome(finishedTask) && isTerminalStage(finishedTask.value.stage)) {
      yield* notifyTaskEnded(finishedTask.value, hasConfirmedRepair);
    }
  });

  const spawnTaskExecution = Effect.fn("IssueAutomationService.spawnTaskExecution")(function* (
    task: IssueAutomationTask,
    binding: IssueAutomationRepoBinding,
    models: IssueAutomationModelStrategy,
    policy: IssueAutomationPolicy,
    maxConcurrency: number,
    retry?: { readonly threadId: ThreadId | null; readonly attemptNumber: number },
  ) {
    const registered = yield* Deferred.make<void>();
    const fiber = yield* Deferred.await(registered).pipe(
      Effect.andThen(executeTaskPipeline(task, binding, models, policy, maxConcurrency, retry)),
      Effect.ensuring(
        Ref.update(activeTaskFibers, (current) => {
          const next = new Map(current);
          next.delete(task.id);
          return next;
        }).pipe(Effect.andThen(publishSnapshot)),
      ),
      Effect.interruptible,
      Effect.forkIn(serviceScope),
    );

    yield* Ref.update(activeTaskFibers, (current) => {
      const next = new Map(current);
      next.set(task.id, fiber);
      return next;
    });
    yield* Deferred.succeed(registered, undefined);
    yield* publishSnapshot;
  }, Effect.uninterruptible);

  const enrichRemoteIssuesWithTasks = (
    connectorId: IssueAutomationConnectorId,
    platform: IssueAutomationConnector["platform"],
    items: ReadonlyArray<PlatformIssueSummary>,
    existingTasks: ReadonlyArray<IssueAutomationTask>,
  ): IssueAutomationRemoteIssue[] => {
    const latestByKey = new Map<string, IssueAutomationTask>();
    for (const task of existingTasks) {
      if (task.connectorId !== connectorId) continue;
      if (!latestByKey.has(task.issueKey)) {
        latestByKey.set(task.issueKey, task);
      }
    }
    return items.map((item) => {
      const matched = latestByKey.get(item.key);
      return {
        connectorId,
        platform,
        scopeId: item.scopeId,
        scopeName: item.scopeName,
        key: item.key,
        displayKey: item.displayKey,
        title: item.title,
        url: item.url,
        moduleId: item.moduleId,
        moduleName: item.moduleName,
        severity: item.severity,
        priority: item.priority,
        status: item.status,
        statusLabel: item.statusLabel,
        confirmed: item.confirmed,
        author: item.author,
        assignee: item.assignee,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        latestTaskId: matched?.id ?? null,
        latestStage: matched?.stage ?? null,
      };
    });
  };

  const pollSingleProfile = Effect.fn("IssueAutomationService.pollSingleProfile")(function* (
    profile: IssueAutomationProfile,
  ) {
    const polledAt = yield* nowIso;
    const credResult = yield* Effect.result(readConnectorCredentials(profile.connectorId));
    if (credResult._tag === "Failure") {
      yield* repo
        .recordProfilePoll(profile.id, polledAt, credResult.failure.detail)
        .pipe(Effect.ignore);
      yield* publishSnapshot;
      return { enqueuedCount: 0, skippedCount: 0 };
    }

    const { connector, plugin, credentials } = credResult.success;
    const pageResult = yield* Effect.result(
      plugin.listIssues({
        credentials,
        scopeId: profile.scopeId,
        browseType: profile.filter.browseType,
        keyword: profile.filter.keyword ?? undefined,
        page: 1,
        pageSize: 30,
      }),
    );

    if (pageResult._tag === "Failure") {
      yield* repo
        .recordProfilePoll(profile.id, polledAt, pageResult.failure.detail)
        .pipe(Effect.ignore);
      yield* publishSnapshot;
      return { enqueuedCount: 0, skippedCount: 0 };
    }

    yield* repo.recordProfilePoll(profile.id, polledAt, null).pipe(Effect.ignore);

    const existingTasks = yield* repo.listTasks(300).pipe(Effect.orElseSucceed(() => []));
    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const item of pageResult.success.items) {
      if (item.status === "closed" || item.status === "resolved") {
        skippedCount += 1;
        continue;
      }
      if (!matchesIssueAutomationFilter(item, profile.filter)) {
        skippedCount += 1;
        continue;
      }

      // Idempotent deduplication: skip if already active OR already processed at this updatedAt
      const priorForIssue = existingTasks.filter(
        (t) => t.connectorId === connector.id && t.issueKey === item.key,
      );
      const hasActive = priorForIssue.some((t) => !isTerminalStage(t.stage));
      const alreadyHandledVersion = priorForIssue.some(
        (t) =>
          (t.stage === "completed" || t.stage === "needs_human") &&
          (t.remoteUpdatedMarker === item.updatedAt || t.commentSyncedAt !== null),
      );
      if (hasActive || alreadyHandledVersion) {
        skippedCount += 1;
        continue;
      }

      // Double-check latest comment for bot signature anti-loop protection
      const detailCheck = yield* Effect.result(
        plugin.getIssueDetail({ credentials, scopeId: profile.scopeId, issueKey: item.key }),
      );
      if (
        detailCheck._tag === "Success" &&
        detailCheck.success.comments.some((c) => c.body.includes(BOT_SIGNATURE_MARKER))
      ) {
        skippedCount += 1;
        continue;
      }

      const taskId = IssueAutomationTaskId.make(NodeCrypto.randomUUID());
      const createdAt = yield* nowIso;
      const modelLabel = formatModelLabel(profile.models.primaryModel);
      const task: IssueAutomationTask = {
        id: taskId,
        profileId: profile.id,
        connectorId: connector.id,
        platform: connector.platform,
        scopeId: profile.scopeId,
        scopeName: profile.scopeName,
        issueKey: item.key,
        displayKey: item.displayKey,
        issueTitle: item.title,
        issueUrl: item.url,
        moduleName: item.moduleName,
        severity: item.severity,
        priority: item.priority,
        issueStatus: item.status,
        assignee: item.assignee,
        trigger: "poll",
        actionMode: profile.policy.actionMode,
        stage: "queued",
        targetProjectId: profile.repositories.primaryProjectId,
        referenceProjectIds: profile.repositories.linkedProjectIds.filter(
          (id) => id !== profile.repositories.primaryProjectId,
        ),
        primaryThreadId: null,
        reviewThreadId: null,
        assignedModelLabel: modelLabel,
        worktreeBranch: null,
        diagnosisReport: null,
        reviewReport: null,
        commentSyncedAt: null,
        stateSyncedAt: null,
        remoteUpdatedMarker: item.updatedAt,
        lastError: null,
        steps: [
          {
            at: createdAt,
            stage: "queued",
            modelLabel,
            message: `无人值守轮询发现新问题（规则：${profile.name}），已加入自动诊断队列`,
          },
        ],
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      };
      const enqueued = yield* taskStarts.withPermits(1)(
        Effect.gen(function* () {
          const latest = yield* repo
            .listIssueTasks(connector.id, item.key)
            .pipe(Effect.mapError(mapRepoErr("listIssueTasks")));
          if (latest.some((previous) => !isTerminalStage(previous.stage))) return false;
          yield* repo.upsertTask(task).pipe(Effect.mapError(mapRepoErr("enqueuePollTask")));
          yield* spawnTaskExecution(
            task,
            profile.repositories,
            profile.models,
            profile.policy,
            profile.filter.maxConcurrency,
          );
          return true;
        }),
      );
      if (enqueued) enqueuedCount += 1;
      else skippedCount += 1;
    }

    return { enqueuedCount, skippedCount };
  });

  yield* Effect.gen(function* () {
    const profiles = yield* repo.listProfiles.pipe(Effect.orElseSucceed(() => []));
    const nowMs = yield* Clock.currentTimeMillis;
    for (const profile of profiles) {
      if (!profile.enabled) continue;
      const lastMs = profile.lastPolledAt ? Date.parse(profile.lastPolledAt) : 0;
      const intervalMs = profile.filter.pollIntervalMinutes * 60 * 1000;
      if (!Number.isFinite(lastMs) || nowMs - lastMs >= intervalMs) {
        yield* pollSingleProfile(profile).pipe(Effect.ignore);
      }
    }
  }).pipe(
    Effect.repeat(Schedule.spaced(POLL_TICK_INTERVAL)),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  const saveConnector: IssueAutomationService["Service"]["saveConnector"] = Effect.fn(
    "IssueAutomationService.saveConnector",
  )(function* (input) {
    const plugin = yield* plugins.requirePlugin(input.platform);
    const connectorId = input.id ?? IssueAutomationConnectorId.make(NodeCrypto.randomUUID());
    const normalizedUrl = plugin.normalizeBaseUrl(input.baseUrl);

    let secretText = input.secret?.trim();
    if (!secretText) {
      const existing = yield* secrets
        .get(connectorSecretKey(connectorId))
        .pipe(Effect.mapError(mapRepoErr("readStoredConnectorSecret")));
      if (Option.isNone(existing)) {
        return yield* new IssueAutomationError({
          operation: "saveConnector",
          detail: "首次连接请输入平台密码或认证令牌",
        });
      }
      secretText = decoder.decode(existing.value);
    }

    const probe = yield* plugin.probeAndListScopes({
      baseUrl: normalizedUrl,
      account: input.account.trim(),
      secret: secretText,
    });

    yield* secrets
      .set(connectorSecretKey(connectorId), encoder.encode(secretText))
      .pipe(Effect.mapError(mapRepoErr("storeConnectorSecret")));

    const updatedAt = yield* nowIso;
    const connector: IssueAutomationConnector = {
      id: connectorId,
      platform: input.platform,
      name: input.name.trim(),
      baseUrl: probe.normalizedBaseUrl,
      account: input.account.trim(),
      hasSecret: true,
      status: "connected",
      viewerName: probe.viewerName,
      serverVersion: probe.serverVersion,
      statusDetail: null,
      scopes: [...probe.scopes],
      updatedAt,
    };
    yield* repo.upsertConnector(connector).pipe(Effect.mapError(mapRepoErr("saveConnector")));
    yield* publishSnapshot;
    return connector;
  });

  const deleteConnector: IssueAutomationService["Service"]["deleteConnector"] = Effect.fn(
    "IssueAutomationService.deleteConnector",
  )(
    function* (input) {
      const profiles = yield* repo.listProfiles.pipe(Effect.mapError(mapRepoErr("listProfiles")));
      yield* repo
        .deleteConnector(input.connectorId)
        .pipe(Effect.mapError(mapRepoErr("deleteConnector")));
      yield* secrets.remove(connectorSecretKey(input.connectorId)).pipe(Effect.ignore);
      for (const profile of profiles) {
        if (profile.connectorId === input.connectorId && profile.feishuWebhookSecretId) {
          yield* secrets.remove(profile.feishuWebhookSecretId).pipe(Effect.ignore);
        }
      }
      yield* publishSnapshot;
    },
    Effect.uninterruptible,
    profileWrites.withPermits(1),
  );

  const refreshScopes: IssueAutomationService["Service"]["refreshScopes"] = Effect.fn(
    "IssueAutomationService.refreshScopes",
  )(function* (input) {
    const { connector, plugin, credentials } = yield* readConnectorCredentials(input.connectorId);
    const probeResult = yield* Effect.result(plugin.probeAndListScopes(credentials));
    const updatedAt = yield* nowIso;

    const updated: IssueAutomationConnector =
      probeResult._tag === "Success"
        ? {
            ...connector,
            baseUrl: probeResult.success.normalizedBaseUrl,
            status: "connected",
            viewerName: probeResult.success.viewerName,
            serverVersion: probeResult.success.serverVersion,
            statusDetail: null,
            scopes: [...probeResult.success.scopes],
            updatedAt,
          }
        : {
            ...connector,
            status: "error",
            statusDetail: probeResult.failure.detail,
            updatedAt,
          };

    yield* repo.upsertConnector(updated).pipe(Effect.mapError(mapRepoErr("refreshScopes")));
    yield* publishSnapshot;
    if (probeResult._tag === "Failure") {
      return yield* probeResult.failure;
    }
    return updated;
  });

  const listRemoteIssues: IssueAutomationService["Service"]["listRemoteIssues"] = Effect.fn(
    "IssueAutomationService.listRemoteIssues",
  )(function* (input) {
    const { connector, plugin, credentials } = yield* readConnectorCredentials(input.connectorId);
    const page = yield* plugin.listIssues({
      credentials,
      scopeId: input.scopeId,
      browseType: input.browseType ?? "unresolved",
      keyword: input.keyword,
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 25,
    });
    const tasks = yield* repo.listTasks(250).pipe(Effect.orElseSucceed(() => []));
    return {
      issues: enrichRemoteIssuesWithTasks(connector.id, connector.platform, page.items, tasks),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  });

  const scanProfileIssues: IssueAutomationService["Service"]["scanProfileIssues"] = Effect.fn(
    "IssueAutomationService.scanProfileIssues",
  )(function* (input) {
    const profile = yield* repo
      .getProfile(input.profileId)
      .pipe(Effect.mapError(mapRepoErr("getProfile")));
    if (!profile) {
      return yield* new IssueAutomationError({
        operation: "scanProfileIssues",
        detail: "未找到对应的自动分析策略配置",
      });
    }
    const { connector, plugin, credentials } = yield* readConnectorCredentials(profile.connectorId);
    const { items, hasNextPage } = yield* scanIssueAutomationPage(
      input.page ?? 1,
      profile.filter,
      (page, pageSize) =>
        plugin.listIssues({
          credentials,
          scopeId: profile.scopeId,
          browseType: profile.filter.browseType,
          keyword: profile.filter.keyword ?? undefined,
          page,
          pageSize,
        }),
    );
    const tasks = yield* repo.listTasks(250).pipe(Effect.orElseSucceed(() => []));
    return {
      issues: enrichRemoteIssuesWithTasks(connector.id, connector.platform, items, tasks),
      hasNextPage,
    };
  });

  const getRemoteIssueDetail: IssueAutomationService["Service"]["getRemoteIssueDetail"] = Effect.fn(
    "IssueAutomationService.getRemoteIssueDetail",
  )(function* (input) {
    const { connector, plugin, credentials } = yield* readConnectorCredentials(input.connectorId);
    const detail = yield* plugin.getIssueDetail({
      credentials,
      scopeId: input.scopeId,
      issueKey: input.issueKey,
    });
    const tasks = yield* repo.listTasks(250).pipe(Effect.orElseSucceed(() => []));
    const [enriched] = enrichRemoteIssuesWithTasks(
      connector.id,
      connector.platform,
      [detail],
      tasks,
    );
    return {
      ...enriched!,
      stepsHtml: detail.stepsHtml,
      stepsMarkdown: detail.stepsMarkdown,
      imageUrls: [...detail.imageUrls],
      openedBuild: detail.openedBuild,
      availableBuilds: [...detail.availableBuilds],
      availableUsers: [...detail.availableUsers],
      comments: [...detail.comments],
    };
  });

  const saveProfile: IssueAutomationService["Service"]["saveProfile"] = Effect.fn(
    "IssueAutomationService.saveProfile",
  )(
    function* (input) {
      const prev = input.id
        ? yield* repo.getProfile(input.id).pipe(Effect.mapError(mapRepoErr("getProfile")))
        : undefined;
      const prevSecretId = prev?.feishuWebhookSecretId ?? null;
      const draft = input.feishuNotification?.webhook;
      const webhook = draft === undefined ? "" : Redacted.value(draft).trim();
      const notificationEnabled =
        input.feishuNotification?.enabled ?? prev?.feishuNotification?.enabled ?? false;
      if (
        (webhook && !isIssueAutomationFeishuWebhook(webhook)) ||
        (notificationEnabled && !webhook && !prevSecretId)
      ) {
        return yield* new IssueAutomationError({
          operation: "saveProfile",
          detail: "请输入有效的飞书群机器人 Webhook",
        });
      }
      const replacementSecretId = webhook
        ? `issue-automation-feishu-${NodeCrypto.randomUUID()}`
        : null;
      const feishuWebhookSecretId = replacementSecretId ?? prevSecretId;
      const profile: IssueAutomationRepository.StoredProfile = {
        id: input.id ?? IssueAutomationProfileId.make(NodeCrypto.randomUUID()),
        connectorId: input.connectorId,
        name: input.name.trim(),
        enabled: input.enabled,
        scopeId: input.scopeId,
        scopeName: input.scopeName,
        repositories: input.repositories,
        models: input.models,
        filter: input.filter,
        policy: input.policy,
        feishuNotification: {
          enabled: notificationEnabled,
          hasWebhook: feishuWebhookSecretId !== null,
        },
        feishuWebhookSecretId,
        lastPolledAt: prev?.lastPolledAt ?? null,
        lastPollError: prev?.lastPollError ?? null,
        updatedAt: yield* nowIso,
      };
      if (replacementSecretId) {
        yield* secrets
          .set(replacementSecretId, encoder.encode(webhook))
          .pipe(Effect.mapError(mapRepoErr("storeFeishuWebhook")));
      }
      yield* repo.upsertProfile(profile).pipe(
        Effect.tapError(() =>
          replacementSecretId
            ? secrets.remove(replacementSecretId).pipe(Effect.ignore)
            : Effect.void,
        ),
        Effect.mapError(mapRepoErr("saveProfile")),
      );
      if (replacementSecretId && prevSecretId) {
        yield* secrets.remove(prevSecretId).pipe(Effect.ignore);
      }
      yield* publishSnapshot;
      return profileForClient(profile);
    },
    Effect.uninterruptible,
    profileWrites.withPermits(1),
  );

  const deleteProfile: IssueAutomationService["Service"]["deleteProfile"] = Effect.fn(
    "IssueAutomationService.deleteProfile",
  )(
    function* (input) {
      const profile = yield* repo
        .getProfile(input.profileId)
        .pipe(Effect.mapError(mapRepoErr("getProfile")));
      yield* repo.deleteProfile(input.profileId).pipe(Effect.mapError(mapRepoErr("deleteProfile")));
      if (profile?.feishuWebhookSecretId) {
        yield* secrets.remove(profile.feishuWebhookSecretId).pipe(Effect.ignore);
      }
      yield* publishSnapshot;
    },
    Effect.uninterruptible,
    profileWrites.withPermits(1),
  );

  const setProfileEnabled: IssueAutomationService["Service"]["setProfileEnabled"] = Effect.fn(
    "IssueAutomationService.setProfileEnabled",
  )(function* (input) {
    const found = yield* repo
      .getProfile(input.profileId)
      .pipe(Effect.mapError(mapRepoErr("getProfile")));
    if (!found) {
      return yield* new IssueAutomationError({
        operation: "setProfileEnabled",
        detail: "未找到对应的自动分析策略配置",
      });
    }
    const updatedAt = yield* nowIso;
    const next = {
      ...found,
      enabled: input.enabled,
      updatedAt,
    };
    yield* repo.upsertProfile(next).pipe(Effect.mapError(mapRepoErr("setProfileEnabled")));
    yield* publishSnapshot;
    return profileForClient(next);
  }, profileWrites.withPermits(1));

  const triggerPoll: IssueAutomationService["Service"]["triggerPoll"] = Effect.fn(
    "IssueAutomationService.triggerPoll",
  )(function* (input) {
    const profiles = yield* repo.listProfiles.pipe(Effect.mapError(mapRepoErr("listProfiles")));
    const found = profiles.find((p) => p.id === input.profileId);
    if (!found) {
      return yield* new IssueAutomationError({
        operation: "triggerPoll",
        detail: "未找到对应的自动分析策略配置",
      });
    }
    return yield* pollSingleProfile(found);
  });

  const analyzeIssues: IssueAutomationService["Service"]["analyzeIssues"] = Effect.fn(
    "IssueAutomationService.analyzeIssues",
  )(function* (input) {
    const { connector } = yield* readConnectorCredentials(input.connectorId);
    const previous =
      input.retryTaskId === undefined
        ? undefined
        : yield* repo.getTask(input.retryTaskId).pipe(Effect.mapError(mapRepoErr("getTask")));
    if (
      input.retryTaskId !== undefined &&
      (!previous ||
        previous.stage !== "cancelled" ||
        previous.actionMode !== "diagnose_only" ||
        previous.connectorId !== connector.id ||
        previous.scopeId !== input.scopeId ||
        input.issueKeys.length !== 1 ||
        input.issueKeys[0] !== previous.issueKey)
    ) {
      return yield* new IssueAutomationError({
        operation: "analyzeIssues",
        detail: "只能重新诊断已取消的同一缺陷",
      });
    }
    const previousThread =
      previous?.primaryThreadId == null
        ? undefined
        : yield* threadManagement
            .getThreadProjection(previous.primaryThreadId)
            .pipe(Effect.mapError(mapRepoErr("getRetryThread")));
    if (
      previousThread &&
      (previousThread.thread.archivedAt !== null ||
        previousThread.thread.deletedAt !== null ||
        previousThread.thread.projectId !== previous?.targetProjectId ||
        previousThread.thread.worktreePath !== null ||
        previousThread.runs.some(
          (run) => !ThreadManagementService.isTerminalRunStatus(run.status),
        ) ||
        previousThread.providerThreads.some(
          (thread) => (thread.pendingBackgroundTasks?.length ?? 0) > 0,
        ) ||
        previousThread.subagents.some((task) => isOrchestrationV2WorkActive(task.status)))
    ) {
      return yield* new IssueAutomationError({
        operation: "analyzeIssues",
        detail: "原会话尚未停止或工作区已经变更，暂时无法在原会话重新诊断",
      });
    }
    const profiles = yield* repo.listProfiles.pipe(Effect.mapError(mapRepoErr("listProfiles")));
    const matchedProfile = input.profileId
      ? profiles.find((p) => p.id === input.profileId)
      : profiles.find((p) => p.connectorId === input.connectorId && p.scopeId === input.scopeId);

    const configuredRepositories = input.overrideRepositories ?? matchedProfile?.repositories;
    const repositories = previous?.targetProjectId
      ? {
          primaryProjectId: previous.targetProjectId,
          linkedProjectIds: [...previous.referenceProjectIds],
          moduleMappings: [],
        }
      : configuredRepositories;
    const configuredModels = input.overrideModels ?? matchedProfile?.models;
    const models = previousThread
      ? {
          primaryModel: previousThread.thread.modelSelection,
          triageModel: null,
          highSeverityModel: null,
          reviewModel: null,
          fallbackModel: null,
        }
      : configuredModels;
    const configuredPolicy: IssueAutomationPolicy = input.overridePolicy ??
      matchedProfile?.policy ?? {
        actionMode: "fix_worktree_review",
        autoWriteComment: true,
        baseBranch: null,
        customPromptInstructions: null,
      };
    const policy = previous
      ? {
          ...configuredPolicy,
          actionMode: "diagnose_only" as const,
          autoWriteComment:
            matchedProfile?.policy.actionMode === "diagnose_only" &&
            matchedProfile.policy.autoWriteComment,
        }
      : configuredPolicy;
    const maxConcurrency = matchedProfile?.filter.maxConcurrency ?? 2;
    const scopeName =
      connector.scopes.find((scope) => scope.id === input.scopeId)?.name ?? input.scopeName;

    if (!repositories || !models) {
      return yield* new IssueAutomationError({
        operation: "analyzeIssues",
        detail: "请先为该产品配置关联的本地代码库与执行大模型",
      });
    }

    const createdTasks: IssueAutomationTask[] = [];
    for (const issueKey of new Set(input.issueKeys)) {
      const history = yield* repo
        .listIssueTasks(connector.id, issueKey)
        .pipe(Effect.mapError(mapRepoErr("listIssueTasks")));
      if (previous && history[0]?.id !== previous.id) {
        return yield* new IssueAutomationError({
          operation: "analyzeIssues",
          detail: "该缺陷已有更新的执行记录",
        });
      }
      if (history.some((task) => !isTerminalStage(task.stage))) continue;
      const createdAt = yield* nowIso;
      const modelLabel = formatModelLabel(models.primaryModel);
      const task: IssueAutomationTask = {
        id: IssueAutomationTaskId.make(NodeCrypto.randomUUID()),
        profileId: matchedProfile?.id ?? null,
        connectorId: connector.id,
        platform: connector.platform,
        scopeId: input.scopeId,
        scopeName,
        issueKey,
        displayKey: `#${issueKey}`,
        issueTitle: previous?.issueTitle ?? `问题 #${issueKey}`,
        issueUrl:
          connector.platform === "zentao"
            ? buildZenTaoBugWebUrl(connector.baseUrl, issueKey)
            : connector.baseUrl,
        moduleName: null,
        severity: null,
        priority: null,
        issueStatus: "",
        assignee: null,
        trigger: "manual",
        actionMode: policy.actionMode,
        stage: "queued",
        targetProjectId: repositories.primaryProjectId,
        referenceProjectIds: repositories.linkedProjectIds.filter(
          (id) => id !== repositories.primaryProjectId,
        ),
        primaryThreadId: null,
        reviewThreadId: null,
        assignedModelLabel: modelLabel,
        worktreeBranch: null,
        diagnosisReport: null,
        reviewReport: null,
        commentSyncedAt: null,
        stateSyncedAt: null,
        remoteUpdatedMarker: null,
        lastError: null,
        steps: [
          {
            at: createdAt,
            stage: "queued",
            modelLabel,
            message: "手动派发问题诊断任务，正在进入执行队列...",
          },
        ],
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      };
      yield* repo.upsertTask(task).pipe(Effect.mapError(mapRepoErr("createManualTask")));
      yield* spawnTaskExecution(
        task,
        repositories,
        models,
        policy,
        maxConcurrency,
        previous
          ? {
              threadId: previousThread?.thread.id ?? null,
              attemptNumber: history.length + 1,
            }
          : undefined,
      );
      createdTasks.push(task);
    }

    return { tasks: createdTasks };
  }, taskStarts.withPermits(1));

  const stopTaskRun = Effect.fn("IssueAutomationService.stopTaskRun")(
    function* (projectId: ProjectId, threadId: ThreadId, runId: RunId) {
      const projection = yield* threadManagement.getThreadProjection(threadId);
      const run = projection.runs.find((run) => run.id === runId);
      if (!run)
        return yield* new IssueAutomationError({
          operation: "cancelTask",
          detail: "找不到需要停止的模型轮次",
        });
      const commandId = CommandId.make(`issue-automation-cancel:${NodeCrypto.randomUUID()}`);
      const reason = "Cancelled from Issue Automation workbench";
      const pendingWork = hasRunBackgroundWork(projection, runId);
      if (run.status === "queued") {
        yield* threadManagement.dispatch({ type: "queued-run.cancel", commandId, threadId, runId });
      } else if (!ThreadManagementService.isTerminalRunStatus(run.status)) {
        yield* threadManagement.interruptThread({
          projectId,
          commandId,
          threadId,
          runId,
          reason,
        });
      } else if (pendingWork) {
        yield* threadManagement.dispatch({
          type: "run.interrupt",
          commandId,
          threadId,
          runId,
          reason,
        });
      }
      const stopped = yield* threadManagement.waitForThread({
        projectId,
        threadId,
        runId,
        timeoutMs: 30_000,
        ...(pendingWork ? { untilDelegatedWorkSettled: true } : {}),
      });
      if (
        stopped.timedOut ||
        !stopped.run ||
        !ThreadManagementService.isTerminalRunStatus(stopped.run.status) ||
        hasRunBackgroundWork(yield* threadManagement.getThreadProjection(threadId), runId)
      ) {
        return yield* new IssueAutomationError({
          operation: "cancelTask",
          detail: "模型尚未确认停止，请重试取消",
        });
      }
    },
    Effect.mapError(mapRepoErr("cancelTask")),
  );

  const cancelTask: IssueAutomationService["Service"]["cancelTask"] = Effect.fn(
    "IssueAutomationService.cancelTask",
  )(function* ({ taskId }) {
    if (pendingCancellations.has(taskId)) return;
    pendingCancellations.add(taskId);
    const stopping = yield* Effect.gen(function* () {
      const task = yield* repo.getTask(taskId).pipe(Effect.mapError(mapRepoErr("getTask")));
      if (!task || isTerminalStage(task.stage)) return;
      const cancelling = yield* updateTaskState(
        task,
        { stage: "cancelling", lastError: null },
        task.stage === "cancelling" ? undefined : { message: "正在停止本次诊断" },
      );
      if (cancelling.stage !== "cancelling") return;

      const fiber = (yield* Ref.get(activeTaskFibers)).get(taskId);
      if (fiber) yield* Fiber.interrupt(fiber);
      const linked =
        (yield* repo.getTask(taskId).pipe(Effect.mapError(mapRepoErr("getTask")))) ?? cancelling;
      const stop = yield* Effect.result(
        Effect.gen(function* () {
          if (!linked.targetProjectId) return;
          if (linked.reviewThreadId && linked.reviewRunId) {
            yield* stopTaskRun(linked.targetProjectId, linked.reviewThreadId, linked.reviewRunId);
          }
          if (linked.primaryThreadId && linked.primaryRunId) {
            yield* stopTaskRun(linked.targetProjectId, linked.primaryThreadId, linked.primaryRunId);
          }
        }),
      );
      if (stop._tag === "Failure") {
        yield* updateTaskState(linked, { lastError: stop.failure.detail });
        return yield* stop.failure;
      }
      yield* updateTaskState(linked, { stage: "cancelled" }, { message: "已确认停止本次诊断" });
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          pendingCancellations.delete(taskId);
        }),
      ),
      Effect.interruptible,
      Effect.forkIn(serviceScope),
    );
    yield* Fiber.join(stopping).pipe(Effect.interruptible);
  }, Effect.uninterruptible);

  yield* repo.listTasks(1000).pipe(
    Effect.orElseSucceed(() => []),
    Effect.flatMap((tasks) =>
      Effect.forEach(
        tasks.filter((task) => task.stage === "cancelling"),
        (task) => cancelTask({ taskId: task.id }).pipe(Effect.ignore),
        { concurrency: 3, discard: true },
      ),
    ),
    Effect.forkScoped,
  );

  const writeBack: IssueAutomationService["Service"]["writeBack"] = Effect.fn(
    "IssueAutomationService.writeBack",
  )(function* (input) {
    const { plugin, credentials } = yield* readConnectorCredentials(input.connectorId);
    const result = yield* plugin.writeBack({
      credentials,
      action: input.action,
    });

    if (input.action.kind !== "create" && input.action.taskId !== undefined) {
      const targetTaskId = input.action.taskId;
      const tasks = yield* repo.listTasks(250).pipe(Effect.orElseSucceed(() => []));
      const found = tasks.find((t) => t.id === targetTaskId);
      if (found) {
        const syncedAt = yield* nowIso;
        yield* updateTaskState(
          found,
          {
            ...(input.action.kind === "comment" || input.action.comment
              ? { commentSyncedAt: syncedAt }
              : {}),
            ...(input.action.kind !== "comment" ? { stateSyncedAt: syncedAt } : {}),
          },
          {
            stage: found.stage,
            message: `已向平台执行写入动作: ${input.action.kind}`,
          },
        );
      }
    }

    return result;
  });

  const subscribe: IssueAutomationService["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      const initial = yield* buildSnapshot;
      return Stream.concat(Stream.make(initial), Stream.fromPubSub(updatesPubSub));
    }),
  );

  return IssueAutomationService.of({
    getState: buildSnapshot,
    subscribe,
    saveConnector,
    deleteConnector,
    refreshScopes,
    listRemoteIssues,
    scanProfileIssues,
    getRemoteIssueDetail,
    saveProfile,
    deleteProfile,
    setProfileEnabled,
    triggerPoll,
    analyzeIssues,
    cancelTask,
    writeBack,
  });
});

export const layer = Layer.effect(IssueAutomationService, make);
