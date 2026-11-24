import {
  PositiveInt,
  PrReviewPresetId,
  PrReviewTaskId,
  ProjectId,
  ProviderInstanceId,
  PullRequestDetail,
  PullRequestOperationError,
  SourceControlProviderKind,
  ThreadId,
  TrimmedNonEmptyString,
  type PrReviewPreset,
  type PrReviewTask,
  type PullRequestSubmitReviewInput,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import {
  FUSION_BOT_SIGNATURE,
  buildPrContextDocument,
  buildReviewerMessage,
  buildReviewerReportsDocument,
  buildSynthesizerMessage,
  formatFusionWriteBackMarkdown,
  parseDiffFileManifest,
  parseSynthesizerOutput,
} from "./PrReviewPrompts.ts";
import * as PrReviewRepository from "./PrReviewRepository.ts";
import * as PrReviewService from "./PrReviewService.ts";

const SAMPLE_DETAIL: Parameters<typeof buildReviewerMessage>[0]["detail"] = {
  provider: SourceControlProviderKind.make("gitlab"),
  repository: "platform/core-api",
  number: 42,
  title: "feat(auth): harden token rotation lock",
  body: "Ensures concurrent refresh requests serialize on the session key.",
  url: "https://gitlab.example.test/platform/core-api/-/merge_requests/42",
  state: "open",
  isDraft: false,
  author: { login: "alex", name: "Alex Doe", avatarUrl: null },
  headBranch: "feat/token-lock",
  baseBranch: "main",
  headSha: "abcdef1234567890abcdef1234567890abcdef12",
  additions: 48,
  deletions: 12,
  changedFiles: 2,
};

it("parses structured json:t3-pr-fusion output, strips the JSON fence from Markdown, and falls back gracefully when omitted", () => {
  const rawWithFence = [
    "## 总体裁决结论",
    "并发锁在异常分支下存在未释放风险，建议修复后再合并。",
    "",
    "```json:t3-pr-fusion",
    JSON.stringify({
      verdict: "request-changes",
      findings: [
        {
          severity: "blocker",
          title: "异常分支未释放分布式锁",
          filePath: "src/auth/rotate.ts",
          line: 87,
          description: "refreshUpstream 抛出异常时未进入 finally 释放锁。",
          suggestion: "使用 try / finally 包裹锁生命周期。",
          raisedByModels: ["Claude Opus 4.6", "Codex GPT-5.4"],
        },
      ],
    }),
    "```",
  ].join("\n");

  const parsed = parseSynthesizerOutput(rawWithFence, ["Fallback Model"]);
  assert.strictEqual(parsed.verdict, "request-changes");
  assert.notInclude(parsed.summaryMarkdown, "json:t3-pr-fusion");
  assert.include(parsed.summaryMarkdown, "## 总体裁决结论");
  assert.strictEqual(parsed.findings.length, 1);
  assert.deepStrictEqual(parsed.findings[0], {
    id: TrimmedNonEmptyString.make("finding-1"),
    severity: "blocker",
    title: "异常分支未释放分布式锁",
    filePath: "src/auth/rotate.ts",
    line: PositiveInt.make(87),
    description: "refreshUpstream 抛出异常时未进入 finally 释放锁。",
    suggestion: "使用 try / finally 包裹锁生命周期。",
    raisedByModels: ["Claude Opus 4.6", "Codex GPT-5.4"],
  });

  const proseOnly = parseSynthesizerOutput("## 审查结论\n整体实现清晰，LGTM，建议通过。", [
    "Claude Sonnet",
  ]);
  assert.strictEqual(proseOnly.verdict, "approve");
  assert.strictEqual(proseOnly.findings.length, 0);
});

it("builds token-saving reviewer & synthesizer messages with PR and Skill chips and offloads raw diff/comments to files", () => {
  const patch = [
    "diff --git a/src/auth/rotate.ts b/src/auth/rotate.ts",
    "index 1111111..2222222 100644",
    "--- a/src/auth/rotate.ts",
    "+++ b/src/auth/rotate.ts",
    "@@ -1,1 +1,2 @@",
    "+export const lock = true;",
    "-export const lock = false;",
    "diff --git a/package-lock.json b/package-lock.json",
    "--- a/package-lock.json",
    "+++ b/package-lock.json",
    "@@ -1,1 +1,1 @@",
    '+  "version": "1.0.1"',
  ].join("\n");

  const manifest = parseDiffFileManifest(patch);
  assert.strictEqual(manifest.files.length, 2);
  assert.deepStrictEqual(manifest.files[0], {
    path: "src/auth/rotate.ts",
    additions: 1,
    deletions: 1,
    isBinary: false,
    isLikelyGenerated: false,
  });
  assert.isTrue(manifest.files[1]?.isLikelyGenerated);

  const skills = [
    {
      name: TrimmedNonEmptyString.make("security-audit"),
      displayName: "Security Audit",
      description: "OWASP & auth checklist",
      path: TrimmedNonEmptyString.make("/workspace/.agents/skills/security-audit/SKILL.md"),
      source: "workspace" as const,
    },
  ];

  const built = buildReviewerMessage({
    detail: SAMPLE_DETAIL,
    manifest,
    diffFilePath: "/tmp/pr-42/diff.patch",
    contextFilePath: "/tmp/pr-42/context.md",
    role: "security",
    isLocalCheckout: false,
    workspaceRoot: "/tmp",
    skills,
    customInstructions: "重点核查多租户隔离。",
    interactiveDirectMode: true,
  });

  // Visible thread text stays compact and uses native PR & Skill chips instead of dumping raw diff/body.
  assert.isBelow(built.text.length, 400);
  assert.include(built.text, "[#42](t3-context://v1/review-comment/");
  assert.include(built.text, "[Security Audit](t3-context://v1/skill/");
  assert.include(built.text, "重点核查多租户隔离。");
  assert.notInclude(built.text, "+export const lock = true;");
  assert.notInclude(built.text, "diff --git");

  const prRecord = built.context.records.find((r) => r.kind === "review-comment");
  if (!prRecord || prRecord.kind !== "review-comment" || !("diff" in prRecord)) {
    throw new Error("Expected review-comment record");
  }
  assert.strictEqual(prRecord.diff, "");
  assert.deepStrictEqual(prRecord.pullRequest, {
    number: PositiveInt.make(42),
    title: "feat(auth): harden token rotation lock",
    url: "https://gitlab.example.test/platform/core-api/-/merge_requests/42",
    headBranch: "feat/token-lock",
    baseBranch: "main",
    state: "open",
    isDraft: false,
  });
  assert.include(prRecord.text, "/tmp/pr-42/diff.patch");
  assert.include(prRecord.text, "/tmp/pr-42/context.md");
  assert.include(prRecord.text, "/workspace/.agents/skills/security-audit/SKILL.md");
  assert.include(prRecord.text, "重点核查多租户隔离。");

  const skillRecord = built.context.records.find((r) => r.kind === "skill");
  if (!skillRecord || skillRecord.kind !== "skill" || !("name" in skillRecord)) {
    throw new Error("Expected skill record");
  }
  assert.strictEqual(skillRecord.name, "security-audit");

  const contextDoc = buildPrContextDocument({
    detail: SAMPLE_DETAIL,
    activity: null,
    manifestText: manifest.formattedManifest,
  });
  assert.include(contextDoc, "Ensures concurrent refresh requests serialize on the session key.");
  assert.include(contextDoc, "`src/auth/rotate.ts` (+1/-1)");

  const reportsDoc = buildReviewerReportsDocument({
    detail: SAMPLE_DETAIL,
    reviewerRuns: [],
  });
  assert.include(reportsDoc, "platform/core-api!42");

  const synth = buildSynthesizerMessage({
    detail: SAMPLE_DETAIL,
    diffFilePath: "/tmp/pr-42/diff.patch",
    contextFilePath: "/tmp/pr-42/context.md",
    reportsFilePath: "/tmp/pr-42/reviewer-reports.md",
    isLocalCheckout: false,
    workspaceRoot: "/tmp",
    reviewerRuns: [],
    skills,
    customInstructions: null,
  });
  assert.isBelow(synth.text.length, 400);
  assert.include(synth.text, "[#42](t3-context://v1/review-comment/");
  assert.include(synth.text, "[Security Audit](t3-context://v1/skill/");

  const markdown = formatFusionWriteBackMarkdown({
    verdict: "request-changes",
    reviewerModels: ["Claude Opus 4.6", "Codex GPT-5.4"],
    synthesizerModel: "Claude Opus 4.6",
    boundSkills: ["security-audit"],
    summaryMarkdown: "请修复锁释放问题。",
  });
  assert.include(markdown, "⚠️ **建议修改 (Request Changes)**");
  assert.include(markdown, "`security-audit`");
  assert.include(markdown, FUSION_BOT_SIGNATURE);
});

const repoLayer = PrReviewRepository.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));

