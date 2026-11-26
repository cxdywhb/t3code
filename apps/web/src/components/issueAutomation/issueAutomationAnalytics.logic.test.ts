import {
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  IssueAutomationTaskId,
  ProjectId,
  ProviderInstanceId,
  type IssueAutomationTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  computeIssueAutomationAnalytics,
  DEFAULT_WORKBENCH_PREFS,
  formatCompactDuration,
  groupIssueAutomationTasks,
  IssueAutomationWorkbenchPrefsSchema,
  makeScopePrefKey,
  resolvePersistedModelSelection,
  resolvePersistedTarget,
  resolveTaskDurationMs,
  sortScopesByIdDesc,
} from "./issueAutomationAnalytics.logic";

const decodeWorkbenchPrefs = Schema.decodeSync(IssueAutomationWorkbenchPrefsSchema);

it("groups repeated attempts by connector and bug, with the newest attempt first", () => {
  const cancelled = makeTask({
    id: "first",
    stage: "cancelled",
    createdAt: "2026-11-24T01:00:00Z",
    updatedAt: "2026-11-24T03:00:00Z",
  });
  const completed = makeTask({
    id: "second",
    stage: "completed",
    createdAt: "2026-11-24T02:00:00Z",
  });
  const otherConnector = makeTask({
    id: "other",
    connectorId: IssueAutomationConnectorId.make("conn-2"),
    createdAt: "2026-11-24T00:00:00Z",
  });
  expect(
    groupIssueAutomationTasks([cancelled, otherConnector, completed]).map(
      ({ latest, attempts }) => ({
        latest: latest.id,
        attempts: attempts.map((task) => task.id),
      }),
    ),
  ).toEqual([
    { latest: "second", attempts: ["second", "first"] },
    { latest: "other", attempts: ["other"] },
  ]);
});

function makeTask(
  overrides: Omit<Partial<IssueAutomationTask>, "id"> & { id: string },
): IssueAutomationTask {
  return {
    id: IssueAutomationTaskId.make(overrides.id),
    profileId: overrides.profileId ?? null,
    connectorId: overrides.connectorId ?? IssueAutomationConnectorId.make("conn-1"),
    platform: overrides.platform ?? IssueAutomationPlatformKind.make("zentao"),
    scopeId: overrides.scopeId ?? "1",
    scopeName: overrides.scopeName ?? "Storefront Core",
    issueKey: overrides.issueKey ?? "101",
    displayKey: overrides.displayKey ?? "#101",
    issueTitle: overrides.issueTitle ?? "Order total rounding mismatch",
    issueUrl: overrides.issueUrl ?? "https://zentao.example.com/zentao/bug-view-101.html",
    moduleName: overrides.moduleName ?? "Checkout",
    severity: overrides.severity !== undefined ? overrides.severity : 3,
    priority: overrides.priority !== undefined ? overrides.priority : 2,
    issueStatus: overrides.issueStatus ?? "active",
    assignee: overrides.assignee ?? null,
    trigger: overrides.trigger ?? "poll",
    actionMode: overrides.actionMode ?? "fix_worktree_review",
    stage: overrides.stage ?? "completed",
    targetProjectId:
      overrides.targetProjectId !== undefined
        ? overrides.targetProjectId
        : ProjectId.make("proj-checkout"),
    referenceProjectIds: overrides.referenceProjectIds ?? [],
    primaryThreadId: overrides.primaryThreadId ?? null,
    reviewThreadId: overrides.reviewThreadId ?? null,
    assignedModelLabel: overrides.assignedModelLabel ?? "codex:gpt-5",
    worktreeBranch:
      overrides.worktreeBranch !== undefined ? overrides.worktreeBranch : "fix/bug-101",
    diagnosisReport:
      overrides.diagnosisReport !== undefined
        ? overrides.diagnosisReport
        : "## 问题根因分析\nFixed.",
    reviewReport: overrides.reviewReport ?? null,
    commentSyncedAt:
      overrides.commentSyncedAt !== undefined
        ? overrides.commentSyncedAt
        : "2026-11-20T22:02:00.000Z",
    stateSyncedAt: overrides.stateSyncedAt ?? null,
    remoteUpdatedMarker: overrides.remoteUpdatedMarker ?? null,
    lastError: overrides.lastError ?? null,
    steps: overrides.steps ?? [],
    createdAt: overrides.createdAt ?? "2026-11-20T22:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-11-20T22:02:00.000Z",
    completedAt:
      overrides.completedAt !== undefined ? overrides.completedAt : "2026-11-20T22:02:00.000Z",
  };
}

