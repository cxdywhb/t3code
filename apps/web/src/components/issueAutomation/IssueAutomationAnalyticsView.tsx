import { T, useGT } from "gt-react";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  AwardIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  FolderGit2Icon,
  GitBranchIcon,
  HelpCircleIcon,
  LayersIcon,
  MoonStarIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";

import { WORKSPACE_TAB_PANEL_CLASS } from "~/components/WorkspacePageHeader";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  formatCompactDuration,
  type HotspotRow,
  type IssueAutomationAnalyticsSummary,
  type RunStatusFilter,
  type StageLatencyMetric,
} from "./issueAutomationAnalytics.logic";

export function IssueAutomationAnalyticsView({
  summary,
  onJumpToRuns,
}: {
  readonly summary: IssueAutomationAnalyticsSummary;
  readonly onJumpToRuns: (filter: RunStatusFilter) => void;
}) {
  const gt = useGT();
  const [hotspotTab, setHotspotTab] = useState<"repos" | "modules">("repos");

  if (summary.totalRunsCount === 0) {
    return (
      <Empty className="my-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TrendingUpIcon />
          </EmptyMedia>
          <EmptyTitle>
            <T>No runs in this period</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>Try a wider time range.</T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const stageLabel = (id: StageLatencyMetric["id"]): string => {
    switch (id) {
      case "context_route":
        return gt("Context fetch & multi-repo routing");
      case "primary_diagnosis":
        return gt("Primary model diagnosis & code fix");
      case "cross_review":
        return gt("Heterogeneous cross-model audit");
      case "write_back":
        return gt("ZenTao report & state sync");
    }
  };

  const totalBarBase = Math.max(
    1,
    summary.completedCount + summary.needsHumanCount + summary.activeCount + summary.failedCount,
  );
  const completedPct = (summary.completedCount / totalBarBase) * 100;
  const needsHumanPct = (summary.needsHumanCount / totalBarBase) * 100;
  const activePct = (summary.activeCount / totalBarBase) * 100;
  const failedPct = (summary.failedCount / totalBarBase) * 100;

  const maxDailyTotal = Math.max(1, ...summary.dailySeries.map((d) => d.total));
  const totalDailyHours =
    Math.round(summary.dailySeries.reduce((acc, d) => acc + d.hoursSaved, 0) * 10) / 10;

  const activeHotspots: ReadonlyArray<HotspotRow> =
    hotspotTab === "repos" ? summary.repoHotspots : summary.moduleHotspots;

  return (
    <div className="@container/issue-analytics flex flex-col gap-4 pb-12">
      <div className="grid grid-cols-1 gap-px rounded-lg border border-border/60 bg-border/60 overflow-hidden @min-[22rem]/issue-analytics:grid-cols-2 @min-[38rem]/issue-analytics:grid-cols-3 @min-[76rem]/issue-analytics:grid-cols-6">
        <div className="flex min-w-0 flex-col justify-between gap-1.5 bg-background p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Issues covered</T>
            </span>
            <LayersIcon className="size-3.5 shrink-0 opacity-70" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.uniqueIssuesCount}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              <T>Total runs</T> {summary.totalRunsCount}
            </span>
            <span>
              <T>Today</T> +{summary.todayRunsCount}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onJumpToRuns(summary.activeCount > 0 ? "active" : "all")}
          className="group flex min-w-0 cursor-pointer flex-col justify-between gap-1.5 bg-background p-3 text-start transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Completion rate</T>
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUpRightIcon className="size-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none" />
              <ActivityIcon className="size-3.5 shrink-0 text-info" />
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.completionRate !== null ? `${summary.completionRate.toFixed(1)}%` : "-"}
            </span>
            {summary.activeCount > 0 ? (
              <Badge variant="secondary" size="sm">
                {summary.activeCount} <T>running</T>
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {summary.completedCount + summary.needsHumanCount} / {summary.validRunsCount}{" "}
            <T>concluded runs</T>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onJumpToRuns("completed")}
          className="group flex min-w-0 cursor-pointer flex-col justify-between gap-1.5 bg-background p-3 text-start transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>First-pass success</T>
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUpRightIcon className="size-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none" />
              <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-success tabular-nums">
              {summary.successRate !== null ? `${summary.successRate.toFixed(1)}%` : "-"}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {summary.completedCount} <T>passed</T> · {summary.needsHumanCount} <T>review</T> ·{" "}
            {summary.failedCount} <T>failed</T>
          </div>
        </button>

        <div className="flex min-w-0 flex-col justify-between gap-1.5 bg-background p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Avg diagnosis time</T>
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
            P90 {formatCompactDuration(summary.p90DurationMs)} · <T>Min</T>{" "}
            {formatCompactDuration(summary.minDurationMs)}
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-1.5 bg-background p-3">
          <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Est. hours saved</T>
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={gt("ROI calculation formula")}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <HelpCircleIcon className="size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipPopup side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-medium">
                    <T>Deduplicated engineering ROI model:</T>
                  </p>
                  <p>
                    <T>
                      • Root-cause report only: 0.5h / unique bug; Isolated Worktree code fix: 1.2h
                      / unique bug.
                    </T>
                  </p>
                  <p>
                    <T>
                      • S1/S2 critical bugs apply a 1.3x complexity weight. Re-runs on the same bug
                      are never double-counted.
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
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            <T>Code branches</T> {summary.codeFixCount} · <T>Resolved</T>{" "}
            {summary.resolvedIssueCount}
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-1.5 bg-background p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              <T>Autonomous & sync</T>
            </span>
            <ZapIcon className="size-3.5 shrink-0 text-primary" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.unattendedRate !== null ? `${summary.unattendedRate.toFixed(0)}%` : "0%"}
            </span>
            <span className="text-xs text-muted-foreground">
              <T>unattended</T>
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            <T>Off-hours</T> {summary.offHoursConcludedCount} · <T>Synced</T>{" "}
            {summary.commentSyncedCount}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">
            <T>Pipeline outcome distribution</T>
          </span>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground tabular-nums">
            <button
              type="button"
              onClick={() => onJumpToRuns("completed")}
              className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-success" />
              <T>Completed</T> {summary.completedCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("needs_human")}
              className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-warning" />
              <T>Needs review</T> {summary.needsHumanCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("active")}
              className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-info" />
              <T>Running</T> {summary.activeCount}
            </button>
            <button
              type="button"
              onClick={() => onJumpToRuns("failed")}
              className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <span className="size-2 rounded-full bg-destructive" />
              <T>Failed</T> {summary.failedCount}
            </button>
          </div>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
          {completedPct > 0 ? (
            <div
              className="origin-left bg-success transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
              style={{ width: `${String(completedPct)}%` }}
            />
          ) : null}
          {needsHumanPct > 0 ? (
            <div
              className="origin-left bg-warning transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
              style={{ width: `${String(needsHumanPct)}%` }}
            />
          ) : null}
          {activePct > 0 ? (
            <div
              className="origin-left bg-info transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
              style={{ width: `${String(activePct)}%` }}
            />
          ) : null}
          {failedPct > 0 ? (
            <div
              className="origin-left bg-destructive transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
              style={{ width: `${String(failedPct)}%` }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col justify-between rounded-lg border border-border/60 p-4 xl:col-span-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                <T>Daily diagnosis throughput & efficiency trend</T>
              </h3>
            </div>
            <Badge variant="secondary" size="sm">
              <span className="font-mono tabular-nums">+{totalDailyHours.toFixed(1)}h</span>{" "}
              <T>in chart window</T>
            </Badge>
          </div>

          <div className="flex h-44 items-end gap-2 pt-4">
            {summary.dailySeries.map((point) => {
              const barHeightPct =
                point.total > 0 ? Math.max(8, Math.round((point.total / maxDailyTotal) * 100)) : 0;
              const okShare = point.total > 0 ? (point.completed / point.total) * 100 : 0;
              const reviewShare = point.total > 0 ? (point.needsHuman / point.total) * 100 : 0;
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
                          className="flex w-full origin-bottom flex-col-reverse overflow-hidden rounded-xs transition-[transform,filter] duration-300 ease-out starting:scale-y-0 group-hover:brightness-110 motion-reduce:transition-none"
                          style={{ height: `${String(barHeightPct)}%` }}
                        >
                          {okShare > 0 ? (
                            <div
                              className="w-full bg-success"
                              style={{ height: `${String(okShare)}%` }}
                            />
                          ) : null}
                          {reviewShare > 0 ? (
                            <div
                              className="w-full bg-warning"
                              style={{ height: `${String(reviewShare)}%` }}
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
                    <div className="space-y-0.5 font-mono tabular-nums">
                      <div className="font-sans font-medium">{point.dateKey}</div>
                      <div>
                        <T>Completed</T>: {point.completed} · <T>Needs review</T>:{" "}
                        {point.needsHuman} · <T>Failed</T>: {point.failed}
                      </div>
                      <div className="text-primary">
                        <T>Saved</T>: ≈ {point.hoursSaved.toFixed(1)}h
                      </div>
                    </div>
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-border/50 pt-3 text-xs sm:grid-cols-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MoonStarIcon className="size-3.5 shrink-0 text-primary" />
              <span>
                <T>Off-hours shield</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.offHoursConcludedCount}
                </strong>{" "}
                ({summary.offHoursRate !== null ? `${summary.offHoursRate.toFixed(0)}%` : "0%"})
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranchIcon className="size-3.5 shrink-0 text-primary" />
              <span>
                <T>Code-fix rate</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.codeFixRate !== null ? `${summary.codeFixRate.toFixed(0)}%` : "0%"}
                </strong>{" "}
                ({summary.codeFixCount})
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheckIcon className="size-3.5 shrink-0 text-warning" />
              <span>
                <T>Audit intercepts</T>:{" "}
                <strong className="font-mono text-foreground tabular-nums">
                  {summary.crossReviewInterceptCount}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-lg border border-border/60 p-4 xl:col-span-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              <T>Stage latency & critical bug breakdown</T>
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              <T>Average wall-clock latency per pipeline phase across concluded runs.</T>
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
                      className="h-full origin-left rounded-full bg-primary transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
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
                <T>Bug severity resolution matrix</T>
              </span>
              <span className="text-muted-foreground tabular-nums">
                S1/S2 <T>critical</T>: {summary.criticalResolvedCount}/{summary.criticalUniqueCount}{" "}
                (
                {summary.criticalSuccessRate !== null
                  ? `${summary.criticalSuccessRate.toFixed(0)}%`
                  : "-"}
                )
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {summary.severityBreakdown.map((item) => (
                <div
                  key={item.bucket}
                  className="rounded-md border border-border/50 bg-background/60 px-2.5 py-2 text-center"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span
                      className={cn(
                        "font-mono text-xs font-semibold",
                        item.bucket === "S1"
                          ? "text-destructive"
                          : item.bucket === "S2"
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {item.bucket}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-foreground tabular-nums">
                    {item.uniqueIssues}
                  </div>
                  <div className="font-mono text-3xs text-muted-foreground tabular-nums">
                    {item.successRate !== null ? `${item.successRate.toFixed(0)}%` : "-"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <BotIcon className="size-4 text-primary" />
                <T>Model performance & ROI leaderboard</T>
              </h3>
            </div>
            <AwardIcon className="size-4 shrink-0 text-muted-foreground" />
          </div>

          <div className="divide-y divide-border/50">
            {summary.modelLeaderboard.map((row, idx) => (
              <div
                key={row.modelLabel}
                className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 first:pt-1 last:pb-0 hover:bg-accent/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-secondary font-mono text-xs text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs font-medium text-foreground">
                      {row.modelLabel}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                      <span>
                        {row.runs} <T>runs</T>
                      </span>
                      <span>·</span>
                      <span>
                        <T>Avg</T> {formatCompactDuration(row.avgDurationMs)}
                      </span>
                      {row.codeFixCount > 0 ? (
                        <>
                          <span>·</span>
                          <span>
                            {row.codeFixCount} <T>fixes</T>
                          </span>
                        </>
                      ) : null}
                      {row.criticalCount > 0 ? (
                        <>
                          <span>·</span>
                          <span className="text-warning">S1/S2 ×{row.criticalCount}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-secondary sm:block">
                    <div
                      className="h-full origin-left rounded-full bg-success transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none"
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
        </div>

        <div className="flex flex-col rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <FolderGit2Icon className="size-4 text-primary" />
                <T>Defect concentration & resolution hotspots</T>
              </h3>
            </div>
            <ToggleGroup
              variant="segmented"
              size="segmented"
              value={[hotspotTab]}
              onValueChange={(next) => {
                const picked = next[0] as "repos" | "modules" | undefined;
                if (picked) setHotspotTab(picked);
              }}
            >
              <Toggle value="repos">
                <FolderGit2Icon />
                <T>Repositories</T>
              </Toggle>
              <Toggle value="modules">
                <LayersIcon />
                <T>Modules</T>
              </Toggle>
            </ToggleGroup>
          </div>

          {activeHotspots.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              <T>No repository or module routing records yet.</T>
            </p>
          ) : (
            <div
              key={hotspotTab}
              className={cn("divide-y divide-border/50", WORKSPACE_TAB_PANEL_CLASS)}
            >
              {activeHotspots.map((item) => (
                <div
                  key={item.key}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 first:pt-1 last:pb-0 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {item.title}
                      </span>
                      {item.subtitle ? (
                        <span className="truncate text-2xs text-muted-foreground">
                          ({item.subtitle})
                        </span>
                      ) : null}
                      {item.criticalCount > 0 ? (
                        <Badge variant="warning" size="sm">
                          S1/S2 ×{item.criticalCount}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                      <span>
                        {item.uniqueIssues} <T>bugs</T> ({item.runs} <T>runs</T>)
                      </span>
                      <span>·</span>
                      <span>
                        <T>Avg</T> {formatCompactDuration(item.avgDurationMs)}
                      </span>
                      {item.codeFixCount > 0 ? (
                        <>
                          <span>·</span>
                          <span>
                            {item.codeFixCount} <T>branches</T>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5">
                    <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-secondary sm:block">
                      <div
                        className={cn(
                          "h-full origin-left rounded-full transition-[width,transform] duration-300 ease-out starting:scale-x-0 motion-reduce:transition-none",
                          (item.successRate ?? 100) < 60 ? "bg-warning" : "bg-primary",
                        )}
                        style={{ width: `${String(item.successRate ?? 0)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs font-semibold text-foreground tabular-nums">
                      {item.successRate !== null ? `${item.successRate.toFixed(0)}%` : "-"}
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
