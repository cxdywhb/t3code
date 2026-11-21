import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  AwardIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  FolderGit2Icon,
  HelpCircleIcon,
  LayersIcon,
  MessageSquareShareIcon,
  MoonStarIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UsersIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePrReviewRoleLabel } from "./PrReviewLaunchModal";
import {
  formatCompactDuration,
  formatCompactNumber,
  type PrReviewAnalyticsSummary,
  type PrReviewRoiBaseline,
  type PrReviewRunFilter,
  type PrReviewStageLatency,
} from "./prReviewAnalytics.logic";

export function PrReviewAnalyticsView({
  summary,
  roiBaseline,
  onJumpToRuns,
}: {
  readonly summary: PrReviewAnalyticsSummary;
  readonly roiBaseline: PrReviewRoiBaseline;
  readonly onJumpToRuns: (filter: PrReviewRunFilter) => void;
}) {
  const gt = useGT();
  const roleLabel = usePrReviewRoleLabel();

  if (summary.totalRunsCount === 0) {
    return (
      <Empty className="my-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TrendingUpIcon className="size-5" />
          </EmptyMedia>
          <EmptyTitle>
            <T>No review telemetry in selected time window</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              Launch Multi-Model Fusion Reviews from the Cloud MR / PR Queue or widen the time range
              above to inspect pipeline reliability, stage latency, defect interception, and
              engineering hours saved.
            </T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const stageLabel = (id: PrReviewStageLatency["id"]): string => {
    switch (id) {
      case "fetching_context":
        return gt("1. Cloud MR metadata & full Diff fetch");
      case "parallel_reviewing":
        return gt("2. Parallel heterogeneous model review");
      case "synthesizing":
        return gt("3. Judge cross-verification & synthesis");
      case "writing_back":
        return gt("4. Remote comment & formal review sync");
    }
  };

  const baselineDesc =
    roiBaseline === "conservative"
      ? gt("Conservative baseline (500 LoC/h · max 2.2h/MR)")
      : roiBaseline === "strict"
        ? gt("Strict dual-expert baseline (250 LoC/h · max 4.8h/MR)")
        : gt("Standard R&D baseline (350 LoC/h · max 3.5h/MR)");

  const passOrCommentCount = summary.approveCount + summary.commentVerdictCount;
  const totalOutcomeBase = Math.max(
    1,
    passOrCommentCount + summary.requestChangesCount + summary.activeCount + summary.failedCount,
  );
  const passPct = (passOrCommentCount / totalOutcomeBase) * 100;
  const reqChangesPct = (summary.requestChangesCount / totalOutcomeBase) * 100;
  const activePct = (summary.activeCount / totalOutcomeBase) * 100;
  const failedPct = (summary.failedCount / totalOutcomeBase) * 100;

  const maxDailyTotal = Math.max(1, ...summary.dailySeries.map((d) => d.total));
  const chartWindowHours =
    Math.round(summary.dailySeries.reduce((acc, d) => acc + d.hoursSaved, 0) * 10) / 10;

  return (
    <div className="flex flex-col gap-5 pb-12">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>MR / PR coverage</T>
            </span>
            <LayersIcon className="size-3.5 shrink-0 opacity-70" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.uniquePrCount}
            </span>
            <span className="text-xs text-muted-foreground">
              <T>unique MRs</T>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              <T>Runs</T> {summary.totalRunsCount}
            </span>
            <span>
              {formatCompactNumber(summary.totalLinesReviewed)} <T>LoC audited</T>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onJumpToRuns("completed")}
          className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5 text-left transition-colors hover:border-border hover:bg-accent/40"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Success & failure rate</T>
            </span>
            <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-success tabular-nums">
              {summary.successRate !== null ? `${summary.successRate.toFixed(1)}%` : "-"}
            </span>
            {summary.failureRate !== null && summary.failureRate > 0 ? (
              <span className="inline-flex items-center gap-0.5 font-mono text-xs text-destructive tabular-nums">
                <XCircleIcon className="size-3" />
                {summary.failureRate.toFixed(1)}%
              </span>
            ) : (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                0% <T>fail</T>
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {summary.completedCount} <T>succeeded</T> · {summary.failedCount} <T>failed</T> ·{" "}
            <T>Sub-models</T>{" "}
            {summary.subModelSuccessRate !== null
              ? `${summary.subModelSuccessRate.toFixed(0)}%`
              : "-"}
          </div>
        </button>

        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>End-to-end latency</T>
            </span>
            <ClockIcon className="size-3.5 shrink-0 opacity-70" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatCompactDuration(summary.avgDurationMs)}
            </span>
            {summary.medianDurationMs !== null ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                P50 {formatCompactDuration(summary.medianDurationMs)}
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground tabular-nums">
            P90 {formatCompactDuration(summary.p90DurationMs)}
            {summary.avgParallelSpeedup !== null
              ? ` · ${summary.avgParallelSpeedup.toFixed(1)}x `
              : ` · ${gt("Min")} ${formatCompactDuration(summary.minDurationMs)}`}
            {summary.avgParallelSpeedup !== null ? <T>parallel speedup</T> : null}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5">
          <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Net R&D hours saved</T>
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={gt("ROI calculation methodology")}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <HelpCircleIcon className="size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipPopup side="bottom" className="max-w-xs">
                <div className="space-y-1 text-xs">
                  <p className="font-medium">{baselineDesc}</p>
                  <p>
                    <T>
                      • Deduplicated per unique MR so repeated runs on the same MR are never
                      double-counted.
                    </T>
                  </p>
                  <p>
                    <T>
                      • Scales by real Diff LoC with logarithmic tapering above 800 LoC (preventing
                      bundle/lockfile inflation), minus 10m human verification overhead.
                    </T>
                  </p>
                </div>
              </TooltipPopup>
            </Tooltip>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-primary tabular-nums">
              {summary.estimatedHoursSaved.toFixed(1)}h
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              ≈ {summary.estimatedPersonDaysSaved.toFixed(1)} <T>person-days</T>
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{baselineDesc}</div>
        </div>

        <button
          type="button"
          onClick={() => onJumpToRuns("request_changes")}
          className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5 text-left transition-colors hover:border-border hover:bg-accent/40"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Pre-merge risk interception</T>
            </span>
            <ShieldAlertIcon className="size-3.5 shrink-0 text-warning" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-warning tabular-nums">
              {summary.riskInterceptionRate !== null
                ? `${summary.riskInterceptionRate.toFixed(0)}%`
                : "-"}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              ({summary.riskInterceptedPrCount}/{summary.uniquePrCount} <T>MRs</T>)
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            <T>Blocker/Major</T> {summary.highSeverityFindingsCount} · <T>Consensus</T>{" "}
            {summary.consensusRate !== null ? `${summary.consensusRate.toFixed(0)}%` : "-"}
          </div>
        </button>

        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-card/60 p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Closed-loop & off-hours</T>
            </span>
            <MessageSquareShareIcon className="size-3.5 shrink-0 text-primary" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.syncRate !== null ? `${summary.syncRate.toFixed(0)}%` : "0%"}
            </span>
            <span className="text-xs text-muted-foreground">
              <T>synced to Git</T>
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            <T>Synced</T> {summary.syncedCount} · <T>Off-hours guard</T> {summary.offHoursCount}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">
            <T>Quality gate verdict & execution distribution</T>
          </span>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground tabular-nums">
            <button
              type="button"
              onClick={() => onJumpToRuns("completed")}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-success" />
              <T>Approve / Comment</T> {passOrCommentCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("request_changes")}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-warning" />
              <T>Request Changes</T> {summary.requestChangesCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("active")}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-info" />
              <T>Running</T> {summary.activeCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("failed")}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-destructive" />
              <T>Failed</T> {summary.failedCount}
            </button>
          </div>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
          {passPct > 0 ? (
            <div className="bg-success transition-all" style={{ width: `${String(passPct)}%` }} />
          ) : null}
          {reqChangesPct > 0 ? (
            <div
              className="bg-warning transition-all"
              style={{ width: `${String(reqChangesPct)}%` }}
            />
          ) : null}
          {activePct > 0 ? (
            <div className="bg-info transition-all" style={{ width: `${String(activePct)}%` }} />
          ) : null}
          {failedPct > 0 ? (
            <div
              className="bg-destructive transition-all"
              style={{ width: `${String(failedPct)}%` }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col justify-between rounded-lg border border-border/60 bg-card/50 p-4 xl:col-span-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                <T>Daily review throughput & engineering hours saved</T>
              </h3>
              <p className="text-xs text-muted-foreground">
                <T>
                  Stacked daily MR outcomes (Approved/Commented, Request Changes, Running, Failed)
                  and net hours saved.
                </T>
              </p>
            </div>
            <Badge variant="secondary" size="sm">
              <span className="font-mono tabular-nums">+{chartWindowHours.toFixed(1)}h</span>{" "}
              <T>in chart window</T>
            </Badge>
          </div>

          <div className="flex h-44 items-end gap-2 pt-4">
            {summary.dailySeries.map((point) => {
              const barHeightPct =
                point.total > 0 ? Math.max(8, Math.round((point.total / maxDailyTotal) * 100)) : 0;
              const okShare =
                point.total > 0 ? (point.completedApproveOrComment / point.total) * 100 : 0;
              const reqShare =
                point.total > 0 ? (point.completedRequestChanges / point.total) * 100 : 0;
              const activeShare = point.total > 0 ? (point.active / point.total) * 100 : 0;
              const failShare = point.total > 0 ? (point.failed / point.total) * 100 : 0;

              return (
                <Tooltip key={point.dateKey}>
                  <TooltipTrigger
                    render={
                      <div className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" />
                    }
                  >
                    <span className="font-mono text-3xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 tabular-nums">
                      {point.total > 0 ? point.total : ""}
                    </span>
                    <div className="flex w-full max-w-9 flex-1 items-end justify-center rounded-sm bg-secondary/40 px-0.5">
                      {point.total > 0 ? (
                        <div
                          className="flex w-full flex-col-reverse overflow-hidden rounded-xs transition-all group-hover:opacity-90"
                          style={{ height: `${String(barHeightPct)}%` }}
                        >
                          {okShare > 0 ? (
                            <div
                              className="w-full bg-success"
                              style={{ height: `${String(okShare)}%` }}
                            />
                          ) : null}
                          {reqShare > 0 ? (
                            <div
                              className="w-full bg-warning"
                              style={{ height: `${String(reqShare)}%` }}
                            />
                          ) : null}
                          {activeShare > 0 ? (
                            <div
                              className="w-full bg-info"
                              style={{ height: `${String(activeShare)}%` }}
                            />
                          ) : null}
                          {failShare > 0 ? (
                            <div
                              className="w-full bg-destructive"
                              style={{ height: `${String(failShare)}%` }}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div className="h-0.5 w-full rounded-full bg-border/60" />
                      )}
                    </div>
                    <span className="truncate font-mono text-3xs text-muted-foreground tabular-nums">
                      {point.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    <div className="space-y-0.5 font-mono text-xs tabular-nums">
                      <div className="font-sans font-medium">{point.dateKey}</div>
                      <div>
                        <T>Pass/Comment</T>: {point.completedApproveOrComment} ·{" "}
                        <T>Request Changes</T>: {point.completedRequestChanges} · <T>Failed</T>:{" "}
                        {point.failed}
                      </div>
                      <div className="text-primary">
                        <T>Net R&D saved</T>: ≈ {point.hoursSaved.toFixed(1)}h
                      </div>
                    </div>
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-border/50 pt-3 text-xs sm:grid-cols-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ZapIcon className="size-3.5 shrink-0 text-primary" />
              <span>
                <T>Parallel speedup</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.avgParallelSpeedup !== null
                    ? `${summary.avgParallelSpeedup.toFixed(2)}x`
                    : "-"}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <UsersIcon className="size-3.5 shrink-0 text-primary" />
              <span>
                <T>Multi-model consensus</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.consensusFindingsCount}/{summary.totalFindingsCount}
                </strong>{" "}
                ({summary.consensusRate !== null ? `${summary.consensusRate.toFixed(0)}%` : "0%"})
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MoonStarIcon className="size-3.5 shrink-0 text-warning" />
              <span>
                <T>Off-hours guard</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.offHoursCount}
                </strong>{" "}
                ({summary.offHoursRate !== null ? `${summary.offHoursRate.toFixed(0)}%` : "0%"})
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-lg border border-border/60 bg-card/50 p-4 xl:col-span-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              <T>Pipeline phase latency & defect severity matrix</T>
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              <T>Average wall-clock latency across each stage of the fusion review pipeline.</T>
            </p>

            <div className="space-y-2.5">
              {summary.stageLatencies.map((stage) => (
                <div key={stage.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-foreground">{stageLabel(stage.id)}</span>
                    <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                      {formatCompactDuration(stage.avgDurationMs)}
                      {stage.sharePercent > 0 ? ` (${stage.sharePercent.toFixed(0)}%)` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${String(Math.max(stage.avgDurationMs ? 4 : 0, stage.sharePercent))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border/50 pt-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                <T>Identified defect severity breakdown</T>
              </span>
              <span className="text-muted-foreground tabular-nums">
                <T>Total findings</T>: <Var>{summary.totalFindingsCount}</Var>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {summary.severityBreakdown.map((item) => (
                <div
                  key={item.severity}
                  className="rounded-md border border-border/50 bg-background/60 px-2.5 py-2 text-center"
                >
                  <div
                    className={cn(
                      "font-mono text-2xs font-semibold uppercase",
                      item.severity === "blocker"
                        ? "text-destructive"
                        : item.severity === "major"
                          ? "text-warning"
                          : item.severity === "minor"
                            ? "text-info"
                            : "text-muted-foreground",
                    )}
                  >
                    {item.severity}
                  </div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-foreground tabular-nums">
                    {item.count}
                  </div>
                  <div className="font-mono text-3xs text-muted-foreground tabular-nums">
                    {item.sharePercent.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <BotIcon className="size-4 text-primary" />
                <T>Heterogeneous model reliability & bug-catch leaderboard</T>
              </h3>
              <p className="text-xs text-muted-foreground">
                <T>
                  Compare model execution reliability, average response latency, and high-severity
                  defect catches.
                </T>
              </p>
            </div>
            <AwardIcon className="size-4 shrink-0 text-muted-foreground" />
          </div>

          {summary.modelLeaderboard.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              <T>No model execution records yet.</T>
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {summary.modelLeaderboard.map((row, idx) => (
                <div
                  key={row.modelLabel}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-secondary font-mono text-xs text-muted-foreground tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-medium text-foreground">
                          {row.modelLabel}
                        </span>
                        {row.topRole ? (
                          <Badge variant="secondary" size="sm">
                            {roleLabel(row.topRole)}
                          </Badge>
                        ) : null}
                        {row.judgeRuns > 0 ? (
                          <Badge variant="outline" size="sm">
                            <T>Judge</T> ×{row.judgeRuns}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                        <span>
                          {row.reviewerRuns} <T>reviews</T>
                        </span>
                        <span>·</span>
                        <span>
                          <T>Avg</T> {formatCompactDuration(row.avgDurationMs)}
                        </span>
                        {row.highSeverityHits > 0 ? (
                          <>
                            <span>·</span>
                            <span className="text-warning">
                              <T>High-sev</T> ×{row.highSeverityHits}
                            </span>
                          </>
                        ) : null}
                        {row.consensusHits > 0 ? (
                          <>
                            <span>·</span>
                            <span>
                              <T>Consensus</T> ×{row.consensusHits}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5">
                    <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-secondary sm:block">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (row.successRate ?? 100) < 80 ? "bg-warning" : "bg-success",
                        )}
                        style={{ width: `${String(row.successRate ?? 0)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs font-semibold text-foreground tabular-nums">
                      {row.successRate !== null ? `${row.successRate.toFixed(0)}%` : "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <FolderGit2Icon className="size-4 text-primary" />
                <T>Repository quality & review workload hotspots</T>
              </h3>
              <p className="text-xs text-muted-foreground">
                <T>
                  Track code churn, high-severity defect concentration, and gate interception across
                  repositories.
                </T>
              </p>
            </div>
            <ActivityIcon className="size-4 shrink-0 text-muted-foreground" />
          </div>

          {summary.repoHotspots.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              <T>No repository review records yet.</T>
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {summary.repoHotspots.map((repo) => (
                <div
                  key={repo.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-medium text-foreground">
                        {repo.repository}
                      </span>
                      <span className="text-2xs text-muted-foreground">({repo.host})</span>
                      {repo.blockerMajorCount > 0 ? (
                        <Badge variant="warning" size="sm">
                          <T>High-sev</T> ×{repo.blockerMajorCount}
                        </Badge>
                      ) : (
                        <Badge variant="outline" size="sm">
                          <ShieldCheckIcon className="mr-1 size-3 text-success" />
                          <T>Clean</T>
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                      <span>
                        {repo.uniquePrs} <T>MRs</T> ({repo.runs} <T>runs</T>)
                      </span>
                      {repo.linesReviewed > 0 ? (
                        <>
                          <span>·</span>
                          <span>
                            {formatCompactNumber(repo.linesReviewed)} <T>LoC</T>
                          </span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>
                        <T>Avg</T> {formatCompactDuration(repo.avgDurationMs)}
                      </span>
                      {repo.requestChangesCount > 0 ? (
                        <>
                          <span>·</span>
                          <span className="text-warning">
                            <T>Blocked</T> ×{repo.requestChangesCount}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                      {repo.successRate !== null ? `${repo.successRate.toFixed(0)}%` : "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