it.effect(
  "persists presets with single-default exclusivity and updates multi-model review tasks in SQLite",
  () =>
    Effect.gen(function* () {
      const repo = yield* PrReviewRepository.PrReviewRepository;

      const presetA: PrReviewPreset = {
        id: PrReviewPresetId.make("preset-a"),
        name: TrimmedNonEmptyString.make("双模型快速审查"),
        description: "Correctness + Security",
        isDefault: true,
        reviewerModels: [
          {
            id: TrimmedNonEmptyString.make("slot-1"),
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: TrimmedNonEmptyString.make("claude-sonnet-4-6"),
            },
            role: "correctness",
            enabled: true,
          },
        ],
        synthesizerModel: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: TrimmedNonEmptyString.make("claude-opus-4-6"),
        },
        boundSkillNames: [TrimmedNonEmptyString.make("security-audit")],
        customInstructions: "No regressions",
        writeBackMode: "manual",
        updatedAt: "2026-11-21T10:00:00.000Z",
      };

      const presetB: PrReviewPreset = {
        ...presetA,
        id: PrReviewPresetId.make("preset-b"),
        name: TrimmedNonEmptyString.make("三模型深度会诊"),
        isDefault: true,
        updatedAt: "2026-11-21T11:00:00.000Z",
      };

      yield* repo.upsertPreset(presetA);
      yield* repo.upsertPreset(presetB);

      const presets = yield* repo.listPresets;
      assert.strictEqual(presets.length, 2);
      assert.strictEqual(presets[0]?.id, "preset-b");
      assert.isTrue(presets[0]?.isDefault);
      assert.strictEqual(presets[1]?.id, "preset-a");
      assert.isFalse(presets[1]?.isDefault);

      const task: PrReviewTask = {
        id: PrReviewTaskId.make("task-1"),
        presetId: presetB.id,
        presetName: presetB.name,
        provider: SourceControlProviderKind.make("gitlab"),
        host: TrimmedNonEmptyString.make("gitlab.example.test"),
        projectId: ProjectId.make("cloud:gitlab.example.test"),
        projectTitle: "platform/core-api",
        repository: TrimmedNonEmptyString.make("platform/core-api"),
        prNumber: PositiveInt.make(42),
        prTitle: "feat(auth): harden token rotation lock",
        prUrl: "https://gitlab.example.test/platform/core-api/-/merge_requests/42",
        prAuthor: "alex",
        headBranch: "feat/token-lock",
        baseBranch: "main",
        headSha: "abcdef123456",
        mode: "multi_model_fusion",
        stage: "parallel_reviewing",
        boundSkillNames: ["security-audit"],
        reviewerRuns: [
          {
            slotId: TrimmedNonEmptyString.make("slot-1"),
            modelLabel: "Claude Sonnet",
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: TrimmedNonEmptyString.make("claude-sonnet-4-6"),
            },
            role: "correctness",
            threadId: ThreadId.make("thread-r1"),
            status: "running",
            reportMarkdown: null,
            startedAt: "2026-11-21T11:01:00.000Z",
            completedAt: null,
            error: null,
          },
        ],
        synthesizerModelLabel: "Claude Opus",
        synthesisThreadId: null,
        verdict: null,
        summaryMarkdown: null,
        findings: [],
        commentSyncedAt: null,
        reviewSyncedAt: null,
        lastError: null,
        steps: [
          {
            at: "2026-11-21T11:01:00.000Z",
            stage: "parallel_reviewing",
            message: "Started parallel reviewers",
          },
        ],
        createdAt: "2026-11-21T11:01:00.000Z",
        updatedAt: "2026-11-21T11:01:00.000Z",
        completedAt: null,
      };

      yield* repo.upsertTask(task);
      yield* repo.upsertTask({
        ...task,
        stage: "completed",
        verdict: "approve",
        summaryMarkdown: "All clear.",
        reviewSyncedAt: "2026-11-21T11:05:00.000Z",
        completedAt: "2026-11-21T11:05:00.000Z",
        updatedAt: "2026-11-21T11:05:00.000Z",
      });

      const loaded = yield* repo.getTask(task.id);
      assert.isNotNull(loaded);
      assert.strictEqual(loaded?.stage, "completed");
      assert.strictEqual(loaded?.verdict, "approve");
      assert.strictEqual(loaded?.reviewSyncedAt, "2026-11-21T11:05:00.000Z");

      yield* repo.deletePreset(presetA.id);
      assert.strictEqual((yield* repo.listPresets).length, 1);
    }).pipe(Effect.provide(repoLayer)),
);

