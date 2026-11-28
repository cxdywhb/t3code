import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PrReviewPreset,
  PrReviewTask,
  PrReviewTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  LayersIcon,
  PlusIcon,
  Settings2Icon,
  ShieldAlertIcon,
  Trash2Icon,
  WorkflowIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import { PullRequestSearchInput } from "~/components/pullRequest/PullRequestListFilters";
import { RelativeTime } from "~/components/RelativeTime";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { WorkspaceInspectorDrawer } from "~/components/WorkspaceInspectorDrawer";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import {
  WORKSPACE_TAB_PANEL_CLASS,
  WorkspacePageHeader,
  WorkspacePageTitle,
  WorkspacePageToolbar,
} from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import { useProjects, useServerConfigs } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import {
  prReviewEnvironment,
  useFavoriteReviewSkills,
  usePrReviewLiveState,
} from "~/state/prReview";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogPanel, DialogPopup } from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetPopup } from "../ui/sheet";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PrReviewAnalyticsView } from "./PrReviewAnalyticsView";
import {
  isPrReviewStageActive,
  PrReviewInspector,
  PrReviewStageBadge,
  PrReviewVerdictBadge,
} from "./PrReviewInspector";
import {
  SkillMultiPicker,
  PresetEditorDialog,
  usePrReviewRoleLabel,
  usePrReviewWriteBackLabel,
} from "./PrReviewLaunchModal";
import {
  computePrReviewAnalytics,
  DEFAULT_PR_INSPECTOR_WIDTH,
  DEFAULT_PR_WORKSTATION_PREFS,
  extractTaskDiffStats,
  formatCompactDuration,
  formatCompactNumber,
  MAX_PR_INSPECTOR_WIDTH,
  MIN_PR_INSPECTOR_WIDTH,
  PrReviewWorkstationPrefsSchema,
  resolvePrReviewTaskDurationMs,
  type PrReviewRoiBaseline,
  type PrReviewRunFilter,
  type PrReviewTimeRange,
  type PrReviewWorkstationTab,
} from "./prReviewAnalytics.logic";

function RunDurationLabel({
  task,
  environmentId,
}: {
  readonly task: PrReviewTask;
  readonly environmentId: EnvironmentId | null;
}) {
  const nowMs = useNowSecond();
  const effectiveNow = environmentId !== null ? toServerClock(environmentId, nowMs) : nowMs;
  const durationMs = resolvePrReviewTaskDurationMs(task, effectiveNow);
  if (durationMs === null) return null;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground tabular-nums">
      <ClockIcon className="size-3 shrink-0 opacity-70" />
      {formatCompactDuration(durationMs)}
    </span>
  );
}

export function PrReviewWorkstationPage({
  preferredEnvironmentId,
  initialTaskId,
}: {
  preferredEnvironmentId?: EnvironmentId | undefined;
  initialTaskId?: PrReviewTaskId | undefined;
}) {
  const configs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const reviewEnvironments = [...configs].filter(
    ([, config]) => config.environment.capabilities.prReview === true,
  );
  const preferred = preferredEnvironmentId ?? primaryEnvironmentId;
  const environmentId =
    reviewEnvironments.find(([id]) => id === preferred)?.[0] ?? reviewEnvironments[0]?.[0] ?? null;
  return (
    <PrReviewWorkstation
      key={`${environmentId}:${initialTaskId ?? ""}`}
      environmentId={environmentId}
      initialTaskId={initialTaskId}
      environmentOptions={reviewEnvironments.map(([id, config]) => ({
        id,
        label: config.environment.label,
      }))}
    />
  );
}

