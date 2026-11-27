import {
  IssueAutomationActionMode,
  IssueAutomationBrowseFilter,
  ModelSelection,
  ProviderInstanceId,
  type IssueAutomationStage,
  type IssueAutomationTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const WorkbenchTabSchema = Schema.Literals(["issues", "runs", "analytics", "rules"]);
export type WorkbenchTab = typeof WorkbenchTabSchema.Type;

export const RunStatusFilterSchema = Schema.Literals([
  "all",
  "active",
  "needs_human",
  "completed",
  "failed",
]);
export type RunStatusFilter = typeof RunStatusFilterSchema.Type;

export const AnalyticsTimeRangeSchema = Schema.Literals(["today", "7d", "30d", "all"]);
export type AnalyticsTimeRange = typeof AnalyticsTimeRangeSchema.Type;

export const AnalyticsScopeModeSchema = Schema.Literals(["all", "current"]);
export type AnalyticsScopeMode = typeof AnalyticsScopeModeSchema.Type;

export const IssueAutomationWorkbenchPrefsSchema = Schema.Struct({
  activeTab: WorkbenchTabSchema,
  selectedConnectorId: Schema.String,
  scopeByConnector: Schema.Record(Schema.String, Schema.String),
  browseType: IssueAutomationBrowseFilter,
  projectByScope: Schema.Record(Schema.String, Schema.String),
  lastProjectId: Schema.String,
  modelByScope: Schema.Record(Schema.String, Schema.String),
  lastModelKey: Schema.String,
  modelSelectionByScope: Schema.optional(Schema.Record(Schema.String, ModelSelection)),
  lastModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  modeByScope: Schema.Record(Schema.String, IssueAutomationActionMode),
  lastMode: IssueAutomationActionMode,
  runFilter: RunStatusFilterSchema,
  analyticsRange: AnalyticsTimeRangeSchema,
  analyticsScopeMode: AnalyticsScopeModeSchema,
  inspectorWidth: Schema.Number,
});
export type IssueAutomationWorkbenchPrefs = typeof IssueAutomationWorkbenchPrefsSchema.Type;

const DEFAULT_INSPECTOR_WIDTH = 660;

export const DEFAULT_WORKBENCH_PREFS: IssueAutomationWorkbenchPrefs = {
  activeTab: "issues",
  selectedConnectorId: "",
  scopeByConnector: {},
  browseType: "unresolved",
  projectByScope: {},
  lastProjectId: "",
  modelByScope: {},
  lastModelKey: "",
  modeByScope: {},
  lastMode: "fix_worktree_review",
  runFilter: "all",
  analyticsRange: "30d",
  analyticsScopeMode: "all",
  inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
};

function compareScopeIdDesc(a: { readonly id: string }, b: { readonly id: string }): number {
  const numA = Number(a.id);
  const numB = Number(b.id);
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
    return numB - numA;
  }
  return b.id.localeCompare(a.id, undefined, { numeric: true });
}

export function sortScopesByIdDesc<T extends { readonly id: string }>(
  scopes: ReadonlyArray<T>,
): T[] {
  return [...scopes].toSorted(compareScopeIdDesc);
}

export function makeScopePrefKey(connectorId: string | null | undefined, scopeId: string): string {
  if (!connectorId || !scopeId) return "";
  return `${connectorId}::${scopeId}`;
}

export function resolvePersistedTarget(input: {
  readonly prefs: IssueAutomationWorkbenchPrefs;
  readonly scopeKey: string;
  readonly profilePrimaryProjectId: string | null | undefined;
  readonly profilePrimaryModelKey: string;
  readonly profileActionMode: IssueAutomationActionMode | null | undefined;
  readonly validProjectIds: ReadonlyArray<string>;
  readonly validModelKeys: ReadonlyArray<string>;
}): {
  readonly projectId: string;
  readonly modelKey: string;
  readonly actionMode: IssueAutomationActionMode;
} {
  const isProjectValid = (id: string | null | undefined): id is string =>
    Boolean(id && input.validProjectIds.includes(id));
  const isModelValid = (key: string | null | undefined): key is string =>
    Boolean(key && input.validModelKeys.includes(key));

  const scopedProject = input.scopeKey ? input.prefs.projectByScope[input.scopeKey] : undefined;
  const projectId = isProjectValid(scopedProject)
    ? scopedProject
    : isProjectValid(input.profilePrimaryProjectId)
      ? input.profilePrimaryProjectId
      : isProjectValid(input.prefs.lastProjectId)
        ? input.prefs.lastProjectId
        : (input.validProjectIds[0] ?? "");

  const scopedModel = input.scopeKey ? input.prefs.modelByScope[input.scopeKey] : undefined;
  const modelKey = isModelValid(scopedModel)
    ? scopedModel
    : isModelValid(input.profilePrimaryModelKey)
      ? input.profilePrimaryModelKey
      : isModelValid(input.prefs.lastModelKey)
        ? input.prefs.lastModelKey
        : (input.validModelKeys[0] ?? "");

  const scopedMode = input.scopeKey ? input.prefs.modeByScope[input.scopeKey] : undefined;
  const actionMode: IssueAutomationActionMode =
    scopedMode ?? input.profileActionMode ?? input.prefs.lastMode;

  return { projectId, modelKey, actionMode };
}