it.effect(
  "writes back formal reviews with resolved diff positions, downgrades unsupported GitLab request-changes and self-reviews without duplicate notes",
  () =>
    Effect.gen(function* () {
      const submittedReviews: PullRequestSubmitReviewInput[] = [];
      let viewerLogin = "reviewer";

      const samplePatch = [
        "diff --git a/src/old.ts b/src/new.ts",
        "--- a/src/old.ts",
        "+++ b/src/new.ts",
        "@@ -10,3 +10,4 @@",
        " const kept = 1;",
        "+const added = 2;",
        " const trailing = 3;",
      ].join("\n");

      const decodeDetail = Schema.decodeUnknownEffect(PullRequestDetail);
      const prMock = Layer.mock(PullRequestService.PullRequestService)({
        detail: () =>
          decodeDetail({
            ...SAMPLE_DETAIL,
            projectId: "cloud:gitlab.example.test",
            projectTitle: "platform/core-api",
            workspaceRoot: "/tmp",
            capabilities: {
              diff: true,
              comment: true,
              actions: [],
              mergeMethods: ["merge"],
              deleteBranch: false,
              updateMethods: [],
              search: true,
              reactions: true,
              mentions: true,
              referenceSigils: ["#", "!"],
              viewedFiles: "environment",
              review: {
                inlineComment: true,
                rangeComment: true,
                reply: true,
                resolve: true,
                verdicts: ["comment", "approve", "request-changes"],
              },
              reviewers: { request: true, listCandidates: true, searchCandidates: true },
              labels: true,
            },
            mergeability: "mergeable",
            viewerPermissions: {
              actions: [],
              comment: true,
              resolve: true,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: true,
              maintainerEdits: false,
              labels: true,
            },
            mergedAt: null,
            closedAt: null,
            createdAt: "2026-11-21T10:00:00.000Z",
            updatedAt: "2026-11-21T10:05:00.000Z",
            reviewers: [],
            labels: [],
            checks: [],
            mergeCapabilities: {
              merge: true,
              squash: true,
              rebase: true,
            },
            viewer: viewerLogin,
          }).pipe(Effect.orDie),
        diff: () => Effect.succeed({ patch: samplePatch, truncated: false, nextCursor: null }),
        submitReview: (input) => {
          submittedReviews.push(input);
          if (input.verdict === "request-changes") {
            return Effect.fail(
              new PullRequestOperationError({
                operation: "submitReview",
                detail:
                  "GitLab refused it: Field 'mergeRequestRequestChanges' doesn't exist on type 'Mutation'",
              }),
            );
          }
          if (input.verdict === "approve") {
            return Effect.fail(
              new PullRequestOperationError({
                operation: "submitReview",
                detail: "GitLab refused approval",
              }),
            );
          }
          return Effect.void;
        },
        comment: () => Effect.void,
      });

      const baseTask: PrReviewTask = {
        id: PrReviewTaskId.make("task-wb"),
        presetId: null,
        presetName: null,
        provider: SourceControlProviderKind.make("gitlab"),
        host: TrimmedNonEmptyString.make("gitlab.example.test"),
        projectId: ProjectId.make("cloud:gitlab.example.test"),
        projectTitle: "platform/core-api",
        repository: TrimmedNonEmptyString.make("platform/core-api"),
        prNumber: PositiveInt.make(42),
        prTitle: "feat(auth): harden token rotation lock",
        prUrl: "https://gitlab.example.test/platform/core-api/-/merge_requests/42",
        prAuthor: "alex",
        headBranch: "feat/token-lock",
        baseBranch: "main",
        headSha: "abcdef123456",
        mode: "multi_model_fusion",
        stage: "completed",
        boundSkillNames: [],
        reviewerRuns: [],
        synthesizerModelLabel: "Claude Opus",
        synthesisThreadId: null,
        verdict: "request-changes",
        summaryMarkdown: "## 审查报告\n存在问题。",
        findings: [
          {
            id: TrimmedNonEmptyString.make("f-context"),
            severity: "major",
            title: "Context line issue",
            filePath: "src/new.ts",
            line: PositiveInt.make(10),
            description: "Context line in renamed file.",
            suggestion: null,
            raisedByModels: ["Claude Opus"],
          },
          {
            id: TrimmedNonEmptyString.make("f-added"),
            severity: "blocker",
            title: "Added line issue",
            filePath: "b/src/new.ts",
            line: PositiveInt.make(11),
            description: "Added line with b/ prefix.",
            suggestion: null,
            raisedByModels: ["Claude Opus"],
          },
          {
            id: TrimmedNonEmptyString.make("f-outside"),
            severity: "minor",
            title: "Out of hunk line",
            filePath: "src/new.ts",
            line: PositiveInt.make(99),
            description: "Outside diff hunk.",
            suggestion: null,
            raisedByModels: ["Claude Opus"],
          },
        ],
        commentSyncedAt: null,
        reviewSyncedAt: null,
        lastError: null,
        steps: [],
        createdAt: "2026-11-21T11:01:00.000Z",
        updatedAt: "2026-11-21T11:01:00.000Z",
        completedAt: "2026-11-21T11:05:00.000Z",
      };

      const baseLayer = Layer.mergeAll(PrReviewRepository.layer, PrReviewService.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            SqlitePersistence.layerMemory,
            prMock,
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-pr-review-test-" }),
            Layer.mock(ProjectService.ProjectService)({ listShells: () => Effect.succeed([]) }),
            Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
              namedProjectsRoot: "/tmp/projects",
            }),
            Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
            Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(Orchestrator.OrchestratorV2)({}),
          ),
        ),
        Layer.provideMerge(NodeServices.layer),
      );

      yield* Effect.gen(function* () {
        const repo = yield* PrReviewRepository.PrReviewRepository;
        const service = yield* PrReviewService.PrReviewService;
        yield* repo.upsertTask(baseTask);

        // 1. GitLab < 18.9 / CE refuses request-changes -> falls back to comment keeping in-hunk inline comments!
        const res1 = yield* service.writeBack({
          taskId: baseTask.id,
          kind: "review",
          verdict: "request-changes",
          body: TrimmedNonEmptyString.make("Formal review summary"),
          inlineFindingIds: [
            TrimmedNonEmptyString.make("f-context"),
            TrimmedNonEmptyString.make("f-added"),
            TrimmedNonEmptyString.make("f-outside"),
          ],
        });
        assert.isTrue(res1.ok);
        const commentPass = submittedReviews.find((r) => r.verdict === "comment");
        assert.isDefined(commentPass);
        assert.strictEqual(commentPass?.comments.length, 2);
        assert.deepStrictEqual(commentPass?.comments[0]?.oldPath, "src/old.ts");
        assert.deepStrictEqual(commentPass?.comments[0]?.position, {
          kind: "context",
          oldLine: 10,
          newLine: 10,
          side: "right",
        });
        assert.deepStrictEqual(commentPass?.comments[1]?.path, "src/new.ts");
        assert.deepStrictEqual(commentPass?.comments[1]?.position, {
          kind: "added",
          newLine: 11,
        });

        // 2. Self-review with approve verdict -> downgrades to comment before posting, zero duplicate bodies!
        submittedReviews.length = 0;
        viewerLogin = "alex";
        const res2 = yield* service.writeBack({
          taskId: baseTask.id,
          kind: "review",
          verdict: "approve",
          body: TrimmedNonEmptyString.make("Self review summary"),
          inlineFindingIds: [],
        });
        assert.isTrue(res2.ok);
        const nonEmptyBodies = submittedReviews.filter((r) => r.body.trim().length > 0);
        assert.strictEqual(nonEmptyBodies.length, 1);
        assert.strictEqual(nonEmptyBodies[0]?.verdict, "comment");
      }).pipe(Effect.provide(baseLayer));
    }).pipe(Effect.scoped),
);
