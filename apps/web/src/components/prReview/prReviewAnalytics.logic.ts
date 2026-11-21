import type {
  PrReviewFindingSeverity,
  PrReviewModelRun,
  PrReviewRole,
  PrReviewStage,
  PrReviewTask,
} from "@t3tools/contracts";
import { PullRequestInvolvement, PullRequestListState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const PrReviewWorkstationTabSchema = Schema.Literals([
  "queue",
  "runs",
  "analytics",
  "presets",
]);
export type PrReviewWorkstationTab = typeof PrReviewWorkstationTabSchema.Type;

export const PrReviewRunFilterSchema = Schema.Literals([
  "all",
  "active",
  "completed",
  "request_changes",
  "failed",
]);
export type PrReviewRunFilter = typeof PrReviewRunFilterSchema.Type;

export const PrReviewTimeRangeSchema = Schema.Literals(["today", "7d", "30d", "all"]);
export type PrReviewTimeRange = typeof PrReviewTimeRangeSchema.Type;

export const PrReviewRoiBaselineSchema = Schema.Literals(["conservative", "standard", "strict"]);
export type PrReviewRoiBaseline = typeof PrReviewRoiBaselineSchema.Type;

export const DEFAULT_PR_INSPECTOR_WIDTH = 680;
export const MIN_PR_INSPECTOR_WIDTH = 440;
export const MAX_PR_INSPECTOR_WIDTH = 1200;

export const PrReviewWorkstationPrefsSchema = Schema.Struct({
  tab: PrReviewWorkstationTabSchema,
  involvement: PullRequestInvolvement,
  state: PullRequestListState,
  host: Schema.String,
  runFilter: PrReviewRunFilterSchema,
  analyticsRange: PrReviewTimeRangeSchema,
  roiBaseline: PrReviewRoiBaselineSchema,
  inspectorWidth: Schema.Number,
});
export type PrReviewWorkstationPrefs = typeof PrReviewWorkstationPrefsSchema.Type;

export const DEFAULT_PR_WORKSTATION_PREFS: PrReviewWorkstationPrefs = {
  tab: "queue",
  involvement: "all",
  state: "open",
  host: "",
  runFilter: "all",
  analyticsRange: "30d",
  roiBaseline: "standard",
  inspectorWidth: DEFAULT_PR_INSPECTOR_WIDTH,
};

export function isPrReviewTaskRunning(stage: PrReviewStage): boolean {
  return (
    stage === "queued" ||
    stage === "fetching_context" ||
    stage === "parallel_reviewing" ||
    stage === "synthesizing" ||
    stage === "writing_back"
  );
}

export interface TaskDiffStats {
  readonly additions: number;
  readonly deletions: number;
  readonly totalLines: number;
  readonly changedFiles: number | null;
}

const DIFF_STATS_PATTERN = /\+(\d+)\/-(\d+)(?:[，,\s]+(\d+)\s*(?:files|个文件))?/i;

export function extractTaskDiffStats(task: Pick<PrReviewTask, "steps">): TaskDiffStats | null {
  for (const step of task.steps) {
    const match = DIFF_STATS_PATTERN.exec(step.message);
    if (match) {
      const additions = Number(match[1]);
      const deletions = Number(match[2]);
      const filesRaw = match[3] ? Number(match[3]) : null;
      if (Number.isFinite(additions) && Number.isFinite(deletions)) {
        return {
          additions,
          deletions,
          totalLines: additions + deletions,
          changedFiles: filesRaw !== null && Number.isFinite(filesRaw) ? filesRaw : null,
        };
      }
    }
  }
  return null;
}

export function resolvePrReviewTaskDurationMs(
  task: Pick<PrReviewTask, "createdAt" | "completedAt" | "updatedAt" | "stage">,
  nowMs: number,
): number | null {
  const startMs = Date.parse(task.createdAt);
  if (!Number.isFinite(startMs)) return null;
  if (isPrReviewTaskRunning(task.stage)) {
    return Math.max(0, nowMs - startMs);
  }
  const endIso = task.completedAt ?? task.updatedAt;
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

export function resolveModelRunDurationMs(
  run: Pick<PrReviewModelRun, "startedAt" | "completedAt" | "status">,
  nowMs: number,
): number | null {
  if (!run.startedAt) return null;
  const startMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startMs)) return null;
  if (run.status === "running") {
    return Math.max(0, nowMs - startMs);
  }
  if (!run.completedAt) return null;
  const endMs = Date.parse(run.completedAt);
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

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 10_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toLocaleString("en-US");
}