function decodeLegacyModelOptionKey(key: string | null | undefined): ModelSelection | null {
  if (!key) return null;
  const sep = key.indexOf("::");
  if (sep <= 0) return null;
  const instanceId = key.slice(0, sep).trim();
  const model = key.slice(sep + 2).trim();
  if (!instanceId || !model) return null;
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    model,
  };
}

export function resolvePersistedModelSelection(input: {
  readonly prefs: IssueAutomationWorkbenchPrefs;
  readonly scopeKey: string;
  readonly profilePrimaryModel: ModelSelection | null | undefined;
  readonly isSelectionAvailable?: (selection: ModelSelection) => boolean;
  readonly fallbackSelection: ModelSelection | null;
}): ModelSelection | null {
  const isAvailable = (selection: ModelSelection | null | undefined): selection is ModelSelection =>
    Boolean(
      selection && (input.isSelectionAvailable ? input.isSelectionAvailable(selection) : true),
    );

  const scopedSelection = input.scopeKey
    ? input.prefs.modelSelectionByScope?.[input.scopeKey]
    : undefined;
  if (isAvailable(scopedSelection)) {
    return scopedSelection;
  }

  const scopedLegacyKey = input.scopeKey ? input.prefs.modelByScope[input.scopeKey] : undefined;
  const decodedScopedLegacy = decodeLegacyModelOptionKey(scopedLegacyKey);
  if (isAvailable(decodedScopedLegacy)) {
    return decodedScopedLegacy;
  }

  if (isAvailable(input.profilePrimaryModel)) {
    return input.profilePrimaryModel;
  }

  if (isAvailable(input.prefs.lastModelSelection)) {
    return input.prefs.lastModelSelection;
  }

  const decodedLastLegacy = decodeLegacyModelOptionKey(input.prefs.lastModelKey);
  if (isAvailable(decodedLastLegacy)) {
    return decodedLastLegacy;
  }

  return isAvailable(input.fallbackSelection) ? input.fallbackSelection : input.fallbackSelection;
}

export function isStageRunning(stage: IssueAutomationStage): boolean {
  return (
    stage === "queued" ||
    stage === "enriching" ||
    stage === "routing" ||
    stage === "diagnosing" ||
    stage === "reviewing" ||
    stage === "writing_back" ||
    stage === "cancelling"
  );
}

export function groupIssueAutomationTasks(tasks: ReadonlyArray<IssueAutomationTask>) {
  const groups = new Map<string, IssueAutomationTask[]>();
  for (const task of tasks.toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )) {
    const key = JSON.stringify([task.connectorId, task.issueKey]);
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }
  return [...groups].map(([key, attempts]) => ({ key, latest: attempts[0]!, attempts }));
}

export function resolveTaskDurationMs(
  task: Pick<IssueAutomationTask, "createdAt" | "completedAt" | "updatedAt" | "stage">,
  nowMs: number,
): number | null {
  const startMs = Date.parse(task.createdAt);
  if (!Number.isFinite(startMs)) return null;
  if (isStageRunning(task.stage)) {
    return Math.max(0, nowMs - startMs);
  }
  const endIso = task.completedAt ?? task.updatedAt;
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

export function formatCompactDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0
      ? `${String(totalMinutes)}m`
      : `${String(totalMinutes)}m ${String(seconds)}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

function computePercentile(
  sortedAscending: ReadonlyArray<number>,
  percentile: number,
): number | null {
  if (sortedAscending.length === 0) return null;
  if (sortedAscending.length === 1) return sortedAscending[0]!;
  const pos = (percentile / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  return Math.round(sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight);
}

function isOffHoursTimestamp(iso: string): boolean {
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return true;
  const hour = d.getHours();
  return hour < 9 || hour >= 19;
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortMonthDayLabel(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}`;
}