describe("issueAutomationAnalytics.logic", () => {
  it("computes completion rate, success rate, deduplicated ROI hours, and leaderboards", () => {
    const nowMs = Date.parse("2026-11-21T12:00:00.000Z");
    const tasks: IssueAutomationTask[] = [
      // Critical Worktree fix completed (1.2h * 1.3 = 1.56h), run twice and deduplicated once.
      makeTask({
        id: "t-1",
        issueKey: "101",
        severity: 1,
        issueStatus: "resolved",
        stateSyncedAt: "2026-11-20T22:02:00.000Z",
        createdAt: "2026-11-20T22:00:00.000Z",
        completedAt: "2026-11-20T22:01:30.000Z",
        steps: [
          { at: "2026-11-20T22:00:00.000Z", stage: "enriching", message: "fetch" },
          { at: "2026-11-20T22:00:10.000Z", stage: "diagnosing", message: "diag" },
          { at: "2026-11-20T22:01:10.000Z", stage: "reviewing", message: "review" },
          { at: "2026-11-20T22:01:25.000Z", stage: "writing_back", message: "sync" },
        ],
      }),
      makeTask({
        id: "t-1-old-fail",
        issueKey: "101",
        severity: 1,
        stage: "failed",
        worktreeBranch: null,
        diagnosisReport: null,
        commentSyncedAt: null,
        completedAt: "2026-11-20T21:55:00.000Z",
        createdAt: "2026-11-20T21:54:00.000Z",
      }),
      // Diagnose-only run intercepted by cross-review (0.5h).
      makeTask({
        id: "t-2",
        issueKey: "102",
        severity: 3,
        trigger: "manual",
        actionMode: "diagnose_only",
        worktreeBranch: null,
        stage: "needs_human",
        reviewReport: "【需人工复核】",
        assignedModelLabel: "claude:sonnet",
        createdAt: "2026-11-21T10:00:00.000Z",
        completedAt: "2026-11-21T10:03:00.000Z",
      }),
      // Active run still in flight.
      makeTask({
        id: "t-3",
        issueKey: "103",
        stage: "diagnosing",
        completedAt: null,
        commentSyncedAt: null,
        worktreeBranch: null,
        diagnosisReport: null,
        createdAt: "2026-11-21T11:59:00.000Z",
      }),
    ];

    const summary = computeIssueAutomationAnalytics({
      tasks,
      range: "7d",
      scopeMode: "all",
      currentConnectorId: "conn-1",
      currentScopeId: "1",
      projectTitleById: new Map([["proj-checkout", "checkout-service"]]),
      nowMs,
    });

    expect(summary.uniqueIssuesCount).toBe(3);
    expect(summary.totalRunsCount).toBe(4);
    // Valid runs = 4 (0 cancelled), concluded = 2 (t-1 completed + t-2 needs_human) => 50%
    expect(summary.completionRate).toBe(50);
    // Finished runs = 3 (1 completed, 1 needs_human, 1 failed) => 1 / 3 = 33.3%
    expect(summary.successRate).toBe(33.3);
    // Deduplicated hours: 1.56h + 0.5h = 2.06h -> 2.1h
    expect(summary.estimatedHoursSaved).toBe(2.1);
    expect(summary.crossReviewInterceptCount).toBe(1);
    expect(summary.criticalUniqueCount).toBe(1);
    expect(summary.criticalSuccessRate).toBe(100);
    // Duration across t-1 (90s) and t-2 (180s) -> avg 135s, median 135s
    expect(summary.avgDurationMs).toBe(135_000);
    expect(summary.medianDurationMs).toBe(135_000);
    expect(summary.modelLeaderboard.map((m) => m.modelLabel)).toEqual([
      "codex:gpt-5",
      "claude:sonnet",
    ]);
    expect(summary.repoHotspots[0]?.title).toBe("checkout-service");
    expect(summary.stageLatencies.find((s) => s.id === "primary_diagnosis")?.avgDurationMs).toBe(
      60_000,
    );
  });

  it("restores per-product persisted choices and falls back cleanly when stale", () => {
    const scopeKey = makeScopePrefKey("conn-1", "prod-2");
    const prefs = {
      ...DEFAULT_WORKBENCH_PREFS,
      projectByScope: { [scopeKey]: "proj-b", "conn-1::prod-deleted": "proj-gone" },
      lastProjectId: "proj-a",
      modelByScope: { [scopeKey]: "codex::gpt-5" },
      lastModelKey: "claude::sonnet",
    };

    const hit = resolvePersistedTarget({
      prefs,
      scopeKey,
      profilePrimaryProjectId: "proj-a",
      profilePrimaryModelKey: "claude::sonnet",
      profileActionMode: null,
      validProjectIds: ["proj-a", "proj-b"],
      validModelKeys: ["claude::sonnet", "codex::gpt-5"],
    });
    expect(hit.projectId).toBe("proj-b");
    expect(hit.modelKey).toBe("codex::gpt-5");

    const fallback = resolvePersistedTarget({
      prefs,
      scopeKey: "conn-1::prod-deleted",
      profilePrimaryProjectId: null,
      profilePrimaryModelKey: "",
      profileActionMode: null,
      validProjectIds: ["proj-a", "proj-b"],
      validModelKeys: ["claude::sonnet"],
    });
    expect(fallback.projectId).toBe("proj-a");
    expect(fallback.modelKey).toBe("claude::sonnet");
    expect(formatCompactDuration(138_000)).toBe("2m 18s");
    expect(DEFAULT_WORKBENCH_PREFS.browseType).toBe("unresolved");

    const scopes = sortScopesByIdDesc([
      { id: "22", name: "Old" },
      { id: "83", name: "Newer" },
      { id: "108", name: "Newest" },
    ]);
    expect(scopes.map((s) => s.id)).toEqual(["108", "83", "22"]);

    const activeTask = makeTask({
      id: "t-live",
      stage: "diagnosing",
      createdAt: "2026-11-21T12:52:00.000Z",
      completedAt: null,
    });
    const nowEpochMs = Date.parse("2026-11-21T12:54:26.000Z");
    expect(formatCompactDuration(resolveTaskDurationMs(activeTask, nowEpochMs))).toBe("2m 26s");
  });

  it("decodes legacy workbench prefs without ModelSelection fields and prioritizes structured ModelSelection with options", () => {
    const decodedLegacy = decodeWorkbenchPrefs({
      ...DEFAULT_WORKBENCH_PREFS,
      modelByScope: { "conn-1::10": "codex-default::gpt-5" },
      lastModelKey: "claude-default::claude-sonnet-4-6",
    });

    const codexId = ProviderInstanceId.make("codex-default");
    const claudeId = ProviderInstanceId.make("claude-default");

    // Migrates legacy key when structured selection is absent
    expect(
      resolvePersistedModelSelection({
        prefs: decodedLegacy,
        scopeKey: "conn-1::10",
        profilePrimaryModel: null,
        fallbackSelection: { instanceId: claudeId, model: "claude-sonnet-4-6" },
      }),
    ).toEqual({ instanceId: codexId, model: "gpt-5" });

    // Structured selection with options outranks legacy string keys
    const prefsWithOptions = {
      ...decodedLegacy,
      modelSelectionByScope: {
        "conn-1::10": {
          instanceId: codexId,
          model: "gpt-5.4",
          options: [{ id: "reasoningEffort", value: "xhigh" }],
        },
      },
      lastModelSelection: {
        instanceId: claudeId,
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "high" }],
      },
    };

    expect(
      resolvePersistedModelSelection({
        prefs: prefsWithOptions,
        scopeKey: "conn-1::10",
        profilePrimaryModel: { instanceId: claudeId, model: "claude-sonnet-4-6" },
        fallbackSelection: null,
      }),
    ).toEqual({
      instanceId: codexId,
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
    });

    // Falls back from stale scoped selection -> profile primaryModel -> lastModelSelection
    expect(
      resolvePersistedModelSelection({
        prefs: prefsWithOptions,
        scopeKey: "conn-1::10",
        profilePrimaryModel: { instanceId: claudeId, model: "claude-sonnet-4-6" },
        isSelectionAvailable: (sel) => sel.model !== "gpt-5.4" && sel.model !== "gpt-5",
        fallbackSelection: null,
      }),
    ).toEqual({ instanceId: claudeId, model: "claude-sonnet-4-6" });

    expect(
      resolvePersistedModelSelection({
        prefs: prefsWithOptions,
        scopeKey: "conn-1::other",
        profilePrimaryModel: null,
        fallbackSelection: null,
      }),
    ).toEqual({
      instanceId: claudeId,
      model: "claude-sonnet-4-6",
      options: [{ id: "effort", value: "high" }],
    });
  });
});
