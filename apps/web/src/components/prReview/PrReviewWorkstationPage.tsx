import { useAtomValue } from "@effect/atom-react";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PrReviewMode,
  PrReviewPreset,
  PrReviewTargetItem,
  PrReviewTask,
  PullRequestInvolvement,
  PullRequestListState,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { T, useGT, Var } from "gt-react";
import {
  ArrowUpRightIcon,
  BarChart3Icon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  GripVerticalIcon,
  LayersIcon,
  PlusIcon,
  Settings2Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { SelectableModelOption } from "~/components/issueAutomation/IssueAutomationConfigModals";
import { PullRequestSearchInput } from "~/components/pullRequest/PullRequestListFilters";
import type { EnvironmentPullRequestEntry } from "~/components/pullRequest/pullRequestList.logic";
import type { PullRequestHostAvailability } from "~/components/pullRequest/pullRequestProjectAssignment.logic";
import { PullRequestStateGlyph } from "~/components/pullRequest/pullRequestPresentation";
import { usePullRequestScope } from "~/components/pullRequest/usePullRequestListView";
import { RelativeTime } from "~/components/RelativeTime";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerVisible,
} from "~/providerInstances";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { prReviewEnvironment, usePrReviewLiveState } from "~/state/prReview";
import { pullRequestEnvironment, usePullRequestHostList } from "~/state/pullRequests";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetPopup } from "../ui/sheet";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PrReviewAnalyticsView } from "./PrReviewAnalyticsView";
import {
  isPrReviewStageActive,
  PrReviewInspector,
  PrReviewStageBadge,
  PrReviewVerdictBadge,
} from "./PrReviewInspector";
import {
  LaunchPrReviewDialog,
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

const EMPTY_HOST_AVAILABILITY: PullRequestHostAvailability = new Map();

function entryIdentityKey(entry: {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
}) {
  return `${entry.host.toLowerCase()}::${entry.repository.toLowerCase()}#${entry.number}`;
}

function toTargetItem(entry: EnvironmentPullRequestEntry): PrReviewTargetItem {
  return {
    provider: entry.provider,
    host: entry.host,
    projectId: entry.projectId,
    projectTitle: entry.projectTitle,
    repository: entry.repository,
    number: entry.number,
    title: entry.title,
    url: entry.url,
    author: entry.author?.login ?? null,
    headBranch: entry.headBranch,
    baseBranch: entry.baseBranch,
  };
}

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

export function PrReviewWorkstationPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const roleLabel = usePrReviewRoleLabel();
  const writeBackLabel = usePrReviewWriteBackLabel();
  const isWideDesktop = useMediaQuery("(min-width: 1024px)");
  const environmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const { snapshot, refresh: refreshPrReview } = usePrReviewLiveState(environmentId);
  const deletePreset = useAtomCommand(prReviewEnvironment.deletePreset, { reportFailure: false });
  const invalidatePrCache = useAtomCommand(pullRequestEnvironment.invalidate, {
    reportFailure: false,
  });

  const [prefs, setPrefs] = useLocalStorage(
    `t3code:pr-review:prefs:v2:${environmentId ?? "default"}`,
    DEFAULT_PR_WORKSTATION_PREFS,
    PrReviewWorkstationPrefsSchema,
  );
  const [query, setQuery] = useState("");
  const [runSearchQuery, setRunSearchQuery] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<ReadonlyArray<string>>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  const [launchModalState, setLaunchModalState] = useState<{
    targets: ReadonlyArray<PrReviewTargetItem>;
    defaultMode: PrReviewMode;
  } | null>(null);
  const [presetModalState, setPresetModalState] = useState<{
    open: boolean;
    preset: PrReviewPreset | null;
  }>({ open: false, preset: null });

  const serverConfigResult = useAtomValue(
    environmentId !== null
      ? serverEnvironment.configProjection({ environmentId, input: {} })
      : serverEnvironment.configProjection({ environmentId: "none" as EnvironmentId, input: {} }),
  );
  const providers =
    environmentId !== null
      ? (AsyncResult.getOrElse(serverConfigResult, () => null)?.config.providers ??
        EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;

  const modelOptions: ReadonlyArray<SelectableModelOption> = deriveProviderInstanceEntries(
    providers,
  )
    .filter(isProviderInstancePickerVisible)
    .flatMap((entry) =>
      entry.models.map((m) => ({
        key: `${entry.instanceId}::${m.slug}`,
        label: `${entry.displayName} · ${m.name || m.slug}`,
        selection: {
          instanceId: entry.instanceId,
          model: m.slug,
        },
      })),
    );

  const scope = usePullRequestScope(
    {
      involvement: prefs.involvement,
      state: prefs.state,
      ...(prefs.host ? { host: prefs.host } : {}),
      ...(query.trim() ? { q: query.trim() } : {}),
    },
    EMPTY_HOST_AVAILABILITY,
  );

  const listTargets = scope.environmentQueries.map(({ environmentId: envId, projectIds }) => ({
    environmentId: envId,
    input: {
      state: prefs.state,
      involvement: prefs.involvement,
      limit: 99,
      ...(projectIds ? { projectIds } : {}),
      ...(prefs.host ? { host: prefs.host } : {}),
      ...(query.trim() ? { query: query.trim() } : {}),
    },
  }));
  const prListQuery = usePullRequestHostList(listTargets);
  const prEntries = prListQuery.data?.entries ?? [];
  const hostProviders = prListQuery.data?.providers ?? [];

  const latestTaskByPrKey = new Map<string, PrReviewTask>();
  for (const task of snapshot.tasks) {
    const key = entryIdentityKey({
      host: task.host,
      repository: task.repository,
      number: task.prNumber,
    });
    if (!latestTaskByPrKey.has(key)) {
      latestTaskByPrKey.set(key, task);
    }
  }

  const selectedTask =
    selectedTaskId !== null ? (snapshot.tasks.find((t) => t.id === selectedTaskId) ?? null) : null;

  const selectedTaskCwd = selectedTask
    ? (allProjects.find((p) => p.id === selectedTask.projectId)?.workspaceRoot ?? "")
    : "";

  const inspectorVisible =
    selectedTask !== null &&
    environmentId !== null &&
    (prefs.tab === "queue" || prefs.tab === "runs");
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

  const handleRefreshAll = async () => {
    if (environmentId) {
      await invalidatePrCache({ environmentId, input: {} });
    }
    prListQuery.refresh(listTargets);
    refreshPrReview();
  };

  const toggleChecked = (key: string) => {
    setCheckedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const selectedEntries = prEntries.filter((e) => checkedKeys.includes(entryIdentityKey(e)));

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
          className="shrink-0 border-b bg-background"
        >
          <WorkspaceBreadcrumb ariaLabel={gt("PR Fusion Review Workstation")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="flex items-center gap-2 truncate">
                <ShieldCheckIcon className="size-4 text-primary" />
                <T>PR Multi-Model Fusion Review</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <div className="flex items-center gap-2">
            {snapshot.activeRunCount > 0 ? (
              <Badge variant="info">
                <Spinner className="mr-1 size-3" />
                <Var>{snapshot.activeRunCount}</Var> <T>running</T>
              </Badge>
            ) : null}
            {allTimeQuickSummary.completedCount > 0 ? (
              <button
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, tab: "analytics" }))}
                className="hidden items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground xl:inline-flex"
              >
                <CheckCircle2Icon className="size-3.5 text-success" />
                <span className="font-mono text-foreground tabular-nums">
                  {allTimeQuickSummary.successRate !== null
                    ? `${allTimeQuickSummary.successRate.toFixed(0)}%`
                    : "-"}
                </span>
                <span>·</span>
                <span className="font-mono text-primary tabular-nums">
                  +{allTimeQuickSummary.estimatedHoursSaved.toFixed(1)}h
                </span>
                <T>saved</T>
              </button>
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
              variant="outline"
              onClick={() => void handleRefreshAll()}
              aria-label={gt("Refresh")}
            >
              <RefreshIcon size="md" refreshing={prListQuery.isPending} />
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <ToggleGroup
                value={[prefs.tab]}
                onValueChange={(vals) => {
                  const next = vals[0] as PrReviewWorkstationTab | undefined;
                  if (next) setPrefs((prev) => ({ ...prev, tab: next }));
                }}
              >
                <Toggle value="queue" size="sm">
                  <LayersIcon className="size-3.5" />
                  <T>Cloud MR / PR Queue</T>
                </Toggle>
                <Toggle value="runs" size="sm">
                  <WorkflowIcon className="size-3.5" />
                  <T>Fusion Runs</T>
                  {snapshot.tasks.length > 0 ? (
                    <span className="ml-1 rounded-full bg-muted px-1.5 font-mono text-3xs tabular-nums">
                      {snapshot.tasks.length}
                    </span>
                  ) : null}
                </Toggle>
                <Toggle value="analytics" size="sm">
                  <BarChart3Icon className="size-3.5" />
                  <T>Metrics & ROI</T>
                </Toggle>
                <Toggle value="presets" size="sm">
                  <Settings2Icon className="size-3.5" />
                  <T>Presets & Skills</T>
                  <span className="ml-1 rounded-full bg-muted px-1.5 font-mono text-3xs tabular-nums">
                    {snapshot.presets.length}
                  </span>
                </Toggle>
              </ToggleGroup>

              {prefs.tab === "queue" && selectedEntries.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    <Var>{selectedEntries.length}</Var> <T>selected</T>
                  </span>
                  <Button
                    size="xs"
                    onClick={() =>
                      setLaunchModalState({
                        targets: selectedEntries.map(toTargetItem),
                        defaultMode: "multi_model_fusion",
                      })
                    }
                  >
                    <ShieldCheckIcon className="size-3.5" />
                    <T>
                      Batch Fusion Review (<Var>{selectedEntries.length}</Var>)
                    </T>
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setCheckedKeys([])}>
                    <T>Clear</T>
                  </Button>
                </div>
              ) : null}
            </div>

            {prefs.tab === "queue" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2">
                  <ToggleGroup
                    value={[prefs.involvement]}
                    onValueChange={(vals) => {
                      const next = vals[0] as PullRequestInvolvement | undefined;
                      if (next) setPrefs((prev) => ({ ...prev, involvement: next }));
                    }}
                  >
                    <Toggle value="authored" size="sm">
                      <T>Created by Me</T>
                    </Toggle>
                    <Toggle value="reviewing" size="sm">
                      <T>Reviewing</T>
                    </Toggle>
                    <Toggle value="all" size="sm">
                      <T>All</T>
                    </Toggle>
                  </ToggleGroup>

                  <Select
                    value={prefs.state}
                    onValueChange={(val) => {
                      if (val)
                        setPrefs((prev) => ({ ...prev, state: val as PullRequestListState }));
                    }}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="open">
                        <T>Open</T>
                      </SelectItem>
                      <SelectItem value="merged">
                        <T>Merged</T>
                      </SelectItem>
                      <SelectItem value="closed">
                        <T>Closed</T>
                      </SelectItem>
                      <SelectItem value="all">
                        <T>All states</T>
                      </SelectItem>
                    </SelectPopup>
                  </Select>

                  {hostProviders.length > 0 ? (
                    <Select
                      value={prefs.host || "__all__"}
                      onValueChange={(val) => {
                        setPrefs((prev) => ({
                          ...prev,
                          host: !val || val === "__all__" ? "" : val,
                        }));
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="__all__">
                          <T>All GitLab / GitHub hosts</T>
                        </SelectItem>
                        {hostProviders.map((hp) => (
                          <SelectItem key={hp.host} value={hp.host}>
                            {hp.host}
                            {!hp.configured ? ` (${gt("unauthenticated")})` : ""}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : null}

                  <div className="min-w-48 flex-1">
                    <PullRequestSearchInput
                      value={query}
                      busy={prListQuery.isPending && query.length > 0}
                      label={gt("Search PRs or MRs")}
                      placeholder={gt("Search cloud MRs / PRs by title or branch…")}
                      onChange={setQuery}
                      onSubmit={setQuery}
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
                  {prListQuery.isPending && prEntries.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
                      <Spinner className="size-4" />
                      <T>Loading cloud Merge Requests & Pull Requests…</T>
                    </div>
                  ) : prEntries.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ShieldCheckIcon className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>
                          <T>No matching Merge Requests or Pull Requests</T>
                        </EmptyTitle>
                        <EmptyDescription>
                          <T>
                            Configure your GitLab Personal Access Token in Settings → Source control
                            & issues, or switch filter tabs above to browse more items.
                          </T>
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="flex flex-col divide-y">
                      {prEntries.map((entry) => {
                        const key = entryIdentityKey(entry);
                        const checked = checkedKeys.includes(key);
                        const latestTask = latestTaskByPrKey.get(key) ?? null;
                        const { Icon: ProviderIcon } = getSourceControlPresentationForKind(
                          entry.provider,
                        );
                        const sigil = entry.provider === "gitlab" ? "!" : "#";
                        const isCloudUncloned = entry.projectId.startsWith("cloud:");

                        return (
                          <div
                            key={key}
                            className={cn(
                              "flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 text-xs transition-colors hover:bg-accent/30",
                              latestTask && latestTask.id === selectedTaskId ? "bg-accent/40" : "",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleChecked(key)}
                            />
                            <PullRequestStateGlyph state={entry.state} isDraft={entry.isDraft} />
                            <div className="min-w-48 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <ProviderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="font-mono text-muted-foreground">
                                  {entry.repository}
                                  {sigil}
                                  {entry.number}
                                </span>
                                {isCloudUncloned ? (
                                  <Badge variant="outline" size="sm">
                                    <T>Cloud MR</T>
                                  </Badge>
                                ) : null}
                                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                                  {entry.title}
                                </span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                                <span>@{entry.author?.login ?? "unknown"}</span>
                                <span>·</span>
                                <span className="font-mono">
                                  {entry.headBranch} → {entry.baseBranch}
                                </span>
                                <span>·</span>
                                <RelativeTime timestamp={entry.updatedAt} />
                              </div>
                            </div>

                            {latestTask ? (
                              <button
                                type="button"
                                onClick={() => setSelectedTaskId(latestTask.id)}
                                className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-accent"
                              >
                                {isPrReviewStageActive(latestTask.stage) ? (
                                  <PrReviewStageBadge stage={latestTask.stage} />
                                ) : (
                                  <PrReviewVerdictBadge verdict={latestTask.verdict} />
                                )}
                                <span className="text-2xs text-muted-foreground">
                                  <T>Report</T>
                                </span>
                              </button>
                            ) : null}

                            <div className="flex shrink-0 items-center gap-1.5">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  setLaunchModalState({
                                    targets: [toTargetItem(entry)],
                                    defaultMode: "direct_agent",
                                  })
                                }
                              >
                                <ZapIcon className="size-3 text-warning" />
                                <T>Agent Review</T>
                              </Button>
                              <Button
                                size="xs"
                                onClick={() =>
                                  setLaunchModalState({
                                    targets: [toTargetItem(entry)],
                                    defaultMode: "multi_model_fusion",
                                  })
                                }
                              >
                                <ShieldCheckIcon className="size-3" />
                                <T>Fusion Review</T>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : prefs.tab === "runs" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {snapshot.tasks.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2">
                    <ToggleGroup
                      value={[prefs.runFilter]}
                      onValueChange={(vals) => {
                        const next = vals[0] as PrReviewRunFilter | undefined;
                        if (next) setPrefs((prev) => ({ ...prev, runFilter: next }));
                      }}
                    >
                      <Toggle value="all" size="sm">
                        <T>All</T> ({snapshot.tasks.length})
                      </Toggle>
                      <Toggle value="active" size="sm">
                        <T>Running</T> ({allTimeQuickSummary.activeCount})
                      </Toggle>
                      <Toggle value="completed" size="sm">
                        <T>Succeeded</T> ({allTimeQuickSummary.completedCount})
                      </Toggle>
                      <Toggle value="request_changes" size="sm">
                        <T>Request Changes</T> ({allTimeQuickSummary.requestChangesCount})
                      </Toggle>
                      <Toggle value="failed" size="sm">
                        <T>Failed</T> ({allTimeQuickSummary.failedCount})
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
                  <div className="grid grid-cols-2 gap-2 border-b bg-card/20 px-4 py-2.5 sm:grid-cols-4">
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        <T>Success rate</T>
                      </span>
                      <span className="font-mono font-semibold text-success tabular-nums">
                        {allTimeQuickSummary.successRate !== null
                          ? `${allTimeQuickSummary.successRate.toFixed(1)}%`
                          : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        <T>Failure rate</T>
                      </span>
                      <span
                        className={cn(
                          "font-mono font-semibold tabular-nums",
                          (allTimeQuickSummary.failureRate ?? 0) > 0
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {allTimeQuickSummary.failureRate !== null
                          ? `${allTimeQuickSummary.failureRate.toFixed(1)}%`
                          : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        <T>Avg latency</T>
                      </span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatCompactDuration(allTimeQuickSummary.avgDurationMs)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrefs((prev) => ({ ...prev, tab: "analytics" }))}
                      className="flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-1.5 text-xs transition-colors hover:bg-accent/50"
                    >
                      <span className="text-muted-foreground">
                        <T>Est. saved</T>
                      </span>
                      <span className="font-mono font-semibold text-primary tabular-nums">
                        {allTimeQuickSummary.estimatedHoursSaved.toFixed(1)}h ↗
                      </span>
                    </button>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {filteredRuns.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <WorkflowIcon className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>
                          <T>No matching fusion review runs</T>
                        </EmptyTitle>
                        <EmptyDescription>
                          <T>
                            Select any Cloud MR or Pull Request in the queue to start a multi-model
                            fusion review or jump directly into an Agent session.
                          </T>
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="flex flex-col gap-2">
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
                              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3.5 text-xs transition-colors",
                              isSelected ? "border-primary bg-accent/60" : "hover:bg-accent/30",
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
                                <ArrowUpRightIcon className="size-3" />
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : prefs.tab === "analytics" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
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

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      <T>Human-effort ROI benchmark:</T>
                    </span>
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
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
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

                <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-7">
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
              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">
                        <T>Multi-Model Fusion Review Presets</T>
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        <T>
                          Configure heterogeneous reviewer models, synthesizer judge, bound skills,
                          and write-back automation.
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
                    <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                      <T>
                        No saved presets yet. Click &quot;Create Preset&quot; to build your reusable
                        multi-model review pipeline.
                      </T>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {snapshot.presets.map((preset) => (
                        <div
                          key={preset.id}
                          className="flex flex-col justify-between gap-3 rounded-lg border bg-card/40 p-3.5 text-xs"
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

                          <div className="flex items-center justify-end gap-2 border-t pt-2">
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
                  <h2 className="text-sm font-semibold">
                    <T>
                      Discovered Workspace & Provider Skills (
                      <Var>{snapshot.availableSkills.length}</Var>)
                    </T>
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {snapshot.availableSkills.map((skill) => (
                      <div
                        key={skill.name}
                        className="flex flex-col gap-1 rounded-lg border bg-card/30 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">
                            {skill.displayName || skill.name}
                          </span>
                          <Badge variant="outline" size="sm">
                            {skill.source}
                          </Badge>
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
              </div>
            )}
          </div>

          {desktopInspectorVisible ? (
            <aside
              className="relative hidden h-full min-h-0 shrink-0 border-l border-border bg-background lg:flex"
              style={{
                width: isInspectorExpanded
                  ? "min(84vw, 1320px)"
                  : `${String(clampedInspectorWidth)}px`,
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      role="separator"
                      tabIndex={0}
                      aria-orientation="vertical"
                      aria-label={gt("Drag to resize inspector width (double-click to reset)")}
                      onPointerDown={startResizeInspector}
                      onKeyDown={handleSplitterKeyDown}
                      onDoubleClick={() => {
                        setIsInspectorExpanded(false);
                        setPrefs((prev) => ({
                          ...prev,
                          inspectorWidth: DEFAULT_PR_INSPECTOR_WIDTH,
                        }));
                      }}
                      className={cn(
                        "group absolute inset-y-0 -left-1.5 z-20 flex w-3 cursor-col-resize items-center justify-center transition-colors focus-visible:outline-none",
                        isDraggingSplitter ? "bg-primary/25" : "hover:bg-primary/15",
                      )}
                    />
                  }
                >
                  <span
                    className={cn(
                      "flex h-10 w-3.5 items-center justify-center rounded-full border bg-background shadow-xs transition-opacity",
                      isDraggingSplitter
                        ? "border-primary text-primary opacity-100"
                        : "border-border/80 text-muted-foreground opacity-70 group-hover:opacity-100",
                    )}
                  >
                    <GripVerticalIcon className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="left">
                  <T>Drag to resize panel · Double-click to reset</T>
                </TooltipPopup>
              </Tooltip>

              {inspectorNode}
            </aside>
          ) : null}

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

      {launchModalState && environmentId ? (
        <LaunchPrReviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setLaunchModalState(null);
          }}
          environmentId={environmentId}
          targets={launchModalState.targets}
          presets={snapshot.presets}
          availableSkills={snapshot.availableSkills}
          modelOptions={modelOptions}
          defaultMode={launchModalState.defaultMode}
          onLaunched={({ tasks, jumpThreadId, mode }) => {
            setLaunchModalState(null);
            setCheckedKeys([]);
            if (mode === "direct_agent" && jumpThreadId) {
              jumpToThread(jumpThreadId as ThreadId);
              return;
            }
            if (tasks[0]) {
              setSelectedTaskId(tasks[0].id);
            }
          }}
        />
      ) : null}

      {presetModalState.open && environmentId ? (
        <PresetEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setPresetModalState({ open: false, preset: null });
          }}
          environmentId={environmentId}
          editingPreset={presetModalState.preset}
          availableSkills={snapshot.availableSkills}
          modelOptions={modelOptions}
        />
      ) : null}
    </SidebarInset>
  );
}