function estimateSingleIssueHoursSaved(task: IssueAutomationTask): number {
  const concludedWithValue =
    task.stage === "completed" ||
    (task.stage === "needs_human" && Boolean(task.diagnosisReport?.trim()));
  if (!concludedWithValue) return 0;

  const hasCodeFix = Boolean(task.worktreeBranch) && task.actionMode !== "diagnose_only";
  const baseHours = hasCodeFix ? 1.2 : 0.5;
  const severityMultiplier = task.severity !== null && task.severity <= 2 ? 1.3 : 1.0;
  return baseHours * severityMultiplier;
}

export interface StageLatencyMetric {
  readonly id: "context_route" | "primary_diagnosis" | "cross_review" | "write_back";
  readonly avgDurationMs: number | null;
  readonly sharePercent: number;
  readonly sampleCount: number;
}

export interface DailyThroughputPoint {
  readonly dateKey: string;
  readonly label: string;
  readonly completed: number;
  readonly needsHuman: number;
  readonly failed: number;
  readonly active: number;
  readonly total: number;
  readonly hoursSaved: number;
}

export interface SeverityBreakdownRow {
  readonly bucket: "S1" | "S2" | "S3" | "S4";
  readonly uniqueIssues: number;
  readonly completedIssues: number;
  readonly successRate: number | null;
}

export interface ModelPerformanceRow {
  readonly modelLabel: string;
  readonly runs: number;
  readonly completed: number;
  readonly needsHuman: number;
  readonly failed: number;
  readonly successRate: number | null;
  readonly avgDurationMs: number | null;
  readonly medianDurationMs: number | null;
  readonly codeFixCount: number;
  readonly criticalCount: number;
}

export interface HotspotRow {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly uniqueIssues: number;
  readonly runs: number;
  readonly completed: number;
  readonly successRate: number | null;
  readonly avgDurationMs: number | null;
  readonly criticalCount: number;
  readonly codeFixCount: number;
}

export interface IssueAutomationAnalyticsSummary {
  readonly filteredTasks: ReadonlyArray<IssueAutomationTask>;
  readonly uniqueIssuesCount: number;
  readonly totalRunsCount: number;
  readonly todayRunsCount: number;
  readonly activeCount: number;
  readonly completedCount: number;
  readonly needsHumanCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly validRunsCount: number;
  readonly finishedRunsCount: number;
  readonly completionRate: number | null;
  readonly successRate: number | null;
  readonly avgDurationMs: number | null;
  readonly medianDurationMs: number | null;
  readonly p90DurationMs: number | null;
  readonly minDurationMs: number | null;
  readonly maxDurationMs: number | null;
  readonly estimatedHoursSaved: number;
  readonly estimatedPersonDaysSaved: number;
  readonly codeFixCount: number;
  readonly codeFixRate: number | null;
  readonly commentSyncedCount: number;
  readonly stateSyncedCount: number;
  readonly resolvedIssueCount: number;
  readonly resolutionAdoptionRate: number | null;
  readonly unattendedCount: number;
  readonly unattendedRate: number | null;
  readonly offHoursConcludedCount: number;
  readonly offHoursRate: number | null;
  readonly criticalUniqueCount: number;
  readonly criticalResolvedCount: number;
  readonly criticalSuccessRate: number | null;
  readonly crossReviewInterceptCount: number;
  readonly stageLatencies: ReadonlyArray<StageLatencyMetric>;
  readonly dailySeries: ReadonlyArray<DailyThroughputPoint>;
  readonly severityBreakdown: ReadonlyArray<SeverityBreakdownRow>;
  readonly modelLeaderboard: ReadonlyArray<ModelPerformanceRow>;
  readonly repoHotspots: ReadonlyArray<HotspotRow>;
  readonly moduleHotspots: ReadonlyArray<HotspotRow>;
}