export function computeParallelSpeedup(task: Pick<PrReviewTask, "reviewerRuns">): number | null {
  const validSpans = task.reviewerRuns.flatMap((run) => {
    if (!run.startedAt || !run.completedAt || run.status !== "completed") return [];
    const s = Date.parse(run.startedAt);
    const e = Date.parse(run.completedAt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
    return [{ start: s, end: e, duration: e - s }];
  });
  if (validSpans.length < 2) return null;
  const serialSum = validSpans.reduce((acc, item) => acc + item.duration, 0);
  const minStart = Math.min(...validSpans.map((item) => item.start));
  const maxEnd = Math.max(...validSpans.map((item) => item.end));
  const wallClock = maxEnd - minStart;
  if (wallClock <= 0) return null;
  return Math.max(1, Math.round((serialSum / wallClock) * 100) / 100);
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

interface BaselineCoefficients {
  readonly locPerHour: number;
  readonly contextSetupHours: number;
  readonly fusionGateMultiplier: number;
  readonly humanFollowupHours: number;
  readonly maxHoursPerPr: number;
}

const BASELINE_COEFFICIENTS: Record<PrReviewRoiBaseline, BaselineCoefficients> = {
  conservative: {
    locPerHour: 500,
    contextSetupHours: 0.2,
    fusionGateMultiplier: 1.25,
    humanFollowupHours: 0.15,
    maxHoursPerPr: 2.2,
  },
  standard: {
    locPerHour: 350,
    contextSetupHours: 0.3,
    fusionGateMultiplier: 1.5,
    humanFollowupHours: 0.15,
    maxHoursPerPr: 3.5,
  },
  strict: {
    locPerHour: 250,
    contextSetupHours: 0.4,
    fusionGateMultiplier: 1.8,
    humanFollowupHours: 0.15,
    maxHoursPerPr: 4.8,
  },
};

/**
 * Estimates net senior-engineer review hours saved for a single unique PR/MR.
 * Uses tapered effective LoC so massive auto-generated or bundle diffs never inflate ROI.
 */
function estimatePrHoursSaved(task: PrReviewTask, baseline: PrReviewRoiBaseline): number {
  const hasValue =
    task.stage === "completed" ||
    (task.mode === "direct_agent" && task.reviewerRuns.some((r) => r.threadId !== null));
  if (!hasValue) return 0;

  const coeff = BASELINE_COEFFICIENTS[baseline];
  const stats = extractTaskDiffStats(task);
  const rawLines = stats ? stats.totalLines : 260;

  // Taper large diffs: full weight up to 800 LoC, 0.32x from 800..5000, 0.08x above 5000
  const tier1 = Math.min(rawLines, 800);
  const tier2 = Math.max(0, Math.min(rawLines - 800, 4200)) * 0.32;
  const tier3 = Math.max(0, rawLines - 5000) * 0.08;
  const effectiveLines = tier1 + tier2 + tier3;

  const baseReadingHours = coeff.contextSetupHours + effectiveLines / coeff.locPerHour;
  const modeMultiplier =
    task.mode === "multi_model_fusion" && task.reviewerRuns.length >= 2
      ? coeff.fusionGateMultiplier
      : 1.0;
  const riskBonus = task.findings.some((f) => f.severity === "blocker" || f.severity === "major")
    ? 0.25
    : 0;

  const grossHours = baseReadingHours * modeMultiplier + riskBonus;
  const netHours = Math.max(0.2, grossHours - coeff.humanFollowupHours);
  return Math.min(coeff.maxHoursPerPr, Math.round(netHours * 100) / 100);
}

export interface PrReviewStageLatency {
  readonly id: "fetching_context" | "parallel_reviewing" | "synthesizing" | "writing_back";
  readonly avgDurationMs: number | null;
  readonly sharePercent: number;
  readonly sampleCount: number;
}

export interface PrReviewDailyPoint {
  readonly dateKey: string;
  readonly label: string;
  readonly completedApproveOrComment: number;
  readonly completedRequestChanges: number;
  readonly failed: number;
  readonly active: number;
  readonly total: number;
  readonly hoursSaved: number;
}

export interface PrReviewSeverityStat {
  readonly severity: PrReviewFindingSeverity;
  readonly count: number;
  readonly sharePercent: number;
}

export interface PrReviewModelLeaderboardRow {
  readonly modelLabel: string;
  readonly totalParticipations: number;
  readonly reviewerRuns: number;
  readonly judgeRuns: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly successRate: number | null;
  readonly avgDurationMs: number | null;
  readonly highSeverityHits: number;
  readonly consensusHits: number;
  readonly topRole: PrReviewRole | null;
}

export interface PrReviewRepoHotspotRow {
  readonly key: string;
  readonly repository: string;
  readonly host: string;
  readonly uniquePrs: number;
  readonly runs: number;
  readonly linesReviewed: number;
  readonly blockerMajorCount: number;
  readonly requestChangesCount: number;
  readonly avgDurationMs: number | null;
  readonly successRate: number | null;
}

export interface PrReviewAnalyticsSummary {
  readonly uniquePrCount: number;
  readonly totalRunsCount: number;
  readonly todayRunsCount: number;
  readonly totalLinesReviewed: number;
  readonly completedCount: number;
  readonly approveCount: number;
  readonly requestChangesCount: number;
  readonly commentVerdictCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly activeCount: number;
  readonly concludedValidCount: number;
  readonly successRate: number | null;
  readonly failureRate: number | null;
  readonly subModelCompletedCount: number;
  readonly subModelFailedCount: number;
  readonly subModelSuccessRate: number | null;
  readonly avgDurationMs: number | null;
  readonly medianDurationMs: number | null;
  readonly p90DurationMs: number | null;
  readonly minDurationMs: number | null;
  readonly avgParallelSpeedup: number | null;
  readonly estimatedHoursSaved: number;
  readonly estimatedPersonDaysSaved: number;
  readonly totalFindingsCount: number;
  readonly highSeverityFindingsCount: number;
  readonly consensusFindingsCount: number;
  readonly consensusRate: number | null;
  readonly riskInterceptedPrCount: number;
  readonly riskInterceptionRate: number | null;
  readonly syncedCount: number;
  readonly syncRate: number | null;
  readonly offHoursCount: number;
  readonly offHoursRate: number | null;
  readonly stageLatencies: ReadonlyArray<PrReviewStageLatency>;
  readonly severityBreakdown: ReadonlyArray<PrReviewSeverityStat>;
  readonly dailySeries: ReadonlyArray<PrReviewDailyPoint>;
  readonly modelLeaderboard: ReadonlyArray<PrReviewModelLeaderboardRow>;
  readonly repoHotspots: ReadonlyArray<PrReviewRepoHotspotRow>;
}

const DAY_MS = 86_400_000;

export function computePrReviewAnalytics(input: {
  readonly tasks: ReadonlyArray<PrReviewTask>;
  readonly range: PrReviewTimeRange;
  readonly roiBaseline: PrReviewRoiBaseline;
  readonly nowMs?: number;
}): PrReviewAnalyticsSummary {
  const nowMs = input.nowMs ?? Date.now();
  const todayKey = localDateKey(nowMs);

  const windowCutoffMs =
    input.range === "today"
      ? (() => {
          const d = new Date(nowMs);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })()
      : input.range === "7d"
        ? nowMs - 7 * DAY_MS
        : input.range === "30d"
          ? nowMs - 30 * DAY_MS
          : 0;

  const filtered = input.tasks.filter((task) => {
    if (windowCutoffMs === 0) return true;
    const createdMs = Date.parse(task.createdAt);
    return Number.isFinite(createdMs) && createdMs >= windowCutoffMs;
  });

  const prKeyOf = (t: PrReviewTask) => `${t.host.toLowerCase()}::${t.repository}::${t.prNumber}`;

  const uniquePrMap = new Map<
    string,
    {
      bestTask: PrReviewTask;
      maxLines: number;
      hasRiskIntercept: boolean;
      dateKey: string;
      hoursSaved: number;
    }
  >();

  let todayRunsCount = 0;
  let completedCount = 0;
  let approveCount = 0;
  let requestChangesCount = 0;
  let commentVerdictCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let activeCount = 0;
  let subModelCompletedCount = 0;
  let subModelFailedCount = 0;
  let syncedCount = 0;
  let offHoursCount = 0;
  let totalFindingsCount = 0;
  let highSeverityFindingsCount = 0;
  let consensusFindingsCount = 0;

  const completedDurations: number[] = [];
  const parallelSpeedups: number[] = [];
  const severityCounts: Record<PrReviewFindingSeverity, number> = {
    blocker: 0,
    major: 0,
    minor: 0,
    nit: 0,
  };

  const stageSamples: Record<PrReviewStageLatency["id"], number[]> = {
    fetching_context: [],
    parallel_reviewing: [],
    synthesizing: [],
    writing_back: [],
  };

  const modelStats = new Map<
    string,
    {
      reviewerRuns: number;
      judgeRuns: number;
      completedCount: number;
      failedCount: number;
      durations: number[];
      highSeverityHits: number;
      consensusHits: number;
      roleCounts: Map<PrReviewRole, number>;
    }
  >();

  const ensureModel = (label: string) => {
    let rec = modelStats.get(label);
    if (!rec) {
      rec = {
        reviewerRuns: 0,
        judgeRuns: 0,
        completedCount: 0,
        failedCount: 0,
        durations: [],
        highSeverityHits: 0,
        consensusHits: 0,
        roleCounts: new Map(),
      };
      modelStats.set(label, rec);
    }
    return rec;
  };

  const repoStats = new Map<
    string,
    {
      repository: string;
      host: string;
      prNumbers: Set<number>;
      maxLinesByPr: Map<number, number>;
      runs: number;
      completedRuns: number;
      failedRuns: number;
      blockerMajorCount: number;
      requestChangesCount: number;
      durations: number[];
    }
  >();

  for (const task of filtered) {
    const createdMs = Date.parse(task.createdAt);
    const taskDateKey = Number.isFinite(createdMs) ? localDateKey(createdMs) : todayKey;
    if (taskDateKey === todayKey) {
      todayRunsCount += 1;
    }

    if (isPrReviewTaskRunning(task.stage)) {
      activeCount += 1;
    } else if (task.stage === "completed") {
      completedCount += 1;
      if (task.verdict === "approve") approveCount += 1;
      else if (task.verdict === "request-changes") requestChangesCount += 1;
      else commentVerdictCount += 1;

      const dur = resolvePrReviewTaskDurationMs(task, nowMs);
      if (dur !== null && task.mode === "multi_model_fusion") {
        completedDurations.push(dur);
      }
      const speedup = computeParallelSpeedup(task);
      if (speedup !== null) {
        parallelSpeedups.push(speedup);
      }
      if (task.commentSyncedAt !== null || task.reviewSyncedAt !== null) {
        syncedCount += 1;
      }
      if (isOffHoursTimestamp(task.completedAt ?? task.createdAt)) {
        offHoursCount += 1;
      }
    } else if (task.stage === "failed") {
      failedCount += 1;
    } else if (task.stage === "cancelled") {
      cancelledCount += 1;
    }

    // Extract stage latencies from ordered step timestamps
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i]!;
      const stepMs = Date.parse(step.at);
      if (!Number.isFinite(stepMs)) continue;
      let nextDiffStageMs: number | null = null;
      for (let j = i + 1; j < task.steps.length; j++) {
        if (task.steps[j]!.stage !== step.stage) {
          const candidateMs = Date.parse(task.steps[j]!.at);
          if (Number.isFinite(candidateMs) && candidateMs >= stepMs) {
            nextDiffStageMs = candidateMs;
          }
          break;
        }
      }
      if (nextDiffStageMs === null && task.completedAt && step.stage !== "completed") {
        const endMs = Date.parse(task.completedAt);
        if (Number.isFinite(endMs) && endMs >= stepMs) {
          nextDiffStageMs = endMs;
        }
      }
      if (
        nextDiffStageMs !== null &&
        (step.stage === "fetching_context" ||
          step.stage === "parallel_reviewing" ||
          step.stage === "synthesizing" ||
          step.stage === "writing_back")
      ) {
        const alreadyRecordedForTask =
          i > 0 && task.steps.slice(0, i).some((prev) => prev.stage === step.stage);
        if (!alreadyRecordedForTask) {
          stageSamples[step.stage].push(nextDiffStageMs - stepMs);
        }
      }
    }

    // Findings & consensus attribution
    for (const finding of task.findings) {
      totalFindingsCount += 1;
      severityCounts[finding.severity] += 1;
      const isHigh = finding.severity === "blocker" || finding.severity === "major";
      if (isHigh) highSeverityFindingsCount += 1;
      const isConsensus = finding.raisedByModels.length >= 2;
      if (isConsensus) consensusFindingsCount += 1;

      for (const rawModel of finding.raisedByModels) {
        const label = rawModel.trim();
        if (!label) continue;
        const m = ensureModel(label);
        if (isHigh) m.highSeverityHits += 1;
        if (isConsensus) m.consensusHits += 1;
      }
    }

    // Sub-model runs
    for (const run of task.reviewerRuns) {
      const m = ensureModel(run.modelLabel);
      m.reviewerRuns += 1;
      m.roleCounts.set(run.role, (m.roleCounts.get(run.role) ?? 0) + 1);
      if (run.status === "completed") {
        subModelCompletedCount += 1;
        m.completedCount += 1;
        const runDur = resolveModelRunDurationMs(run, nowMs);
        if (runDur !== null) m.durations.push(runDur);
      } else if (run.status === "failed") {
        subModelFailedCount += 1;
        m.failedCount += 1;
      }
    }

    if (task.synthesizerModelLabel && task.mode === "multi_model_fusion") {
      const judge = ensureModel(task.synthesizerModelLabel);
      judge.judgeRuns += 1;
      if (task.stage === "completed") {
        judge.completedCount += 1;
      } else if (
        task.stage === "failed" &&
        task.reviewerRuns.some((r) => r.status === "completed")
      ) {
        judge.failedCount += 1;
      }
    }

    // Unique PR deduplication for ROI & risk interception
    const diffStats = extractTaskDiffStats(task);
    const lines = diffStats?.totalLines ?? 0;
    const hours = estimatePrHoursSaved(task, input.roiBaseline);
    const hasRiskIntercept =
      task.stage === "completed" &&
      (task.verdict === "request-changes" ||
        task.findings.some((f) => f.severity === "blocker" || f.severity === "major"));

    const prKey = prKeyOf(task);
    const existingPr = uniquePrMap.get(prKey);
    if (!existingPr) {
      uniquePrMap.set(prKey, {
        bestTask: task,
        maxLines: lines,
        hasRiskIntercept,
        dateKey: taskDateKey,
        hoursSaved: hours,
      });
    } else {
      uniquePrMap.set(prKey, {
        bestTask: hours >= existingPr.hoursSaved ? task : existingPr.bestTask,
        maxLines: Math.max(existingPr.maxLines, lines),
        hasRiskIntercept: existingPr.hasRiskIntercept || hasRiskIntercept,
        dateKey: existingPr.dateKey,
        hoursSaved: Math.max(existingPr.hoursSaved, hours),
      });
    }

    // Repository hotspots
    const repoKey = `${task.host.toLowerCase()}::${task.repository}`;
    let repoRec = repoStats.get(repoKey);
    if (!repoRec) {
      repoRec = {
        repository: task.repository,
        host: task.host,
        prNumbers: new Set(),
        maxLinesByPr: new Map(),
        runs: 0,
        completedRuns: 0,
        failedRuns: 0,
        blockerMajorCount: 0,
        requestChangesCount: 0,
        durations: [],
      };
      repoStats.set(repoKey, repoRec);
    }
    repoRec.prNumbers.add(task.prNumber);
    repoRec.maxLinesByPr.set(
      task.prNumber,
      Math.max(repoRec.maxLinesByPr.get(task.prNumber) ?? 0, lines),
    );
    repoRec.runs += 1;
    if (task.stage === "completed") {
      repoRec.completedRuns += 1;
      if (task.verdict === "request-changes") repoRec.requestChangesCount += 1;
      const dur = resolvePrReviewTaskDurationMs(task, nowMs);
      if (dur !== null) repoRec.durations.push(dur);
    } else if (task.stage === "failed") {
      repoRec.failedRuns += 1;
    }
    repoRec.blockerMajorCount += task.findings.filter(
      (f) => f.severity === "blocker" || f.severity === "major",
    ).length;
  }

  const concludedValidCount = completedCount + failedCount;
  const successRate =
    concludedValidCount > 0 ? Math.round((completedCount / concludedValidCount) * 1000) / 10 : null;
  const failureRate =
    concludedValidCount > 0 ? Math.round((failedCount / concludedValidCount) * 1000) / 10 : null;

  const subModelConcluded = subModelCompletedCount + subModelFailedCount;
  const subModelSuccessRate =
    subModelConcluded > 0
      ? Math.round((subModelCompletedCount / subModelConcluded) * 1000) / 10
      : null;

  const sortedDurations = [...completedDurations].toSorted((a, b) => a - b);
  const avgDurationMs =
    sortedDurations.length > 0
      ? Math.round(sortedDurations.reduce((acc, v) => acc + v, 0) / sortedDurations.length)
      : null;
  const medianDurationMs = computePercentile(sortedDurations, 50);
  const p90DurationMs = computePercentile(sortedDurations, 90);
  const minDurationMs = sortedDurations.length > 0 ? sortedDurations[0]! : null;

  const avgParallelSpeedup =
    parallelSpeedups.length > 0
      ? Math.round(
          (parallelSpeedups.reduce((acc, v) => acc + v, 0) / parallelSpeedups.length) * 100,
        ) / 100
      : null;

  let estimatedHoursSaved = 0;
  let totalLinesReviewed = 0;
  let riskInterceptedPrCount = 0;
  const hoursByDateKey = new Map<string, number>();

  for (const item of uniquePrMap.values()) {
    estimatedHoursSaved += item.hoursSaved;
    totalLinesReviewed += item.maxLines;
    if (item.hasRiskIntercept) riskInterceptedPrCount += 1;
    hoursByDateKey.set(item.dateKey, (hoursByDateKey.get(item.dateKey) ?? 0) + item.hoursSaved);
  }
  estimatedHoursSaved = Math.round(estimatedHoursSaved * 10) / 10;
  const estimatedPersonDaysSaved = Math.round((estimatedHoursSaved / 8) * 10) / 10;

  const uniquePrCount = uniquePrMap.size;
  const riskInterceptionRate =
    uniquePrCount > 0 ? Math.round((riskInterceptedPrCount / uniquePrCount) * 1000) / 10 : null;
  const consensusRate =
    totalFindingsCount > 0
      ? Math.round((consensusFindingsCount / totalFindingsCount) * 1000) / 10
      : null;
  const syncRate =
    completedCount > 0 ? Math.round((syncedCount / completedCount) * 1000) / 10 : null;
  const offHoursRate =
    completedCount > 0 ? Math.round((offHoursCount / completedCount) * 1000) / 10 : null;

  // Stage latencies
  const stageOrder: ReadonlyArray<PrReviewStageLatency["id"]> = [
    "fetching_context",
    "parallel_reviewing",
    "synthesizing",
    "writing_back",
  ];
  const rawStageAvgs = stageOrder.map((id) => {
    const samples = stageSamples[id];
    const avg =
      samples.length > 0
        ? Math.round(samples.reduce((acc, v) => acc + v, 0) / samples.length)
        : null;
    return { id, avgDurationMs: avg, sampleCount: samples.length };
  });
  const sumStageAvgs = rawStageAvgs.reduce((acc, s) => acc + (s.avgDurationMs ?? 0), 0);
  const stageLatencies: ReadonlyArray<PrReviewStageLatency> = rawStageAvgs.map((s) => ({
    id: s.id,
    avgDurationMs: s.avgDurationMs,
    sampleCount: s.sampleCount,
    sharePercent:
      sumStageAvgs > 0 && s.avgDurationMs !== null
        ? Math.round((s.avgDurationMs / sumStageAvgs) * 1000) / 10
        : 0,
  }));

  // Severity breakdown
  const severities: ReadonlyArray<PrReviewFindingSeverity> = ["blocker", "major", "minor", "nit"];
  const severityBreakdown: ReadonlyArray<PrReviewSeverityStat> = severities.map((sev) => ({
    severity: sev,
    count: severityCounts[sev],
    sharePercent:
      totalFindingsCount > 0
        ? Math.round((severityCounts[sev] / totalFindingsCount) * 1000) / 10
        : 0,
  }));

  // Daily series (7 days for today/7d, 14 days for 30d/all)
  const dayBucketsCount = input.range === "today" || input.range === "7d" ? 7 : 14;
  const dailyMap = new Map<
    string,
    {
      completedApproveOrComment: number;
      completedRequestChanges: number;
      failed: number;
      active: number;
    }
  >();
  for (const task of filtered) {
    const ms = Date.parse(task.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = localDateKey(ms);
    const bucket = dailyMap.get(key) ?? {
      completedApproveOrComment: 0,
      completedRequestChanges: 0,
      failed: 0,
      active: 0,
    };
    if (isPrReviewTaskRunning(task.stage)) {
      bucket.active += 1;
    } else if (task.stage === "completed") {
      if (task.verdict === "request-changes") bucket.completedRequestChanges += 1;
      else bucket.completedApproveOrComment += 1;
    } else if (task.stage === "failed") {
      bucket.failed += 1;
    }
    dailyMap.set(key, bucket);
  }

  const dailySeries: PrReviewDailyPoint[] = [];
  for (let offset = dayBucketsCount - 1; offset >= 0; offset--) {
    const dayMs = nowMs - offset * DAY_MS;
    const dateKey = localDateKey(dayMs);
    const b = dailyMap.get(dateKey) ?? {
      completedApproveOrComment: 0,
      completedRequestChanges: 0,
      failed: 0,
      active: 0,
    };
    const total = b.completedApproveOrComment + b.completedRequestChanges + b.failed + b.active;
    dailySeries.push({
      dateKey,
      label: shortMonthDayLabel(dayMs),
      ...b,
      total,
      hoursSaved: Math.round((hoursByDateKey.get(dateKey) ?? 0) * 10) / 10,
    });
  }

  const modelLeaderboard: PrReviewModelLeaderboardRow[] = [...modelStats.entries()]
    .map(([modelLabel, rec]) => {
      const concluded = rec.completedCount + rec.failedCount;
      let topRole: PrReviewRole | null = null;
      let topRoleCount = 0;
      for (const [role, count] of rec.roleCounts.entries()) {
        if (count > topRoleCount) {
          topRole = role;
          topRoleCount = count;
        }
      }
      return {
        modelLabel,
        totalParticipations: rec.reviewerRuns + rec.judgeRuns,
        reviewerRuns: rec.reviewerRuns,
        judgeRuns: rec.judgeRuns,
        completedCount: rec.completedCount,
        failedCount: rec.failedCount,
        successRate:
          concluded > 0 ? Math.round((rec.completedCount / concluded) * 1000) / 10 : null,
        avgDurationMs:
          rec.durations.length > 0
            ? Math.round(rec.durations.reduce((acc, v) => acc + v, 0) / rec.durations.length)
            : null,
        highSeverityHits: rec.highSeverityHits,
        consensusHits: rec.consensusHits,
        topRole,
      };
    })
    .toSorted(
      (a, b) =>
        b.totalParticipations - a.totalParticipations ||
        b.highSeverityHits - a.highSeverityHits ||
        (b.successRate ?? 0) - (a.successRate ?? 0),
    );

  const repoHotspots: PrReviewRepoHotspotRow[] = [...repoStats.entries()]
    .map(([key, rec]) => {
      const concluded = rec.completedRuns + rec.failedRuns;
      let linesReviewed = 0;
      for (const l of rec.maxLinesByPr.values()) linesReviewed += l;
      return {
        key,
        repository: rec.repository,
        host: rec.host,
        uniquePrs: rec.prNumbers.size,
        runs: rec.runs,
        linesReviewed,
        blockerMajorCount: rec.blockerMajorCount,
        requestChangesCount: rec.requestChangesCount,
        avgDurationMs:
          rec.durations.length > 0
            ? Math.round(rec.durations.reduce((acc, v) => acc + v, 0) / rec.durations.length)
            : null,
        successRate: concluded > 0 ? Math.round((rec.completedRuns / concluded) * 1000) / 10 : null,
      };
    })
    .toSorted(
      (a, b) =>
        b.blockerMajorCount - a.blockerMajorCount ||
        b.runs - a.runs ||
        b.linesReviewed - a.linesReviewed,
    );

  return {
    uniquePrCount,
    totalRunsCount: filtered.length,
    todayRunsCount,
    totalLinesReviewed,
    completedCount,
    approveCount,
    requestChangesCount,
    commentVerdictCount,
    failedCount,
    cancelledCount,
    activeCount,
    concludedValidCount,
    successRate,
    failureRate,
    subModelCompletedCount,
    subModelFailedCount,
    subModelSuccessRate,
    avgDurationMs,
    medianDurationMs,
    p90DurationMs,
    minDurationMs,
    avgParallelSpeedup,
    estimatedHoursSaved,
    estimatedPersonDaysSaved,
    totalFindingsCount,
    highSeverityFindingsCount,
    consensusFindingsCount,
    consensusRate,
    riskInterceptedPrCount,
    riskInterceptionRate,
    syncedCount,
    syncRate,
    offHoursCount,
    offHoursRate,
    stageLatencies,
    severityBreakdown,
    dailySeries,
    modelLeaderboard,
    repoHotspots,
  };
}
