import {
  PositiveInt,
  PrReviewTaskId,
  ProjectId,
  ProviderInstanceId,
  SourceControlProviderKind,
  ThreadId,
  TrimmedNonEmptyString,
  type PrReviewTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  computeParallelSpeedup,
  computePrReviewAnalytics,
  extractTaskDiffStats,
} from "./prReviewAnalytics.logic";

function makeTask(id: string, overrides: Partial<Omit<PrReviewTask, "id">> = {}): PrReviewTask {
  return {
    id: PrReviewTaskId.make(id),
    presetId: null,
    presetName: "Enterprise Gate",
    provider: SourceControlProviderKind.make("gitlab"),
    host: TrimmedNonEmptyString.make("gitlab.example.test"),
    projectId: ProjectId.make("cloud:gitlab.example.test"),
    projectTitle: "api-gateway",
    repository: TrimmedNonEmptyString.make("acme/platform/api-gateway"),
    prNumber: PositiveInt.make(4),
    prTitle: "feat(auth): harden distributed session lock",
    prUrl: "https://gitlab.example.test/acme/platform/api-gateway/-/merge_requests/4",
    prAuthor: "alex",
    headBranch: "feat/session-lock",
    baseBranch: "main",
    headSha: "1234567890abcdef",
    mode: "multi_model_fusion",
    stage: "completed",
    boundSkillNames: ["security-audit"],
    reviewerRuns: [
      {
        slotId: TrimmedNonEmptyString.make("s1"),
        role: "correctness",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: TrimmedNonEmptyString.make("gpt-5.4"),
        },
        modelLabel: "codex:gpt-5.4",
        status: "completed",
        threadId: ThreadId.make("t-1"),
        reportMarkdown: "Found race condition",
        error: null,
        startedAt: "2026-11-22T01:20:10.000Z",
        completedAt: "2026-11-22T01:22:10.000Z",
      },
      {
        slotId: TrimmedNonEmptyString.make("s2"),
        role: "security",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: TrimmedNonEmptyString.make("claude-sonnet-4-6"),
        },
        modelLabel: "claudeAgent:claude-sonnet-4-6",
        status: "completed",
        threadId: ThreadId.make("t-2"),
        reportMarkdown: "Found token validation gap",
        error: null,
        startedAt: "2026-11-22T01:20:10.000Z",
        completedAt: "2026-11-22T01:22:00.000Z",
      },
    ],
    synthesizerModelLabel: "codex:gpt-5.4",
    synthesisThreadId: ThreadId.make("t-judge"),
    verdict: "request-changes",
    summaryMarkdown: "## Summary\nNeeds fixes before merge.",
    findings: [
      {
        id: TrimmedNonEmptyString.make("f1"),
        severity: "major",
        title: "Session lock release missing on error branch",
        filePath: "src/auth/sessionLock.ts",
        line: PositiveInt.make(34),
        description: "Lock handle leaks when upstream validation throws.",
        suggestion: "Release lock inside a finally block.",
        raisedByModels: ["codex:gpt-5.4", "claudeAgent:claude-sonnet-4-6"],
      },
      {
        id: TrimmedNonEmptyString.make("f2"),
        severity: "minor",
        title: "Concurrent retry counter race",
        filePath: "src/client/retry.ts",
        line: PositiveInt.make(84),
        description: "Two requests share mutable counter state.",
        suggestion: null,
        raisedByModels: ["codex:gpt-5.4"],
      },
    ],
    commentSyncedAt: "2026-11-22T01:23:05.000Z",
    reviewSyncedAt: null,
    lastError: null,
    steps: [
      {
        at: "2026-11-22T01:20:00.000Z",
        stage: "fetching_context",
        message: "Fetching diff...",
      },
      {
        at: "2026-11-22T01:20:10.000Z",
        stage: "parallel_reviewing",
        message: "已保存完整 Diff（+5918/-7141），正在并行调度 2 个模型执行深度审查...",
      },
      {
        at: "2026-11-22T01:22:10.000Z",
        stage: "synthesizing",
        message: "Synthesizing...",
      },
      {
        at: "2026-11-22T01:23:00.000Z",
        stage: "writing_back",
        message: "Writing back...",
      },
    ],
    createdAt: "2026-11-22T01:20:00.000Z",
    updatedAt: "2026-11-22T01:23:10.000Z",
    completedAt: "2026-11-22T01:23:10.000Z",
    ...overrides,
  };
}

describe("prReviewAnalytics.logic", () => {
  it("extracts diff stats from legacy and enriched step logs and computes parallel speedup", () => {
    const task = makeTask("t-1");
    const diff = extractTaskDiffStats(task);
    expect(diff).toEqual({
      additions: 5918,
      deletions: 7141,
      totalLines: 13059,
      changedFiles: null,
    });

    expect(computeParallelSpeedup(task)).toBe(1.92);
  });

  it("computes success/failure rates, latency percentiles, deduplicated ROI hours, consensus rate, and leaderboards", () => {
    const nowMs = Date.parse("2026-11-22T04:00:00.000Z");
    const run1 = makeTask("run-1");
    const run2SameMrFailed = makeTask("run-2", {
      stage: "failed",
      verdict: null,
      findings: [],
      commentSyncedAt: null,
      completedAt: "2026-11-22T02:01:00.000Z",
      createdAt: "2026-11-22T02:00:00.000Z",
      reviewerRuns: [
        {
          ...run1.reviewerRuns[0]!,
          status: "failed",
          error: "timeout",
        },
      ],
    });
    const run3OtherRepoApproved = makeTask("run-3", {
      repository: TrimmedNonEmptyString.make("acme/auth-service"),
      prNumber: PositiveInt.make(19),
      verdict: "approve",
      findings: [],
      createdAt: "2026-11-22T03:00:00.000Z",
      completedAt: "2026-11-22T03:01:30.000Z",
      steps: [
        {
          at: "2026-11-22T03:00:05.000Z",
          stage: "parallel_reviewing",
          message: "已保存完整 Diff（+180/-60，4 files），正在并行调度 2 个模型执行深度审查...",
        },
      ],
    });

    const summary = computePrReviewAnalytics({
      tasks: [run1, run2SameMrFailed, run3OtherRepoApproved],
      range: "30d",
      roiBaseline: "standard",
      nowMs,
    });

    expect(summary.uniquePrCount).toBe(2);
    expect(summary.totalRunsCount).toBe(3);
    expect(summary.completedCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.successRate).toBe(66.7);
    expect(summary.failureRate).toBe(33.3);
    expect(summary.totalLinesReviewed).toBe(13059 + 240);
    expect(summary.riskInterceptedPrCount).toBe(1);
    expect(summary.riskInterceptionRate).toBe(50);
    expect(summary.consensusFindingsCount).toBe(1);
    expect(summary.consensusRate).toBe(50);
    expect(summary.estimatedHoursSaved).toBeGreaterThan(2.5);
    expect(summary.estimatedHoursSaved).toBeLessThan(6.0);
    expect(summary.modelLeaderboard.length).toBe(2);
    expect(summary.repoHotspots.length).toBe(2);
    expect(summary.repoHotspots[0]?.repository).toBe("acme/platform/api-gateway");
  });
});