export function computeIssueAutomationAnalytics(input: {
  readonly tasks: ReadonlyArray<IssueAutomationTask>;
  readonly range: AnalyticsTimeRange;
  readonly scopeMode: AnalyticsScopeMode;
  readonly currentConnectorId: string | null;
  readonly currentScopeId: string;
  readonly projectTitleById: ReadonlyMap<string, string>;
  readonly nowMs?: number;
}): IssueAutomationAnalyticsSummary {
  const nowMs = input.nowMs ?? Date.now();
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const cutoffMs =
    input.range === "today"
      ? startOfTodayMs
      : input.range === "7d"
        ? nowMs - 7 * 24 * 60 * 60 * 1000
        : input.range === "30d"
          ? nowMs - 30 * 24 * 60 * 60 * 1000
          : null;

  const scopeFiltered =
    input.scopeMode === "current" && input.currentConnectorId && input.currentScopeId
      ? input.tasks.filter(
          (t) => t.connectorId === input.currentConnectorId && t.scopeId === input.currentScopeId,
        )
      : input.tasks;

  const todayRunsCount = scopeFiltered.filter((t) => {
    const ms = Date.parse(t.createdAt);
    return Number.isFinite(ms) && ms >= startOfTodayMs;
  }).length;

  const filteredTasks =
    cutoffMs === null
      ? scopeFiltered
      : scopeFiltered.filter((t) => {
          const ms = Date.parse(t.createdAt);
          return Number.isFinite(ms) && ms >= cutoffMs;
        });

  let activeCount = 0;
  let completedCount = 0;
  let needsHumanCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let unattendedCount = 0;
  let offHoursConcludedCount = 0;
  let commentSyncedCount = 0;
  let stateSyncedCount = 0;
  let codeFixCount = 0;
  let crossReviewInterceptCount = 0;

  const concludedDurations: number[] = [];
  const bestTaskByIssue = new Map<string, IssueAutomationTask>();

  for (const task of filteredTasks) {
    if (isStageRunning(task.stage)) activeCount += 1;
    else if (task.stage === "completed") completedCount += 1;
    else if (task.stage === "needs_human") {
      needsHumanCount += 1;
      if (task.reviewReport) crossReviewInterceptCount += 1;
    } else if (task.stage === "failed") failedCount += 1;
    else if (task.stage === "cancelled") cancelledCount += 1;

    if (task.trigger === "poll") unattendedCount += 1;
    if (task.commentSyncedAt !== null) commentSyncedCount += 1;
    if (task.stateSyncedAt !== null) stateSyncedCount += 1;

    const isConcluded = task.stage === "completed" || task.stage === "needs_human";
    if (isConcluded) {
      if (isOffHoursTimestamp(task.createdAt)) {
        offHoursConcludedCount += 1;
      }
      if (task.worktreeBranch !== null && task.actionMode !== "diagnose_only") {
        codeFixCount += 1;
      }
      if (task.completedAt !== null) {
        const dur = Date.parse(task.completedAt) - Date.parse(task.createdAt);
        if (Number.isFinite(dur) && dur >= 0) {
          concludedDurations.push(dur);
        }
      }
    }

    const issueUid = `${task.connectorId}::${task.issueKey}`;
    const prev = bestTaskByIssue.get(issueUid);
    if (!prev || taskQualityRank(task) > taskQualityRank(prev)) {
      bestTaskByIssue.set(issueUid, task);
    }
  }

  concludedDurations.sort((a, b) => a - b);

  const totalRunsCount = filteredTasks.length;
  const validRunsCount = totalRunsCount - cancelledCount;
  const concludedRunsCount = completedCount + needsHumanCount;
  const finishedRunsCount = completedCount + needsHumanCount + failedCount;

  const completionRate =
    validRunsCount > 0 ? Math.round((concludedRunsCount / validRunsCount) * 1000) / 10 : null;
  const successRate =
    finishedRunsCount > 0 ? Math.round((completedCount / finishedRunsCount) * 1000) / 10 : null;

  const avgDurationMs =
    concludedDurations.length > 0
      ? Math.round(
          concludedDurations.reduce((acc, item) => acc + item, 0) / concludedDurations.length,
        )
      : null;
  const medianDurationMs = computePercentile(concludedDurations, 50);
  const p90DurationMs = computePercentile(concludedDurations, 90);
  const minDurationMs = concludedDurations[0] ?? null;
  const maxDurationMs = concludedDurations[concludedDurations.length - 1] ?? null;

  // Deduplicated issue-level ROI & severity metrics
  let rawHoursSaved = 0;
  let resolvedIssueCount = 0;
  let criticalUniqueCount = 0;
  let criticalResolvedCount = 0;

  const severityBuckets: Record<"S1" | "S2" | "S3" | "S4", { unique: number; completed: number }> =
    {
      S1: { unique: 0, completed: 0 },
      S2: { unique: 0, completed: 0 },
      S3: { unique: 0, completed: 0 },
      S4: { unique: 0, completed: 0 },
    };

  for (const bestTask of bestTaskByIssue.values()) {
    rawHoursSaved += estimateSingleIssueHoursSaved(bestTask);
    const statusLower = bestTask.issueStatus.toLowerCase();
    const isResolvedInTracker =
      bestTask.stateSyncedAt !== null || statusLower === "resolved" || statusLower === "closed";
    if (
      isResolvedInTracker &&
      (bestTask.stage === "completed" || bestTask.stage === "needs_human")
    ) {
      resolvedIssueCount += 1;
    }

    const sev = bestTask.severity ?? 3;
    const bucket: "S1" | "S2" | "S3" | "S4" =
      sev <= 1 ? "S1" : sev === 2 ? "S2" : sev === 3 ? "S3" : "S4";
    severityBuckets[bucket].unique += 1;
    if (bestTask.stage === "completed") {
      severityBuckets[bucket].completed += 1;
    }

    if (bestTask.severity !== null && bestTask.severity <= 2) {
      criticalUniqueCount += 1;
      if (bestTask.stage === "completed") {
        criticalResolvedCount += 1;
      }
    }
  }

  const uniqueIssuesCount = bestTaskByIssue.size;
  const estimatedHoursSaved = Math.round(rawHoursSaved * 10) / 10;
  const estimatedPersonDaysSaved = Math.round((estimatedHoursSaved / 8) * 10) / 10;

  const codeFixRate =
    concludedRunsCount > 0 ? Math.round((codeFixCount / concludedRunsCount) * 1000) / 10 : null;
  const resolutionAdoptionRate =
    uniqueIssuesCount > 0 ? Math.round((resolvedIssueCount / uniqueIssuesCount) * 1000) / 10 : null;
  const unattendedRate =
    totalRunsCount > 0 ? Math.round((unattendedCount / totalRunsCount) * 1000) / 10 : null;
  const offHoursRate =
    concludedRunsCount > 0
      ? Math.round((offHoursConcludedCount / concludedRunsCount) * 1000) / 10
      : null;
  const criticalSuccessRate =
    criticalUniqueCount > 0
      ? Math.round((criticalResolvedCount / criticalUniqueCount) * 1000) / 10
      : null;

  const stageLatencies = computeStageLatencies(filteredTasks);
  const dailySeries = computeDailySeries(filteredTasks, input.range, nowMs);
  const severityBreakdown: ReadonlyArray<SeverityBreakdownRow> = (
    ["S1", "S2", "S3", "S4"] as const
  ).map((bucket) => {
    const entry = severityBuckets[bucket];
    return {
      bucket,
      uniqueIssues: entry.unique,
      completedIssues: entry.completed,
      successRate:
        entry.unique > 0 ? Math.round((entry.completed / entry.unique) * 1000) / 10 : null,
    };
  });

  const modelLeaderboard = computeModelLeaderboard(filteredTasks);
  const repoHotspots = computeRepoHotspots(filteredTasks, input.projectTitleById);
  const moduleHotspots = computeModuleHotspots(filteredTasks);

  return {
    filteredTasks,
    uniqueIssuesCount,
    totalRunsCount,
    todayRunsCount,
    activeCount,
    completedCount,
    needsHumanCount,
    failedCount,
    cancelledCount,
    validRunsCount,
    finishedRunsCount,
    completionRate,
    successRate,
    avgDurationMs,
    medianDurationMs,
    p90DurationMs,
    minDurationMs,
    maxDurationMs,
    estimatedHoursSaved,
    estimatedPersonDaysSaved,
    codeFixCount,
    codeFixRate,
    commentSyncedCount,
    stateSyncedCount,
    resolvedIssueCount,
    resolutionAdoptionRate,
    unattendedCount,
    unattendedRate,
    offHoursConcludedCount,
    offHoursRate,
    criticalUniqueCount,
    criticalResolvedCount,
    criticalSuccessRate,
    crossReviewInterceptCount,
    stageLatencies,
    dailySeries,
    severityBreakdown,
    modelLeaderboard,
    repoHotspots,
    moduleHotspots,
  };
}

