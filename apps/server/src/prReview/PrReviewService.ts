// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  MessageId,
  PositiveInt,
  PrReviewError,
  PrReviewPresetId,
  PrReviewTaskId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type PrReviewCancelTaskInput,
  type PrReviewDeletePresetInput,
  type PrReviewModelRun,
  type PrReviewModelSlot,
  type PrReviewPreset,
  type PrReviewSavePresetInput,
  type PrReviewSkillDescriptor,
  type PrReviewStage,
  type PrReviewStartInput,
  type PrReviewStartResult,
  type PrReviewStateSnapshot,
  type PrReviewStepLog,
  type PrReviewTargetItem,
  type PrReviewTask,
  type PrReviewWriteBackInput,
  type PrReviewWriteBackMode,
  type PrReviewWriteBackResult,
  type ProjectId,
  type PullRequestRef,
  type PullRequestReviewCommentDraft,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import {
  buildPrContextDocument,
  buildReviewerMessage,
  buildReviewerReportsDocument,
  buildSynthesizerMessage,
  formatFusionWriteBackMarkdown,
  parseDiffFileManifest,
  parseSynthesizerOutput,
  ROLE_LABELS_ZH,
} from "./PrReviewPrompts.ts";
import * as PrReviewRepository from "./PrReviewRepository.ts";

const THREAD_WAIT_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_DIFF_SLICES = 6;
const isPrReviewError = Schema.is(PrReviewError);

function formatModelLabel(selection: ModelSelection): string {
  return `${selection.instanceId}:${selection.model}`;
}

function isTerminalStage(stage: PrReviewStage): boolean {
  return stage === "completed" || stage === "failed" || stage === "cancelled";
}