function PrReviewWorkstation({
  environmentId,
  environmentOptions,
  initialTaskId,
}: {
  environmentId: EnvironmentId | null;
  environmentOptions: ReadonlyArray<{ id: EnvironmentId; label: string }>;
  initialTaskId?: PrReviewTaskId | undefined;
}) {
  const gt = useGT();
  const navigate = useNavigate({ from: "/pull-requests" });
  const roleLabel = usePrReviewRoleLabel();
  const writeBackLabel = usePrReviewWriteBackLabel();
  const isWideDesktop = useMediaQuery("(min-width: 1024px)");
  const [favorites, setFavorites] = useFavoriteReviewSkills(environmentId);
  const [addingSkills, setAddingSkills] = useState(false);
  const catalog = useEnvironmentQuery(
    addingSkills && environmentId
      ? prReviewEnvironment.skillsQuery({ environmentId, input: {} })
      : null,
  );
  const allProjects = useProjects();
  const { snapshot, isPending, refresh: refreshPrReview } = usePrReviewLiveState(environmentId);
  const deletePreset = useAtomCommand(prReviewEnvironment.deletePreset, { reportFailure: false });
  const [prefs, setPrefs] = useLocalStorage(
    `t3code:pr-review:prefs:v2:${environmentId ?? "default"}`,
    DEFAULT_PR_WORKSTATION_PREFS,
    PrReviewWorkstationPrefsSchema,
  );
  const [runSearchQuery, setRunSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  const [presetModalState, setPresetModalState] = useState<{
    open: boolean;
    preset: PrReviewPreset | null;
  }>({ open: false, preset: null });

  const [runOpened, setRunOpened] = useState(initialTaskId !== undefined);
  const tab = runOpened || prefs.tab === "queue" ? "runs" : prefs.tab;
  const selectedTask =
    selectedTaskId !== null ? (snapshot.tasks.find((t) => t.id === selectedTaskId) ?? null) : null;

  const selectedTaskCwd = selectedTask
    ? (allProjects.find((p) => p.id === selectedTask.projectId && p.environmentId === environmentId)
        ?.workspaceRoot ?? "")
    : "";

  const inspectorVisible = selectedTask !== null && environmentId !== null && tab === "runs";
  const desktopInspectorVisible = inspectorVisible && isWideDesktop;

  const clampedInspectorWidth = Math.max(
    MIN_PR_INSPECTOR_WIDTH,
    Math.min(MAX_PR_INSPECTOR_WIDTH, prefs.inspectorWidth || DEFAULT_PR_INSPECTOR_WIDTH),
  );

  const startResizeInspector = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isInspectorExpanded) {
      setIsInspectorExpanded(false);
    }
    setIsDraggingSplitter(true);
    const startX = event.clientX;
    const startWidth = clampedInspectorWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const maxAllowed = Math.min(MAX_PR_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.74));
      const nextWidth = Math.max(MIN_PR_INSPECTOR_WIDTH, Math.min(maxAllowed, startWidth + delta));
      setPrefs((prev) => ({ ...prev, inspectorWidth: nextWidth }));
    };
    const onUp = () => {
      setIsDraggingSplitter(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleSplitterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 24;
    const delta = event.key === "ArrowLeft" ? step : -step;
    const maxAllowed = Math.min(MAX_PR_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.74));
    const nextWidth = Math.max(
      MIN_PR_INSPECTOR_WIDTH,
      Math.min(maxAllowed, clampedInspectorWidth + delta),
    );
    setPrefs((prev) => ({ ...prev, inspectorWidth: nextWidth }));
  };

  const analyticsSummary = computePrReviewAnalytics({
    tasks: snapshot.tasks,
    range: prefs.analyticsRange,
    roiBaseline: prefs.roiBaseline,
  });

  const allTimeQuickSummary = computePrReviewAnalytics({
    tasks: snapshot.tasks,
    range: "all",
    roiBaseline: prefs.roiBaseline,
  });

  const filteredRuns = snapshot.tasks.filter((task) => {
    if (prefs.runFilter === "active" && !isPrReviewStageActive(task.stage)) return false;
    if (prefs.runFilter === "completed" && task.stage !== "completed") return false;
    if (
      prefs.runFilter === "request_changes" &&
      (task.stage !== "completed" || task.verdict !== "request-changes")
    ) {
      return false;
    }
    if (prefs.runFilter === "failed" && task.stage !== "failed" && task.stage !== "cancelled") {
      return false;
    }
    const q = runSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      task.repository.toLowerCase().includes(q) ||
      task.prTitle.toLowerCase().includes(q) ||
      String(task.prNumber).includes(q) ||
      task.reviewerRuns.some((r) => r.modelLabel.toLowerCase().includes(q))
    );
  });

  const jumpToThread = (threadId: ThreadId) => {
    if (!environmentId) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  const inspectorNode =
    selectedTask && environmentId ? (
      <PrReviewInspector
        environmentId={environmentId}
        task={selectedTask}
        cwd={selectedTaskCwd}
        isExpanded={isInspectorExpanded}
        onToggleExpand={() => setIsInspectorExpanded((prev) => !prev)}
        onJumpToThread={jumpToThread}
        onClose={() => {
          setIsInspectorExpanded(false);
          setSelectedTaskId(null);
        }}
      />
    ) : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex h-full min-h-0 flex-col">
        <WorkspacePageHeader
          electron={isElectron}
          reserveNativeControls={!desktopInspectorVisible}
          className="relative bg-background"
        >
          <WorkspacePageTitle ariaLabel={gt("PR Cross Review")}>
            <T>PR Cross Review</T>
          </WorkspacePageTitle>
          <div className="min-w-0 flex-1" />
          {environmentId && environmentOptions.length > 1 ? (
            <Select
              value={environmentId}
              onValueChange={(id) => {
                if (id)
                  void navigate({
                    to: "/pull-requests",
                    search: (previous) => ({
                      ...previous,
                      reviewEnvironmentId: id,
                      reviewTaskId: undefined,
                    }),
                    replace: true,
                  });
              }}
            >
              <SelectTrigger aria-label={gt("Environment")}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {environmentOptions.map(({ id, label }) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={gt("Pull requests")}
            render={
              <Link
                from="/pull-requests"
                to="/pull-requests"
                search={(previous) => ({
                  ...previous,
                  reviewWorkspace: undefined,
                  reviewEnvironmentId: undefined,
                  reviewTaskId: undefined,
                })}
              />
            }
          >
            <ArrowLeftIcon />
            <T>Pull requests</T>
          </Button>
          <div
            className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]"
            data-workspace-titlebar-controls
          >
            {snapshot.activeRunCount > 0 ? (
              <Badge variant="info">
                <Spinner className="mr-1 size-3" />
                <Var>{snapshot.activeRunCount}</Var> <T>running</T>
              </Badge>
            ) : null}
            {allTimeQuickSummary.completedCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="hidden xl:inline-flex"
                onClick={() => {
                  setRunOpened(false);
                  setPrefs((prev) => ({ ...prev, tab: "analytics" }));
                }}
              >
                <CheckCircle2Icon className="size-3.5 text-success" />
                <span className="font-mono text-foreground tabular-nums">
                  {allTimeQuickSummary.successRate !== null
                    ? `${allTimeQuickSummary.successRate.toFixed(0)}%`
                    : "-"}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-primary tabular-nums">
                  +{allTimeQuickSummary.estimatedHoursSaved.toFixed(1)}h
                </span>
                <span className="text-muted-foreground">
                  <T>saved</T>
                </span>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPresetModalState({ open: true, preset: null })}
            >
              <Settings2Icon className="size-3.5" />
              <T>New Preset</T>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={refreshPrReview}
              aria-label={gt("Refresh")}
            >
              <RefreshIcon size="md" refreshing={isPending} />
            </Button>
          </div>
        </WorkspacePageHeader>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              desktopInspectorVisible && isInspectorExpanded ? "hidden 2xl:flex" : "",
            )}
          >
            <WorkspacePageToolbar>
              <ToggleGroup
                className="max-w-full flex-wrap"
                value={[tab]}
                onValueChange={(vals) => {
                  const next = vals[0] as PrReviewWorkstationTab | undefined;
                  if (next) {
                    setRunOpened(false);
                    setPrefs((prev) => ({ ...prev, tab: next }));
                  }
                }}
              >
                <Toggle value="runs">
                  {snapshot.activeRunCount > 0 ? (
                    <Spinner size="xs" />
                  ) : (
                    <WorkflowIcon className="size-3.5" />
                  )}
                  <T>Fusion Runs</T>
                </Toggle>
                <Toggle value="analytics">
                  <BarChart3Icon className="size-3.5" />
                  <T>Metrics & ROI</T>
                </Toggle>
                <Toggle value="presets">
                  <Settings2Icon className="size-3.5" />
                  <T>Presets & Skills</T>
                </Toggle>
              </ToggleGroup>
            </WorkspacePageToolbar>

            {tab === "runs" ? (
              <div
                key="runs"
                className={cn("flex min-h-0 flex-1 flex-col", WORKSPACE_TAB_PANEL_CLASS)}
              >
                {snapshot.tasks.length > 0 || allTimeQuickSummary.totalRunsCount > 0 ? (
                  <div className="shrink-0 space-y-2.5 border-b border-border/50 bg-background px-5 pt-3 pb-2.5 sm:px-7">
                    {snapshot.tasks.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <ToggleGroup
                          value={[prefs.runFilter]}
                          onValueChange={(vals) => {
                            const next = vals[0] as PrReviewRunFilter | undefined;
                            if (next) setPrefs((prev) => ({ ...prev, runFilter: next }));
                          }}
                        >
                          <Toggle value="all">
                            <span className="inline-flex items-center gap-1.5">
                              <LayersIcon />
                              <T>All</T>
                              <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                                {snapshot.tasks.length}
                              </span>
                            </span>
                          </Toggle>
                          <Toggle value="active">
                            <span className="inline-flex items-center gap-1.5">
                              <ActivityIcon />
                              <T>Running</T>
                              {allTimeQuickSummary.activeCount > 0 ? (
                                <span className="font-mono text-2xs text-info tabular-nums">
                                  {allTimeQuickSummary.activeCount}
                                </span>
                              ) : null}
                            </span>
                          </Toggle>
                          <Toggle value="completed">
                            <span className="inline-flex items-center gap-1.5">
                              <CheckCircle2Icon />
                              <T>Succeeded</T>
                              <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                                {allTimeQuickSummary.completedCount}
                              </span>
                            </span>
                          </Toggle>
                          <Toggle value="request_changes">
                            <span className="inline-flex items-center gap-1.5">
                              <AlertTriangleIcon />
                              <T>Request Changes</T>
                              {allTimeQuickSummary.requestChangesCount > 0 ? (
                                <span className="font-mono text-2xs text-warning tabular-nums">
                                  {allTimeQuickSummary.requestChangesCount}
                                </span>
                              ) : null}
                            </span>
                          </Toggle>
                          <Toggle value="failed">
                            <span className="inline-flex items-center gap-1.5">
                              <XCircleIcon />
                              <T>Failed</T>
                              {allTimeQuickSummary.failedCount > 0 ? (
                                <span className="font-mono text-2xs text-destructive tabular-nums">
                                  {allTimeQuickSummary.failedCount}
                                </span>
                              ) : null}
                            </span>
                          </Toggle>
                        </ToggleGroup>

                        <div className="min-w-44 flex-1 sm:max-w-xs">
                          <PullRequestSearchInput
                            value={runSearchQuery}
                            busy={false}
                            label={gt("Filter runs")}
                            placeholder={gt("Filter runs by repo, title, or model…")}
                            onChange={setRunSearchQuery}
                            onSubmit={setRunSearchQuery}
                          />
                        </div>
                      </div>
                    ) : null}

                    {allTimeQuickSummary.totalRunsCount > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                          <span>
                            <T>Success rate</T>:{" "}
                            <strong className="font-mono text-success">
                              {allTimeQuickSummary.successRate !== null
                                ? `${allTimeQuickSummary.successRate.toFixed(1)}%`
                                : "-"}
                            </strong>
                          </span>
                          <span>
                            <T>Failure rate</T>:{" "}
                            <strong
                              className={cn(
                                "font-mono",
                                (allTimeQuickSummary.failureRate ?? 0) > 0
                                  ? "text-destructive"
                                  : "text-foreground",
                              )}
                            >
                              {allTimeQuickSummary.failureRate !== null
                                ? `${allTimeQuickSummary.failureRate.toFixed(1)}%`
                                : "-"}
                            </strong>
                          </span>
                          <span>
                            <T>Avg latency</T>:{" "}
                            <strong className="font-mono text-foreground">
                              {formatCompactDuration(allTimeQuickSummary.avgDurationMs)}
                            </strong>
                          </span>
                          <span>
                            <T>Est. saved</T>:{" "}
                            <strong className="font-mono text-primary">
                              {allTimeQuickSummary.estimatedHoursSaved.toFixed(1)}h
                            </strong>
                          </span>
                        </div>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setRunOpened(false);
                            setPrefs((prev) => ({ ...prev, tab: "analytics" }));
                          }}
                        >
                          <BarChart3Icon className="size-3.5 text-primary" />
                          <T>Metrics & ROI</T>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-16 sm:px-7">
                  {filteredRuns.length === 0 ? (
                    <div className="flex min-h-full items-center justify-center">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <WorkflowIcon className="size-5" />
                          </EmptyMedia>
                          <EmptyTitle>
                            <T>No matching fusion review runs</T>
                          </EmptyTitle>
                          <EmptyDescription>
                            <T>Open a pull request or merge request to start an AI review.</T>
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {filteredRuns.map((task) => {
                        const sigil = task.provider === "gitlab" ? "!" : "#";
                        const isSelected = task.id === selectedTaskId;
                        const diffStats = extractTaskDiffStats(task);
                        const highCount = task.findings.filter(
                          (f) => f.severity === "blocker" || f.severity === "major",
                        ).length;

                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") setSelectedTaskId(task.id);
                            }}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-xs transition-colors duration-150",
                              isSelected ? "bg-accent" : "hover:bg-accent/60",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-muted-foreground">
                                  {task.repository}
                                  {sigil}
                                  {task.prNumber}
                                </span>
                                <PrReviewStageBadge stage={task.stage} />
                                <PrReviewVerdictBadge verdict={task.verdict} />
                                {task.findings.length > 0 ? (
                                  <Badge variant="outline" size="sm">
                                    <Var>{task.findings.length}</Var> <T>findings</T>
                                  </Badge>
                                ) : null}
                                {highCount > 0 ? (
                                  <Badge variant="warning" size="sm">
                                    <ShieldAlertIcon className="mr-1 size-3" />
                                    <Var>{highCount}</Var> <T>high-sev</T>
                                  </Badge>
                                ) : null}
                                <RunDurationLabel task={task} environmentId={environmentId} />
                                {diffStats ? (
                                  <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                                    +{formatCompactNumber(diffStats.additions)}/-
                                    {formatCompactNumber(diffStats.deletions)}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1.5 text-sm font-medium text-foreground">
                                {task.prTitle}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                                <span>
                                  {task.reviewerRuns.map((r) => r.modelLabel).join(" + ")}
                                </span>
                                {task.boundSkillNames.length > 0 ? (
                                  <>
                                    <span>·</span>
                                    <span>
                                      <T>Skills:</T> {task.boundSkillNames.join(", ")}
                                    </span>
                                  </>
                                ) : null}
                                <span>·</span>
                                <RelativeTime timestamp={task.updatedAt} />
                              </div>
                            </div>

                            {task.synthesisThreadId ? (
                              <span className="group/agent-btn shrink-0">
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    jumpToThread(task.synthesisThreadId!);
                                  }}
                                >
                                  <BotIcon className="size-3.5" />
                                  <T>Agent</T>
                                  <ArrowUpRightIcon className="size-3 transition-transform duration-150 group-hover/agent-btn:translate-x-0.5 group-hover/agent-btn:-translate-y-0.5 motion-reduce:transition-none" />
                                </Button>
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : tab === "analytics" ? (
              <div
                key="analytics"
                className={cn("flex min-h-0 flex-1 flex-col", WORKSPACE_TAB_PANEL_CLASS)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-background px-5 py-3 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ClockIcon className="size-3.5" />
                      <T>Time window:</T>
                    </span>
                    <ToggleGroup
                      variant="segmented"
                      size="segmented"
                      value={[prefs.analyticsRange]}
                      onValueChange={(vals) => {
                        const next = vals[0] as PrReviewTimeRange | undefined;
                        if (next) setPrefs((prev) => ({ ...prev, analyticsRange: next }));
                      }}
                    >
                      <Toggle value="today">
                        <T>Today</T>
                      </Toggle>
                      <Toggle value="7d">
                        <T>Last 7 days</T>
                      </Toggle>
                      <Toggle value="30d">
                        <T>Last 30 days</T>
                      </Toggle>
                      <Toggle value="all">
                        <T>All time</T>
                      </Toggle>
                    </ToggleGroup>
                  </div>

                  <div className="flex min-w-0">
                    <Select
                      value={prefs.roiBaseline}
                      onValueChange={(val) => {
                        if (val) {
                          setPrefs((prev) => ({
                            ...prev,
                            roiBaseline: val as PrReviewRoiBaseline,
                          }));
                        }
                      }}
                    >
                      <SelectTrigger size="sm" aria-label={gt("Human-effort ROI benchmark:")}>
                        <SelectValue>
                          {prefs.roiBaseline === "conservative" ? (
                            <T>Conservative</T>
                          ) : prefs.roiBaseline === "strict" ? (
                            <T>Strict</T>
                          ) : (
                            <T>Standard</T>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup
                        align="end"
                        alignItemWithTrigger={false}
                        matchTriggerWidth={false}
                      >
                        <SelectItem value="conservative">
                          <T>Conservative (500 LoC/h)</T>
                        </SelectItem>
                        <SelectItem value="standard">
                          <T>Standard R&D (350 LoC/h)</T>
                        </SelectItem>
                        <SelectItem value="strict">
                          <T>Strict dual-gate (250 LoC/h)</T>
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                </div>

                <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-7">
                  <PrReviewAnalyticsView
                    summary={analyticsSummary}
                    roiBaseline={prefs.roiBaseline}
                    onJumpToRuns={(targetFilter) => {
                      setPrefs((prev) => ({
                        ...prev,
                        tab: "runs",
                        runFilter: targetFilter,
                      }));
                    }}
                  />
                </div>
              </div>
            ) : (
              <div
                key="presets"
                className={cn(
                  "topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto",
                  WORKSPACE_TAB_PANEL_CLASS,
                )}
              >
                <WorkspacePageContainer width="expanded" className="gap-6 pb-16">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold">
                          <T>Multi-Model Fusion Review Presets</T>
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          <T>
                            Configure heterogeneous reviewer models, synthesizer judge, bound
                            skills, and write-back automation.
                          </T>
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setPresetModalState({ open: true, preset: null })}
                      >
                        <PlusIcon className="size-3.5" />
                        <T>Create Preset</T>
                      </Button>
                    </div>

                    {snapshot.presets.length === 0 ? (
                      <Empty size="compact">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Settings2Icon />
                          </EmptyMedia>
                          <EmptyDescription>
                            <T>
                              No saved presets yet. Click &quot;Create Preset&quot; to build your
                              reusable multi-model review pipeline.
                            </T>
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {snapshot.presets.map((preset) => (
                          <div
                            key={preset.id}
                            className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card/40 p-3.5 text-xs shadow-xs/5 transition-colors duration-150 hover:border-border"
                          >
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold">{preset.name}</span>
                                {preset.isDefault ? (
                                  <Badge variant="secondary" size="sm">
                                    <T>Default</T>
                                  </Badge>
                                ) : null}
                              </div>
                              {preset.description ? (
                                <p className="text-muted-foreground">{preset.description}</p>
                              ) : null}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {preset.reviewerModels.map((slot) => (
                                  <Badge key={slot.id} variant="outline" size="sm">
                                    {slot.modelSelection.instanceId}:{slot.modelSelection.model} (
                                    {roleLabel(slot.role)})
                                  </Badge>
                                ))}
                              </div>
                              {preset.boundSkillNames.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                                  <span>
                                    <T>Skills:</T>
                                  </span>
                                  {preset.boundSkillNames.map((s) => (
                                    <Badge key={s} variant="secondary" size="sm">
                                      {s}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                              <div className="text-2xs text-muted-foreground">
                                {writeBackLabel(preset.writeBackMode)}
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setPresetModalState({ open: true, preset })}
                              >
                                <T>Edit</T>
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost-muted"
                                onClick={async () => {
                                  if (!environmentId) return;
                                  const r = await deletePreset({
                                    environmentId,
                                    input: { presetId: preset.id },
                                  });
                                  if (r._tag === "Failure") {
                                    const f = squashAtomCommandFailure(r);
                                    toastManager.add({
                                      type: "error",
                                      title: gt("Could not delete preset"),
                                      description: f instanceof Error ? f.message : String(f),
                                    });
                                  }
                                }}
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">
                        <T>Favorite skills</T>
                      </h2>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!environmentId}
                        onClick={() => setAddingSkills(true)}
                      >
                        <PlusIcon />
                        <T>Add skills</T>
                      </Button>
                    </div>
                    <Dialog open={addingSkills} onOpenChange={setAddingSkills}>
                      <DialogPopup>
                        <DialogHeader>
                          <DialogTitle>
                            <T>Add skills</T>
                          </DialogTitle>
                        </DialogHeader>
                        <DialogPanel>
                          {catalog.error ? (
                            <div role="alert">
                              {catalog.error}{" "}
                              <Button onClick={catalog.refresh}>
                                <T>Retry</T>
                              </Button>
                            </div>
                          ) : catalog.data ? (
                            <SkillMultiPicker
                              catalog
                              availableSkills={catalog.data}
                              selectedNames={favorites.map((s) => s.name)}
                              onChange={(names) =>
                                setFavorites((previous) =>
                                  names.flatMap(
                                    (name) =>
                                      previous.find((s) => s.name === name) ??
                                      catalog.data?.find((s) => s.name === name) ??
                                      [],
                                  ),
                                )
                              }
                            />
                          ) : (
                            <PullRequestListGhost rows={3} caption={gt("Loading skills")} />
                          )}
                        </DialogPanel>
                      </DialogPopup>
                    </Dialog>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {favorites.map((skill) => (
                        <div
                          key={skill.name}
                          className="flex flex-col gap-1 rounded-xl border border-border/60 bg-card/40 p-3 text-xs shadow-xs/5 transition-colors duration-150 hover:border-border"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold">
                              {skill.displayName || skill.name}
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={gt("Remove {name}", { name: skill.name })}
                              onClick={() =>
                                setFavorites((previous) =>
                                  previous.filter((s) => s.name !== skill.name),
                                )
                              }
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                          {skill.description ? (
                            <p className="line-clamp-2 text-2xs text-muted-foreground">
                              {skill.description}
                            </p>
                          ) : null}
                          <code className="truncate font-mono text-3xs text-muted-foreground">
                            {skill.path}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                </WorkspacePageContainer>
              </div>
            )}
          </div>

          <WorkspaceInspectorDrawer
            open={desktopInspectorVisible}
            scopeKey={environmentId}
            width={clampedInspectorWidth}
            expanded={isInspectorExpanded}
            isResizing={isDraggingSplitter}
            resizeLabel={gt("Drag to resize inspector width (double-click to reset)")}
            resizeTooltip={<T>Drag to resize panel · Double-click to reset</T>}
            onResizePointerDown={startResizeInspector}
            onResizeKeyDown={handleSplitterKeyDown}
            onResizeDoubleClick={() => {
              setIsInspectorExpanded(false);
              setPrefs((prev) => ({
                ...prev,
                inspectorWidth: DEFAULT_PR_INSPECTOR_WIDTH,
              }));
            }}
          >
            {inspectorNode}
          </WorkspaceInspectorDrawer>

          {!isWideDesktop && inspectorVisible ? (
            <Sheet
              open={inspectorVisible}
              onOpenChange={(open) => {
                if (!open) setSelectedTaskId(null);
              }}
            >
              <SheetPopup side="right" showCloseButton={false} className="max-w-2xl">
                {inspectorNode}
              </SheetPopup>
            </Sheet>
          ) : null}
        </div>
      </div>

      {presetModalState.open && environmentId ? (
        <PresetEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setPresetModalState({ open: false, preset: null });
          }}
          environmentId={environmentId}
          editingPreset={presetModalState.preset}
          availableSkills={favorites}
        />
      ) : null}
    </SidebarInset>
  );
}