function taskQualityRank(task: IssueAutomationTask): number {
  const stageScore =
    task.stage === "completed"
      ? 40
      : task.stage === "needs_human"
        ? 30
        : isStageRunning(task.stage)
          ? 20
          : task.stage === "failed"
            ? 10
            : 0;
  const fixBonus = task.worktreeBranch !== null ? 5 : 0;
  const syncBonus = (task.stateSyncedAt ? 2 : 0) + (task.commentSyncedAt ? 1 : 0);
  return stageScore + fixBonus + syncBonus;
}

function computeStageLatencies(
  tasks: ReadonlyArray<IssueAutomationTask>,
): ReadonlyArray<StageLatencyMetric> {
  const buckets: Record<StageLatencyMetric["id"], number[]> = {
    context_route: [],
    primary_diagnosis: [],
    cross_review: [],
    write_back: [],
  };

  for (const task of tasks) {
    if (task.stage !== "completed" && task.stage !== "needs_human") continue;
    if (task.steps.length === 0) continue;

    let contextMs = 0;
    let primaryMs = 0;
    let reviewMs = 0;
    let writeBackMs = 0;
    let hasContext = false;
    let hasPrimary = false;
    let hasReview = false;
    let hasWriteBack = false;

    const endMs = task.completedAt ? Date.parse(task.completedAt) : Date.parse(task.updatedAt);

    for (let i = 0; i < task.steps.length; i++) {
      const cur = task.steps[i]!;
      const curAt = Date.parse(cur.at);
      const nextStep = task.steps[i + 1];
      const nextAt = nextStep ? Date.parse(nextStep.at) : endMs;
      if (!Number.isFinite(curAt) || !Number.isFinite(nextAt) || nextAt < curAt) continue;
      const delta = nextAt - curAt;

      if (cur.stage === "queued" || cur.stage === "enriching" || cur.stage === "routing") {
        contextMs += delta;
        hasContext = true;
      } else if (cur.stage === "diagnosing") {
        primaryMs += delta;
        hasPrimary = true;
      } else if (cur.stage === "reviewing") {
        reviewMs += delta;
        hasReview = true;
      } else if (cur.stage === "writing_back") {
        writeBackMs += delta;
        hasWriteBack = true;
      }
    }

    if (hasContext) buckets.context_route.push(contextMs);
    if (hasPrimary) buckets.primary_diagnosis.push(primaryMs);
    if (hasReview) buckets.cross_review.push(reviewMs);
    if (hasWriteBack) buckets.write_back.push(writeBackMs);
  }

  const avgOf = (arr: ReadonlyArray<number>): number | null =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const raw: Array<{ id: StageLatencyMetric["id"]; avg: number | null; count: number }> = [
    {
      id: "context_route",
      avg: avgOf(buckets.context_route),
      count: buckets.context_route.length,
    },
    {
      id: "primary_diagnosis",
      avg: avgOf(buckets.primary_diagnosis),
      count: buckets.primary_diagnosis.length,
    },
    {
      id: "cross_review",
      avg: avgOf(buckets.cross_review),
      count: buckets.cross_review.length,
    },
    {
      id: "write_back",
      avg: avgOf(buckets.write_back),
      count: buckets.write_back.length,
    },
  ];

  const totalAvg = raw.reduce((sum, item) => sum + (item.avg ?? 0), 0);

  return raw.map((item) => ({
    id: item.id,
    avgDurationMs: item.avg,
    sampleCount: item.count,
    sharePercent:
      totalAvg > 0 && item.avg !== null ? Math.round((item.avg / totalAvg) * 1000) / 10 : 0,
  }));
}