function parseSimpleSkillFrontmatter(raw: string): {
  readonly name?: string;
  readonly description?: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (!match?.[1]) return {};
  let name: string | undefined;
  let description: string | undefined;
  for (const line of match[1].split(/\r?\n/u)) {
    const kv = /^([\w-]+)\s*:\s*(.+)$/u.exec(line.trim());
    if (!kv) continue;
    const key = kv[1]?.toLowerCase();
    const val = (kv[2] ?? "").trim().replace(/^["']|["']$/gu, "");
    if (key === "name" && val) name = val;
    if (key === "description" && val) description = val;
  }
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

function scanSkillDirectory(
  dirPath: string,
  source: PrReviewSkillDescriptor["source"],
  into: Map<string, PrReviewSkillDescriptor>,
) {
  try {
    if (!NodeFS.existsSync(dirPath)) return;
    const entries = NodeFS.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      const skillMdPath = NodePath.join(dirPath, entry.name, "SKILL.md");
      if (!NodeFS.existsSync(skillMdPath)) continue;
      const raw = NodeFS.readFileSync(skillMdPath, "utf8").slice(0, 8_192);
      const fm = parseSimpleSkillFrontmatter(raw);
      const skillName = (fm.name || entry.name).trim();
      if (!skillName || into.has(skillName)) continue;
      into.set(skillName, {
        name: skillName,
        displayName: skillName,
        description: fm.description ?? "",
        path: skillMdPath,
        source,
      });
    }
  } catch {
    // Ignore unreadable skill directories.
  }
}

export class PrReviewService extends Context.Service<
  PrReviewService,
  {
    readonly listSkills: Effect.Effect<ReadonlyArray<PrReviewSkillDescriptor>>;
    readonly getState: Effect.Effect<PrReviewStateSnapshot, PrReviewError>;
    readonly subscribe: Stream.Stream<PrReviewStateSnapshot, PrReviewError>;
    readonly savePreset: (
      input: PrReviewSavePresetInput,
    ) => Effect.Effect<PrReviewPreset, PrReviewError>;
    readonly deletePreset: (input: PrReviewDeletePresetInput) => Effect.Effect<void, PrReviewError>;
    readonly startReview: (
      input: PrReviewStartInput,
    ) => Effect.Effect<PrReviewStartResult, PrReviewError>;
    readonly cancelTask: (input: PrReviewCancelTaskInput) => Effect.Effect<void, PrReviewError>;
    readonly writeBack: (
      input: PrReviewWriteBackInput,
    ) => Effect.Effect<PrReviewWriteBackResult, PrReviewError>;
  }
>()("t3/prReview/PrReviewService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const repo = yield* PrReviewRepository.PrReviewRepository;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const projects = yield* ProjectService.ProjectService;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const serviceScope = yield* Effect.scope;

  const updatesPubSub = yield* PubSub.unbounded<PrReviewStateSnapshot>();
  const activeTaskFibers = yield* Ref.make<ReadonlyMap<PrReviewTaskId, Fiber.Fiber<void>>>(
    new Map(),
  );
  const taskSemaphore = yield* Semaphore.make(3);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const mapErr = (operation: string) => (cause: unknown) =>
    isPrReviewError(cause)
      ? cause
      : new PrReviewError({
          operation,
          detail: cause instanceof Error ? cause.message : "PR 融合审查操作失败",
          cause,
        });

  const discoverSkills: Effect.Effect<ReadonlyArray<PrReviewSkillDescriptor>> = Effect.gen(
    function* () {
      const [providers, projectShells] = yield* Effect.all([
        providerRegistry.getProviders,
        projects.listShells().pipe(Effect.orElseSucceed(() => [] as OrchestrationProjectShell[])),
      ]);
      const found = new Map<string, PrReviewSkillDescriptor>();

      yield* Effect.sync(() => {
        scanSkillDirectory(NodePath.join(config.cwd, ".agents", "skills"), "workspace", found);
        scanSkillDirectory(NodePath.join(config.cwd, ".claude", "skills"), "workspace", found);
        for (const proj of projectShells.slice(0, 15)) {
          scanSkillDirectory(
            NodePath.join(proj.workspaceRoot, ".agents", "skills"),
            "workspace",
            found,
          );
          scanSkillDirectory(
            NodePath.join(proj.workspaceRoot, ".claude", "skills"),
            "workspace",
            found,
          );
        }
        for (const provider of providers) {
          for (const skill of provider.skills) {
            if (!skill.enabled || found.has(skill.name)) continue;
            found.set(skill.name, {
              name: skill.name,
              displayName: skill.displayName ?? skill.name,
              description: skill.shortDescription ?? skill.description ?? "",
              path: skill.path,
              source: skill.scope === "project" ? "workspace" : "provider",
            });
          }
        }
        const home = NodeOS.homedir();
        scanSkillDirectory(NodePath.join(home, ".agents", "skills"), "user", found);
        scanSkillDirectory(NodePath.join(home, ".claude", "skills"), "user", found);
        scanSkillDirectory(NodePath.join(home, ".codex", "skills"), "user", found);
      });

      return [...found.values()].toSorted((a, b) => a.name.localeCompare(b.name));
    },
  );

  const buildSnapshot: Effect.Effect<PrReviewStateSnapshot, PrReviewError> = Effect.gen(
    function* () {
      const [presets, tasks, runningMap] = yield* Effect.all([
        repo.listPresets.pipe(Effect.mapError(mapErr("listPresets"))),
        repo.listTasks(200).pipe(Effect.mapError(mapErr("listTasks"))),
        Ref.get(activeTaskFibers),
      ]);
      return {
        presets,
        tasks,
        availableSkills: [],
        activeRunCount: runningMap.size,
      };
    },
  );

  const publishSnapshot = buildSnapshot.pipe(
    Effect.flatMap((snapshot) => PubSub.publish(updatesPubSub, snapshot)),
    Effect.ignore,
  );

  const updateTask = Effect.fn("PrReviewService.updateTask")(function* (
    task: PrReviewTask,
    patch: Partial<PrReviewTask>,
    step?: {
      readonly stage?: PrReviewStage;
      readonly modelLabel?: string;
      readonly message: string;
    },
  ) {
    const at = yield* nowIso;
    const nextStage = patch.stage ?? task.stage;
    const nextSteps: ReadonlyArray<PrReviewStepLog> = step
      ? [
          ...task.steps,
          {
            at,
            stage: step.stage ?? nextStage,
            ...(step.modelLabel ? { modelLabel: step.modelLabel } : {}),
            message: step.message,
          },
        ]
      : (patch.steps ?? task.steps);
    const updated: PrReviewTask = {
      ...task,
      ...patch,
      stage: nextStage,
      steps: nextSteps,
      updatedAt: at,
      completedAt:
        patch.completedAt !== undefined
          ? patch.completedAt
          : isTerminalStage(nextStage) && task.completedAt === null
            ? at
            : task.completedAt,
    };
    yield* repo.upsertTask(updated).pipe(Effect.mapError(mapErr("upsertTask")));
    yield* publishSnapshot;
    return updated;
  });

  const resolveExecutionProject = Effect.fn("PrReviewService.resolveExecutionProject")(function* (
    target: PrReviewTargetItem,
  ) {
    if (!target.projectId.startsWith("cloud:")) {
      const direct = yield* projects
        .getShell(target.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none<OrchestrationProjectShell>()));
      if (Option.isSome(direct)) {
        const scratch = yield* managedFolders
          .isScratchProject(direct.value.id)
          .pipe(Effect.orElseSucceed(() => false));
        return {
          projectId: direct.value.id,
          workspaceRoot: direct.value.workspaceRoot,
          isLocalCheckout: !scratch,
        };
      }
    }

    const allShells = yield* projects
      .listShells()
      .pipe(Effect.orElseSucceed(() => [] as OrchestrationProjectShell[]));
    const matched = allShells.find((shell) => {
      const identity = shell.repositoryIdentity;
      if (!identity) return false;
      const selector = sourceControlDefinitions.repositorySelector(identity);
      return selector?.toLowerCase() === target.repository.trim().toLowerCase();
    });
    if (matched) {
      return {
        projectId: matched.id,
        workspaceRoot: matched.workspaceRoot,
        isLocalCheckout: true,
      };
    }

    const ensuredScratch = yield* managedFolders.ensureScratchProject.pipe(
      Effect.mapError(mapErr("ensureScratchProject")),
    );
    const scratchRootOpt = yield* managedFolders.scratchRoot;
    return {
      projectId: ensuredScratch.projectId,
      workspaceRoot: Option.getOrElse(scratchRootOpt, () => config.cwd),
      isLocalCheckout: false,
    };
  });

  const fetchCompletePatch = Effect.fn("PrReviewService.fetchCompletePatch")(function* (
    ref: PullRequestRef,
  ) {
    const slices: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_DIFF_SLICES; i++) {
      const slice = yield* pullRequests
        .diff({
          ...ref,
          ...(cursor ? { cursor } : {}),
        })
        .pipe(Effect.mapError(mapErr("fetchDiff")));
      if (slice.patch.length > 0) slices.push(slice.patch);
      if (!slice.nextCursor) break;
      cursor = slice.nextCursor;
    }
    return slices.join("\n");
  });

  const linkPullRequestToThread = (
    threadId: ThreadId,
    info: {
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly url: string;
    },
  ) =>
    orchestrator
      .dispatch({
        type: "thread.pull-request.link",
        commandId: CommandId.make(`pr-review-link:${NodeCrypto.randomUUID()}`),
        threadId,
        host: info.host.toLowerCase(),
        repository: info.repository,
        number: info.number,
        url: info.url,
        source: "agent",
      })
      .pipe(Effect.ignore);

  const waitAndReadAssistantText = Effect.fn("PrReviewService.waitAndReadAssistantText")(function* (
    projectId: ProjectId,
    threadId: ThreadId,
  ) {
    const waited = yield* threadManagement
      .waitForThread({
        projectId,
        threadId,
        timeoutMs: THREAD_WAIT_TIMEOUT_MS,
        untilDelegatedWorkSettled: true,
      })
      .pipe(Effect.mapError(mapErr("waitForThread")));
    const projection = yield* threadManagement
      .getThreadProjection(threadId)
      .pipe(Effect.mapError(mapErr("waitForThread")));
    const assistantMessages = projection.messages.filter(
      (m) => m.role === "assistant" && m.text.trim().length > 0,
    );
    const latestText = assistantMessages.at(-1)?.text.trim() ?? "";
    const terminalRun = waited.resultRun ?? waited.run ?? projection.runs.at(-1) ?? null;
    if (waited.timedOut) {
      return yield* new PrReviewError({
        operation: "waitForThread",
        detail: "模型审查执行超时（超过 25 分钟）",
      });
    }
    if (
      terminalRun &&
      (terminalRun.status === "failed" ||
        terminalRun.status === "cancelled" ||
        terminalRun.status === "interrupted") &&
      latestText.length === 0
    ) {
      return yield* new PrReviewError({
        operation: "waitForThread",
        detail: `审查会话结束状态异常：${terminalRun.status}`,
      });
    }
    return latestText || "（模型已完成审查，请点击会话查看详细记录）";
  });

  const performWriteBack = Effect.fn("PrReviewService.performWriteBack")(function* (input: {
    readonly task: PrReviewTask;
    readonly kind: "comment" | "review";
    readonly verdict?: "approve" | "request-changes" | "comment" | undefined;
    readonly body: string;
    readonly inlineFindingIds?: ReadonlyArray<string> | undefined;
  }) {
    const ref: PullRequestRef = {
      projectId: input.task.projectId,
      host: input.task.host,
      repository: input.task.repository,
      number: input.task.prNumber,
    };

    if (input.kind === "comment") {
      yield* pullRequests
        .comment({
          ...ref,
          body: input.body,
        })
        .pipe(Effect.mapError(mapErr("writeBackComment")));
      const syncedAt = yield* nowIso;
      yield* updateTask(
        input.task,
        { commentSyncedAt: syncedAt },
        { message: "已将多模型融合审查报告回写至 PR/MR 评论区" },
      );
      return syncedAt;
    }

    const chosenVerdict = input.verdict ?? input.task.verdict ?? "comment";
    const selectedIds = new Set(input.inlineFindingIds ?? []);
    const inlineComments: PullRequestReviewCommentDraft[] = input.task.findings.flatMap((f) => {
      if (!selectedIds.has(f.id) || !f.filePath || f.line === null || f.line <= 0) return [];
      const bodyLines = [
        `**[${f.severity.toUpperCase()}] ${f.title}**`,
        "",
        f.description,
        ...(f.suggestion ? ["", "**建议修改：**", f.suggestion] : []),
        ...(f.raisedByModels.length > 0 ? ["", `_命中模型：${f.raisedByModels.join(", ")}_`] : []),
      ];
      return [
        {
          path: f.filePath,
          body: bodyLines.join("\n"),
          position: {
            kind: "added" as const,
            newLine: PositiveInt.make(f.line),
          },
        },
      ];
    });

    const submit = (comments: ReadonlyArray<PullRequestReviewCommentDraft>) =>
      pullRequests.submitReview({
        ...ref,
        verdict: chosenVerdict,
        body: input.body,
        comments,
      });

    yield* submit(inlineComments).pipe(
      // If a host rejects an inline line position outside the diff hunk, fall back to summary review.
      Effect.catchIf(
        () => inlineComments.length > 0,
        () => submit([]),
      ),
      Effect.mapError(mapErr("writeBackReview")),
    );

    const syncedAt = yield* nowIso;
    yield* updateTask(
      input.task,
      { reviewSyncedAt: syncedAt },
      { message: `已作为正式代码评审（${chosenVerdict}）回写至远端仓库` },
    );
    return syncedAt;
  });

  const executeFusionPipeline = Effect.fn("PrReviewService.executeFusionPipeline")(function* (
    initialTask: PrReviewTask,
    slots: ReadonlyArray<PrReviewModelSlot>,
    synthesizerModel: ModelSelection | null,
    skills: ReadonlyArray<PrReviewSkillDescriptor>,
    customInstructions: string | null,
    writeBackMode: PrReviewWriteBackMode,
  ) {
    yield* taskSemaphore
      .withPermits(1)(
        Effect.gen(function* () {
          let current = yield* updateTask(
            initialTask,
            { stage: "fetching_context", lastError: null },
            {
              stage: "fetching_context",
              message: `正在拉取 ${initialTask.repository}#${initialTask.prNumber} 完整元数据、提交与 Diff 补丁...`,
            },
          );

          const ref: PullRequestRef = {
            projectId: current.projectId,
            host: current.host,
            repository: current.repository,
            number: current.prNumber,
          };

          const [detail, activity, patch, execProject] = yield* Effect.all(
            [
              pullRequests.detail(ref).pipe(Effect.mapError(mapErr("detail"))),
              pullRequests.activity(ref).pipe(Effect.orElseSucceed(() => null)),
              fetchCompletePatch(ref),
              resolveExecutionProject({
                provider: current.provider,
                host: current.host,
                projectId: current.projectId,
                projectTitle: current.projectTitle,
                repository: current.repository,
                number: current.prNumber,
              }),
            ],
            { concurrency: 4 },
          );

          const assetDir = NodePath.join(config.stateDir, "pr-review-assets", current.id);
          const diffFilePath = NodePath.join(assetDir, "diff.patch");
          const contextFilePath = NodePath.join(assetDir, "context.md");
          const manifest = parseDiffFileManifest(patch);
          const contextDoc = buildPrContextDocument({
            detail,
            activity,
            manifestText: manifest.formattedManifest,
          });
          yield* Effect.sync(() => {
            NodeFS.mkdirSync(assetDir, { recursive: true });
            NodeFS.writeFileSync(diffFilePath, patch, "utf8");
            NodeFS.writeFileSync(contextFilePath, contextDoc, "utf8");
          });

          const sigil = detail.provider === "gitlab" ? "!" : "#";
          const displayRef = `${detail.repository}${sigil}${detail.number}`;

          current = yield* updateTask(
            current,
            {
              stage: "parallel_reviewing",
              prTitle: detail.title,
              prUrl: detail.url,
              prAuthor: detail.author?.login ?? current.prAuthor,
              headBranch: detail.headBranch,
              baseBranch: detail.baseBranch,
              headSha: detail.headSha ?? null,
            },
            {
              stage: "parallel_reviewing",
              message: `已保存完整 Diff（+${detail.additions}/-${detail.deletions}，${detail.changedFiles} files），正在并行调度 ${slots.length} 个模型执行深度审查...`,
            },
          );

          // Shared mutable state guarded via Ref so parallel reviewers update live status safely.
          const taskRef = yield* Ref.make(current);
          const mutateRun = (
            slotId: string,
            patchRun: Partial<PrReviewModelRun>,
            stepMsg?: { readonly modelLabel: string; readonly message: string },
          ) =>
            Ref.get(taskRef).pipe(
              Effect.flatMap((latest) => {
                const nextRuns = latest.reviewerRuns.map((r) =>
                  r.slotId === slotId ? { ...r, ...patchRun } : r,
                );
                return updateTask(
                  latest,
                  { reviewerRuns: nextRuns },
                  stepMsg ? { stage: "parallel_reviewing", ...stepMsg } : undefined,
                );
              }),
              Effect.tap((saved) => Ref.set(taskRef, saved)),
            );

          yield* Effect.forEach(
            slots,
            (slot) =>
              Effect.gen(function* () {
                const modelLabel = formatModelLabel(slot.modelSelection);
                const startedAt = yield* nowIso;
                const reviewerMsg = buildReviewerMessage({
                  detail,
                  manifest,
                  diffFilePath,
                  contextFilePath,
                  role: slot.role,
                  isLocalCheckout: execProject.isLocalCheckout,
                  workspaceRoot: execProject.workspaceRoot,
                  skills,
                  customInstructions,
                  interactiveDirectMode: false,
                });

                const launchedOutcome = yield* Effect.result(
                  threadLaunch.launch({
                    commandId: CommandId.make(`pr-review:${NodeCrypto.randomUUID()}`),
                    projectId: execProject.projectId,
                    title: `[PR审查·${ROLE_LABELS_ZH[slot.role]}] ${displayRef} ${detail.title.slice(0, 40)}`,
                    modelSelection: slot.modelSelection,
                    runtimeMode: "full-access",
                    interactionMode: "default",
                    workspaceStrategy: { type: "root" },
                    initialMessage: {
                      messageId: MessageId.make(NodeCrypto.randomUUID()),
                      text: reviewerMsg.text,
                      attachments: [],
                      context: reviewerMsg.context,
                    },
                    createdBy: "user",
                    creationSource: "web",
                  }),
                );

                if (launchedOutcome._tag === "Failure") {
                  const errText =
                    launchedOutcome.failure instanceof Error
                      ? launchedOutcome.failure.message
                      : String(launchedOutcome.failure);
                  const failedAt = yield* nowIso;
                  yield* mutateRun(
                    slot.id,
                    { status: "failed", error: errText, startedAt, completedAt: failedAt },
                    { modelLabel, message: `模型启动失败：${errText}` },
                  );
                  return;
                }

                const threadId = launchedOutcome.success.threadId;
                if (execProject.isLocalCheckout) {
                  yield* linkPullRequestToThread(threadId, {
                    host: current.host,
                    repository: detail.repository,
                    number: detail.number,
                    url: detail.url,
                  });
                }

                yield* mutateRun(
                  slot.id,
                  { status: "running", threadId, startedAt },
                  { modelLabel, message: `已启动并行审查会话（${ROLE_LABELS_ZH[slot.role]}）` },
                );

                const reportOutcome = yield* Effect.result(
                  waitAndReadAssistantText(execProject.projectId, threadId),
                );
                const finishedAt = yield* nowIso;
                if (reportOutcome._tag === "Failure") {
                  const errText =
                    reportOutcome.failure instanceof Error
                      ? reportOutcome.failure.message
                      : String(reportOutcome.failure);
                  yield* mutateRun(
                    slot.id,
                    { status: "failed", error: errText, completedAt: finishedAt },
                    { modelLabel, message: `模型审查异常结束：${errText}` },
                  );
                  return;
                }

                yield* mutateRun(
                  slot.id,
                  {
                    status: "completed",
                    reportMarkdown: reportOutcome.success,
                    completedAt: finishedAt,
                  },
                  { modelLabel, message: "已完成独立代码审查并提交报告" },
                );
              }),
            { concurrency: 4, discard: true },
          );

          current = yield* Ref.get(taskRef);
          const succeededRuns = current.reviewerRuns.filter(
            (r) => r.status === "completed" && r.reportMarkdown !== null,
          );
          if (succeededRuns.length === 0) {
            yield* updateTask(
              current,
              {
                stage: "failed",
                lastError: "所有并行审查模型均未能成功产出审查报告",
              },
              { stage: "failed", message: "融合审查终止：无可用的子模型审查结果" },
            );
            return;
          }

          // Synthesis / Consensus Judge Phase
          const effectiveSynthesizer =
            synthesizerModel ??
            (succeededRuns.length >= 2 ? succeededRuns[0]!.modelSelection : null);

          let verdict = current.verdict;
          let summaryMarkdown = current.summaryMarkdown;
          let findings = current.findings;
          let synthesisThreadId: ThreadId | null = null;
          let synthesizerLabel: string | null = null;

          if (effectiveSynthesizer === null && succeededRuns.length === 1) {
            const onlyRun = succeededRuns[0]!;
            const parsed = parseSynthesizerOutput(onlyRun.reportMarkdown ?? "", [
              onlyRun.modelLabel,
            ]);
            verdict = parsed.verdict;
            summaryMarkdown = parsed.summaryMarkdown;
            findings = parsed.findings;
            synthesisThreadId = onlyRun.threadId;
          } else if (effectiveSynthesizer !== null) {
            synthesizerLabel = formatModelLabel(effectiveSynthesizer);
            current = yield* updateTask(
              current,
              { stage: "synthesizing", synthesizerModelLabel: synthesizerLabel },
              {
                stage: "synthesizing",
                modelLabel: synthesizerLabel,
                message: `正在唤醒融合裁决主模型 ${synthesizerLabel} 汇总 ${succeededRuns.length} 份报告并交叉验证共识...`,
              },
            );

            const reportsFilePath = NodePath.join(assetDir, "reviewer-reports.md");
            const reportsDoc = buildReviewerReportsDocument({
              detail,
              reviewerRuns: current.reviewerRuns,
            });
            yield* Effect.sync(() => {
              NodeFS.writeFileSync(reportsFilePath, reportsDoc, "utf8");
            });

            const synthMsg = buildSynthesizerMessage({
              detail,
              diffFilePath,
              contextFilePath,
              reportsFilePath,
              isLocalCheckout: execProject.isLocalCheckout,
              workspaceRoot: execProject.workspaceRoot,
              reviewerRuns: current.reviewerRuns,
              skills,
              customInstructions,
            });

            const synthLaunch = yield* threadLaunch
              .launch({
                commandId: CommandId.make(`pr-review-synth:${NodeCrypto.randomUUID()}`),
                projectId: execProject.projectId,
                title: `[融合裁决] ${displayRef} ${detail.title.slice(0, 45)}`,
                modelSelection: effectiveSynthesizer,
                runtimeMode: "full-access",
                interactionMode: "default",
                workspaceStrategy: { type: "root" },
                initialMessage: {
                  messageId: MessageId.make(NodeCrypto.randomUUID()),
                  text: synthMsg.text,
                  attachments: [],
                  context: synthMsg.context,
                },
                createdBy: "user",
                creationSource: "web",
              })
              .pipe(Effect.mapError(mapErr("launchSynthesizer")));

            synthesisThreadId = synthLaunch.threadId;
            if (execProject.isLocalCheckout) {
              yield* linkPullRequestToThread(synthesisThreadId, {
                host: current.host,
                repository: detail.repository,
                number: detail.number,
                url: detail.url,
              });
            }

            current = yield* updateTask(current, { synthesisThreadId });
            const synthRawText = yield* waitAndReadAssistantText(
              execProject.projectId,
              synthesisThreadId,
            );
            const parsed = parseSynthesizerOutput(
              synthRawText,
              succeededRuns.map((r) => r.modelLabel),
            );
            verdict = parsed.verdict;
            summaryMarkdown = parsed.summaryMarkdown;
            findings = parsed.findings;
          }

          current = yield* updateTask(
            current,
            {
              verdict,
              summaryMarkdown,
              findings: [...findings],
              synthesisThreadId,
              synthesizerModelLabel: synthesizerLabel,
            },
            {
              stage: writeBackMode === "manual" ? "completed" : "writing_back",
              message: `多模型融合裁决完成：结论为 ${verdict ?? "comment"}，共提炼 ${findings.length} 条有效问题`,
            },
          );

          if (writeBackMode !== "manual" && summaryMarkdown) {
            current = yield* updateTask(current, { stage: "writing_back" });
            const formattedBody = formatFusionWriteBackMarkdown({
              verdict,
              reviewerModels: succeededRuns.map((r) => r.modelLabel),
              synthesizerModel: synthesizerLabel,
              boundSkills: current.boundSkillNames,
              summaryMarkdown,
            });
            yield* performWriteBack({
              task: current,
              kind: writeBackMode === "auto_review" ? "review" : "comment",
              verdict: verdict ?? "comment",
              body: formattedBody,
              inlineFindingIds:
                writeBackMode === "auto_review" ? findings.map((f) => f.id) : undefined,
            }).pipe(
              Effect.catch((wbErr) =>
                updateTask(
                  current,
                  {},
                  {
                    stage: "writing_back",
                    message: `自动回写未能完成（可在工作站手动重试）：${wbErr.detail}`,
                  },
                ),
              ),
            );
            const refreshed = yield* repo
              .getTask(current.id)
              .pipe(Effect.orElseSucceed(() => current));
            current = refreshed ?? current;
          }

          yield* updateTask(
            current,
            { stage: "completed" },
            { stage: "completed", message: "多模型融合审查全流程已完成" },
          );
        }),
      )
      .pipe(
        Effect.catchCause((cause) =>
          repo.getTask(initialTask.id).pipe(
            Effect.orElseSucceed(() => initialTask),
            Effect.flatMap((latest) => {
              const target = latest ?? initialTask;
              if (target.stage === "cancelled") return Effect.void;
              return updateTask(
                target,
                {
                  stage: "failed",
                  lastError: "多模型融合审查执行过程中发生异常",
                },
                { stage: "failed", message: `审查流水线异常终止: ${String(cause).slice(0, 240)}` },
              );
            }),
            Effect.ignore,
          ),
        ),
        Effect.ensuring(
          Ref.update(activeTaskFibers, (map) => {
            const next = new Map(map);
            next.delete(initialTask.id);
            return next;
          }).pipe(Effect.andThen(publishSnapshot)),
        ),
      );
  });

  const savePreset: PrReviewService["Service"]["savePreset"] = Effect.fn(
    "PrReviewService.savePreset",
  )(function* (input) {
    const at = yield* nowIso;
    const preset: PrReviewPreset = {
      id: input.id ?? PrReviewPresetId.make(`preset-${NodeCrypto.randomUUID().slice(0, 8)}`),
      name: input.name,
      description: input.description,
      isDefault: input.isDefault,
      reviewerModels: input.reviewerModels,
      synthesizerModel: input.synthesizerModel,
      boundSkillNames: input.boundSkillNames,
      customInstructions: input.customInstructions,
      writeBackMode: input.writeBackMode,
      updatedAt: at,
    };
    yield* repo.upsertPreset(preset).pipe(Effect.mapError(mapErr("savePreset")));
    yield* publishSnapshot;
    return preset;
  });

  const deletePreset: PrReviewService["Service"]["deletePreset"] = Effect.fn(
    "PrReviewService.deletePreset",
  )(function* (input) {
    yield* repo.deletePreset(input.presetId).pipe(Effect.mapError(mapErr("deletePreset")));
    yield* publishSnapshot;
  });

  const startReview: PrReviewService["Service"]["startReview"] = Effect.fn(
    "PrReviewService.startReview",
  )(function* (input) {
    const presets = yield* repo.listPresets.pipe(Effect.mapError(mapErr("listPresets")));
    const matchedPreset = input.presetId
      ? (presets.find((p) => p.id === input.presetId) ?? null)
      : (presets.find((p) => p.isDefault) ?? presets[0] ?? null);

    const rawSlots = input.reviewerModels ?? matchedPreset?.reviewerModels ?? [];
    const activeSlots = rawSlots.filter((s) => s.enabled);
    if (activeSlots.length === 0) {
      return yield* new PrReviewError({
        operation: "startReview",
        detail: "请至少选择 1 个启用的审查模型",
      });
    }

    const synthesizerModel =
      input.synthesizerModel !== undefined
        ? input.synthesizerModel
        : (matchedPreset?.synthesizerModel ?? null);
    const boundSkillNames = input.boundSkillNames ?? matchedPreset?.boundSkillNames ?? [];
    const customInstructions =
      input.customInstructions !== undefined
        ? input.customInstructions
        : (matchedPreset?.customInstructions ?? null);
    const writeBackMode = input.writeBackMode ?? matchedPreset?.writeBackMode ?? "manual";

    const allSkills = boundSkillNames.length ? yield* discoverSkills : [];
    const skillByName = new Map(allSkills.map((s) => [s.name, s]));
    const resolvedSkills = boundSkillNames.flatMap((name) => {
      const found = skillByName.get(name);
      return found ? [found] : [];
    });

    // Direct single-agent interactive jump mode (launches thread immediately and returns jumpThreadId!)
    if (input.mode === "direct_agent") {
      const target = input.targets[0]!;
      const slot = activeSlots[0]!;
      const modelLabel = formatModelLabel(slot.modelSelection);
      const taskId = PrReviewTaskId.make(`prrev-${NodeCrypto.randomUUID().slice(0, 10)}`);
      const ref: PullRequestRef = {
        projectId: target.projectId,
        host: target.host,
        repository: target.repository,
        number: target.number,
      };

      const [detail, activity, patch, execProject] = yield* Effect.all(
        [
          pullRequests.detail(ref).pipe(Effect.mapError(mapErr("detail"))),
          pullRequests.activity(ref).pipe(Effect.orElseSucceed(() => null)),
          fetchCompletePatch(ref),
          resolveExecutionProject(target),
        ],
        { concurrency: 4 },
      );

      const assetDir = NodePath.join(config.stateDir, "pr-review-assets", taskId);
      const diffFilePath = NodePath.join(assetDir, "diff.patch");
      const contextFilePath = NodePath.join(assetDir, "context.md");
      const manifest = parseDiffFileManifest(patch);
      const contextDoc = buildPrContextDocument({
        detail,
        activity,
        manifestText: manifest.formattedManifest,
      });
      yield* Effect.sync(() => {
        NodeFS.mkdirSync(assetDir, { recursive: true });
        NodeFS.writeFileSync(diffFilePath, patch, "utf8");
        NodeFS.writeFileSync(contextFilePath, contextDoc, "utf8");
      });

      const sigil = detail.provider === "gitlab" ? "!" : "#";
      const displayRef = `${detail.repository}${sigil}${detail.number}`;
      const reviewerMsg = buildReviewerMessage({
        detail,
        manifest,
        diffFilePath,
        contextFilePath,
        role: slot.role,
        isLocalCheckout: execProject.isLocalCheckout,
        workspaceRoot: execProject.workspaceRoot,
        skills: resolvedSkills,
        customInstructions,
        interactiveDirectMode: true,
      });

      const launched = yield* threadLaunch
        .launch({
          commandId: CommandId.make(`pr-review-direct:${NodeCrypto.randomUUID()}`),
          projectId: execProject.projectId,
          title: `[PR审查] ${displayRef} ${detail.title.slice(0, 50)}`,
          modelSelection: slot.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            messageId: MessageId.make(NodeCrypto.randomUUID()),
            text: reviewerMsg.text,
            attachments: [],
            context: reviewerMsg.context,
          },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError(mapErr("launchDirectReview")));

      if (execProject.isLocalCheckout) {
        yield* linkPullRequestToThread(launched.threadId, {
          host: target.host,
          repository: detail.repository,
          number: detail.number,
          url: detail.url,
        });
      }

      const createdAt = yield* nowIso;
      const task: PrReviewTask = {
        id: taskId,
        presetId: matchedPreset?.id ?? null,
        presetName: matchedPreset?.name ?? null,
        provider: detail.provider,
        host: target.host,
        projectId: target.projectId,
        projectTitle: target.projectTitle,
        repository: detail.repository,
        prNumber: detail.number,
        prTitle: detail.title,
        prUrl: detail.url,
        prAuthor: detail.author?.login ?? null,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        headSha: detail.headSha ?? null,
        mode: "direct_agent",
        stage: "parallel_reviewing",
        boundSkillNames: resolvedSkills.map((s) => s.name),
        reviewerRuns: [
          {
            slotId: slot.id,
            role: slot.role,
            modelSelection: slot.modelSelection,
            modelLabel,
            status: "running",
            threadId: launched.threadId,
            reportMarkdown: null,
            error: null,
            startedAt: createdAt,
            completedAt: null,
          },
        ],
        synthesizerModelLabel: null,
        synthesisThreadId: launched.threadId,
        verdict: null,
        summaryMarkdown: null,
        findings: [],
        commentSyncedAt: null,
        reviewSyncedAt: null,
        lastError: null,
        steps: [
          {
            at: createdAt,
            stage: "parallel_reviewing",
            modelLabel,
            message: `已创建交互式 Agent 审查会话并注入 Diff 与 ${resolvedSkills.length} 个 Skill`,
          },
        ],
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      };

      yield* repo.upsertTask(task).pipe(Effect.mapError(mapErr("upsertTask")));

      // Track completion asynchronously so the user can also write back the report later!
      const watcherFiber = waitAndReadAssistantText(execProject.projectId, launched.threadId).pipe(
        Effect.flatMap((reportText) =>
          Effect.gen(function* () {
            const doneAt = yield* nowIso;
            const parsed = parseSynthesizerOutput(reportText, [modelLabel]);
            yield* updateTask(
              task,
              {
                stage: "completed",
                verdict: parsed.verdict,
                summaryMarkdown: parsed.summaryMarkdown,
                findings: [...parsed.findings],
                reviewerRuns: [
                  {
                    ...task.reviewerRuns[0]!,
                    status: "completed",
                    reportMarkdown: reportText,
                    completedAt: doneAt,
                  },
                ],
              },
              {
                stage: "completed",
                modelLabel,
                message: "Agent 初轮深度审查报告已生成，支持一键评论回写",
              },
            );
          }),
        ),
        Effect.catch((err) =>
          updateTask(
            task,
            { stage: "failed", lastError: err.detail },
            { stage: "failed", modelLabel, message: `审查未完成：${err.detail}` },
          ).pipe(Effect.ignore),
        ),
        Effect.ensuring(
          Ref.update(activeTaskFibers, (map) => {
            const next = new Map(map);
            next.delete(taskId);
            return next;
          }).pipe(Effect.andThen(publishSnapshot)),
        ),
        Effect.forkIn(serviceScope),
      );
      const fiber = yield* watcherFiber;
      yield* Ref.update(activeTaskFibers, (map) => new Map(map).set(taskId, fiber));
      yield* publishSnapshot;

      return {
        tasks: [task],
        jumpThreadId: launched.threadId,
        jumpProjectId: execProject.projectId,
      };
    }

    // Multi-Model Fusion Review Pipeline (supports 1..20 PRs in batch!)
    const createdAt = yield* nowIso;
    const createdTasks: PrReviewTask[] = [];

    for (const target of input.targets) {
      const taskId = PrReviewTaskId.make(`prrev-${NodeCrypto.randomUUID().slice(0, 10)}`);
      const initialRuns: PrReviewModelRun[] = activeSlots.map((slot) => ({
        slotId: slot.id,
        role: slot.role,
        modelSelection: slot.modelSelection,
        modelLabel: formatModelLabel(slot.modelSelection),
        status: "queued",
        threadId: null,
        reportMarkdown: null,
        error: null,
        startedAt: null,
        completedAt: null,
      }));

      const task: PrReviewTask = {
        id: taskId,
        presetId: matchedPreset?.id ?? null,
        presetName: matchedPreset?.name ?? null,
        provider: target.provider,
        host: target.host,
        projectId: target.projectId,
        projectTitle: target.projectTitle,
        repository: target.repository,
        prNumber: target.number,
        prTitle: target.title ?? `${target.repository}#${target.number}`,
        prUrl: target.url ?? `https://${target.host}/${target.repository}`,
        prAuthor: target.author ?? null,
        headBranch: target.headBranch ?? "head",
        baseBranch: target.baseBranch ?? "main",
        headSha: null,
        mode: "multi_model_fusion",
        stage: "queued",
        boundSkillNames: resolvedSkills.map((s) => s.name),
        reviewerRuns: initialRuns,
        synthesizerModelLabel: synthesizerModel ? formatModelLabel(synthesizerModel) : null,
        synthesisThreadId: null,
        verdict: null,
        summaryMarkdown: null,
        findings: [],
        commentSyncedAt: null,
        reviewSyncedAt: null,
        lastError: null,
        steps: [
          {
            at: createdAt,
            stage: "queued",
            message: `已加入多模型融合审查队列（${activeSlots.length} 个并行审查模型${resolvedSkills.length > 0 ? ` · 绑定 ${resolvedSkills.length} 个 Skill` : ""}）`,
          },
        ],
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      };

      yield* repo.upsertTask(task).pipe(Effect.mapError(mapErr("upsertTask")));
      createdTasks.push(task);

      const fiber = yield* executeFusionPipeline(
        task,
        activeSlots,
        synthesizerModel,
        resolvedSkills,
        customInstructions,
        writeBackMode,
      ).pipe(Effect.forkIn(serviceScope));
      yield* Ref.update(activeTaskFibers, (map) => new Map(map).set(taskId, fiber));
    }

    yield* publishSnapshot;
    return {
      tasks: createdTasks,
      jumpThreadId: null,
      jumpProjectId: null,
    };
  });

  const cancelTask: PrReviewService["Service"]["cancelTask"] = Effect.fn(
    "PrReviewService.cancelTask",
  )(function* (input) {
    const fibers = yield* Ref.get(activeTaskFibers);
    const fiber = fibers.get(input.taskId);
    if (fiber) {
      yield* Fiber.interrupt(fiber);
    }
    const task = yield* repo.getTask(input.taskId).pipe(Effect.mapError(mapErr("getTask")));
    if (task && !isTerminalStage(task.stage)) {
      yield* updateTask(
        task,
        { stage: "cancelled" },
        { stage: "cancelled", message: "用户手动取消了审查任务" },
      );
    }
  });

  const writeBack: PrReviewService["Service"]["writeBack"] = Effect.fn("PrReviewService.writeBack")(
    function* (input) {
      const task = yield* repo.getTask(input.taskId).pipe(Effect.mapError(mapErr("getTask")));
      if (!task) {
        return yield* new PrReviewError({
          operation: "writeBack",
          detail: "未找到对应的审查任务记录",
        });
      }
      const syncedAt = yield* performWriteBack({
        task,
        kind: input.kind,
        verdict: input.verdict,
        body: input.body,
        inlineFindingIds: input.inlineFindingIds,
      });
      return { ok: true, syncedAt };
    },
  );

  const subscribe: PrReviewService["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      const initial = yield* buildSnapshot;
      return Stream.concat(Stream.make(initial), Stream.fromPubSub(updatesPubSub));
    }),
  );

  return PrReviewService.of({
    listSkills: discoverSkills,
    getState: buildSnapshot,
    subscribe,
    savePreset,
    deletePreset,
    startReview,
    cancelTask,
    writeBack,
  });
});

export const layer = Layer.effect(PrReviewService, make).pipe(
  Layer.provide(PrReviewRepository.layer),
);