function computeDailySeries(
  tasks: ReadonlyArray<IssueAutomationTask>,
  range: AnalyticsTimeRange,
  nowMs: number,
): ReadonlyArray<DailyThroughputPoint> {
  const daysCount = range === "today" ? 1 : range === "7d" ? 7 : 14;
  const endDay = new Date(nowMs);
  endDay.setHours(0, 0, 0, 0);

  const points = new Map<
    string,
    {
      dateKey: string;
      label: string;
      completed: number;
      needsHuman: number;
      failed: number;
      active: number;
      bestByIssue: Map<string, IssueAutomationTask>;
    }
  >();

  for (let offset = daysCount - 1; offset >= 0; offset--) {
    const dayMs = endDay.getTime() - offset * 24 * 60 * 60 * 1000;
    const key = localDateKey(dayMs);
    points.set(key, {
      dateKey: key,
      label: shortMonthDayLabel(dayMs),
      completed: 0,
      needsHuman: 0,
      failed: 0,
      active: 0,
      bestByIssue: new Map(),
    });
  }

  for (const task of tasks) {
    const ms = Date.parse(task.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = localDateKey(ms);
    const bucket = points.get(key);
    if (!bucket) continue;
    if (task.stage === "completed") bucket.completed += 1;
    else if (task.stage === "needs_human") bucket.needsHuman += 1;
    else if (task.stage === "failed") bucket.failed += 1;
    else if (isStageRunning(task.stage)) bucket.active += 1;

    const uid = `${task.connectorId}::${task.issueKey}`;
    const prev = bucket.bestByIssue.get(uid);
    if (!prev || taskQualityRank(task) > taskQualityRank(prev)) {
      bucket.bestByIssue.set(uid, task);
    }
  }

  return [...points.values()].map((entry) => {
    let hours = 0;
    for (const best of entry.bestByIssue.values()) {
      hours += estimateSingleIssueHoursSaved(best);
    }
    return {
      dateKey: entry.dateKey,
      label: entry.label,
      completed: entry.completed,
      needsHuman: entry.needsHuman,
      failed: entry.failed,
      active: entry.active,
      total: entry.completed + entry.needsHuman + entry.failed + entry.active,
      hoursSaved: Math.round(hours * 10) / 10,
    };
  });
}

function computeModelLeaderboard(
  tasks: ReadonlyArray<IssueAutomationTask>,
): ReadonlyArray<ModelPerformanceRow> {
  const groups = new Map<
    string,
    {
      runs: number;
      completed: number;
      needsHuman: number;
      failed: number;
      durations: number[];
      codeFixCount: number;
      criticalCount: number;
    }
  >();

  for (const task of tasks) {
    const label = task.assignedModelLabel || "unknown";
    let g = groups.get(label);
    if (!g) {
      g = {
        runs: 0,
        completed: 0,
        needsHuman: 0,
        failed: 0,
        durations: [],
        codeFixCount: 0,
        criticalCount: 0,
      };
      groups.set(label, g);
    }
    g.runs += 1;
    if (task.stage === "completed") g.completed += 1;
    else if (task.stage === "needs_human") g.needsHuman += 1;
    else if (task.stage === "failed") g.failed += 1;

    if ((task.stage === "completed" || task.stage === "needs_human") && task.completedAt !== null) {
      const dur = Date.parse(task.completedAt) - Date.parse(task.createdAt);
      if (Number.isFinite(dur) && dur >= 0) g.durations.push(dur);
    }
    if (
      (task.stage === "completed" || task.stage === "needs_human") &&
      task.worktreeBranch !== null &&
      task.actionMode !== "diagnose_only"
    ) {
      g.codeFixCount += 1;
    }
    if (task.severity !== null && task.severity <= 2) {
      g.criticalCount += 1;
    }
  }

  return [...groups.entries()]
    .map(([modelLabel, g]) => {
      g.durations.sort((a, b) => a - b);
      const finished = g.completed + g.needsHuman + g.failed;
      return {
        modelLabel,
        runs: g.runs,
        completed: g.completed,
        needsHuman: g.needsHuman,
        failed: g.failed,
        successRate: finished > 0 ? Math.round((g.completed / finished) * 1000) / 10 : null,
        avgDurationMs:
          g.durations.length > 0
            ? Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length)
            : null,
        medianDurationMs: computePercentile(g.durations, 50),
        codeFixCount: g.codeFixCount,
        criticalCount: g.criticalCount,
      };
    })
    .toSorted((a, b) => b.runs - a.runs || (b.successRate ?? 0) - (a.successRate ?? 0));
}

function computeRepoHotspots(
  tasks: ReadonlyArray<IssueAutomationTask>,
  projectTitleById: ReadonlyMap<string, string>,
): ReadonlyArray<HotspotRow> {
  const groups = new Map<
    string,
    {
      title: string;
      issueSet: Set<string>;
      runs: number;
      completed: number;
      finished: number;
      durations: number[];
      criticalIssues: Set<string>;
      codeFixCount: number;
    }
  >();

  for (const task of tasks) {
    if (!task.targetProjectId) continue;
    const key = task.targetProjectId;
    const title = projectTitleById.get(key) ?? key;
    let g = groups.get(key);
    if (!g) {
      g = {
        title,
        issueSet: new Set(),
        runs: 0,
        completed: 0,
        finished: 0,
        durations: [],
        criticalIssues: new Set(),
        codeFixCount: 0,
      };
      groups.set(key, g);
    }
    const uid = `${task.connectorId}::${task.issueKey}`;
    g.issueSet.add(uid);
    g.runs += 1;
    if (task.stage === "completed") {
      g.completed += 1;
      g.finished += 1;
    } else if (task.stage === "needs_human" || task.stage === "failed") {
      g.finished += 1;
    }
    if ((task.stage === "completed" || task.stage === "needs_human") && task.completedAt !== null) {
      const dur = Date.parse(task.completedAt) - Date.parse(task.createdAt);
      if (Number.isFinite(dur) && dur >= 0) g.durations.push(dur);
    }
    if (task.severity !== null && task.severity <= 2) {
      g.criticalIssues.add(uid);
    }
    if (
      (task.stage === "completed" || task.stage === "needs_human") &&
      task.worktreeBranch !== null &&
      task.actionMode !== "diagnose_only"
    ) {
      g.codeFixCount += 1;
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      title: g.title,
      subtitle: null,
      uniqueIssues: g.issueSet.size,
      runs: g.runs,
      completed: g.completed,
      successRate: g.finished > 0 ? Math.round((g.completed / g.finished) * 1000) / 10 : null,
      avgDurationMs:
        g.durations.length > 0
          ? Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length)
          : null,
      criticalCount: g.criticalIssues.size,
      codeFixCount: g.codeFixCount,
    }))
    .toSorted((a, b) => b.uniqueIssues - a.uniqueIssues || b.runs - a.runs)
    .slice(0, 8);
}

function computeModuleHotspots(
  tasks: ReadonlyArray<IssueAutomationTask>,
): ReadonlyArray<HotspotRow> {
  const groups = new Map<
    string,
    {
      title: string;
      subtitle: string;
      issueSet: Set<string>;
      runs: number;
      completed: number;
      finished: number;
      durations: number[];
      criticalIssues: Set<string>;
      codeFixCount: number;
    }
  >();

  for (const task of tasks) {
    const modName = task.moduleName?.trim() || "未分类模块";
    const key = `${task.scopeId}::${modName}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        title: modName,
        subtitle: task.scopeName,
        issueSet: new Set(),
        runs: 0,
        completed: 0,
        finished: 0,
        durations: [],
        criticalIssues: new Set(),
        codeFixCount: 0,
      };
      groups.set(key, g);
    }
    const uid = `${task.connectorId}::${task.issueKey}`;
    g.issueSet.add(uid);
    g.runs += 1;
    if (task.stage === "completed") {
      g.completed += 1;
      g.finished += 1;
    } else if (task.stage === "needs_human" || task.stage === "failed") {
      g.finished += 1;
    }
    if ((task.stage === "completed" || task.stage === "needs_human") && task.completedAt !== null) {
      const dur = Date.parse(task.completedAt) - Date.parse(task.createdAt);
      if (Number.isFinite(dur) && dur >= 0) g.durations.push(dur);
    }
    if (task.severity !== null && task.severity <= 2) {
      g.criticalIssues.add(uid);
    }
    if (
      (task.stage === "completed" || task.stage === "needs_human") &&
      task.worktreeBranch !== null &&
      task.actionMode !== "diagnose_only"
    ) {
      g.codeFixCount += 1;
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      title: g.title,
      subtitle: g.subtitle,
      uniqueIssues: g.issueSet.size,
      runs: g.runs,
      completed: g.completed,
      successRate: g.finished > 0 ? Math.round((g.completed / g.finished) * 1000) / 10 : null,
      avgDurationMs:
        g.durations.length > 0
          ? Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length)
          : null,
      criticalCount: g.criticalIssues.size,
      codeFixCount: g.codeFixCount,
    }))
    .toSorted((a, b) => b.uniqueIssues - a.uniqueIssues || b.runs - a.runs)
    .slice(0, 8);
}
