import { useAtomValue } from "@effect/atom-react";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueAutomationActionMode,
  IssueAutomationBrowseFilter,
  IssueAutomationConnector,
  IssueAutomationListRemoteIssuesResult,
  IssueAutomationProfile,
  IssueAutomationScanProfileIssuesResult,
  IssueAutomationTask,
  ModelSelection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { issueAutomationWorkbenchTitleZh } from "@t3tools/shared/issueAutomationTitle";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useLocale } from "gt-react";
import {
  ActivityIcon,
  BarChart3Icon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDotIcon,
  ClockIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayersIcon,
  MessageSquareIcon,
  PanelRightIcon,
  PencilIcon,
  PlayIcon,
  Plug2Icon,
  Settings2Icon,
  UserRoundIcon,
  WorkflowIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ComposerSurface } from "~/components/chat/ComposerSurface";
import {
  OfficialModelPicker,
  useOfficialModelCatalog,
} from "~/components/chat/OfficialModelPicker";
import { PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import { PullRequestSearchInput } from "~/components/pullRequest/PullRequestListFilters";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowLines,
} from "~/components/pullRequest/PullRequestListRow";
import { PullRequestMetaLine } from "~/components/pullRequest/pullRequestPresentation";
import { RelativeTime } from "~/components/RelativeTime";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { WorkspaceInspectorDrawer } from "~/components/WorkspaceInspectorDrawer";
import {
  WORKSPACE_BAR_ENTER_CLASS,
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
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects } from "~/state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { issueAutomationEnvironment, useIssueAutomationLiveState } from "~/state/issueAutomation";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetPopup } from "../ui/sheet";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  computeIssueAutomationAnalytics,
  DEFAULT_WORKBENCH_PREFS,
  formatCompactDuration,
  groupIssueAutomationTasks,
  isStageRunning,
  IssueAutomationWorkbenchPrefsSchema,
  makeScopePrefKey,
  resolvePersistedModelSelection,
  resolvePersistedTarget,
  resolveTaskDurationMs,
  sortScopesByIdDesc,
  type AnalyticsScopeMode,
  type AnalyticsTimeRange,
  type RunStatusFilter,
  type WorkbenchTab,
} from "./issueAutomationAnalytics.logic";
import { IssueAutomationAnalyticsView } from "./IssueAutomationAnalyticsView";
import {
  ConnectorModal,
  ProfileModal,
  SearchableProjectMenu,
  SearchableScopeMenu,
  SELECTOR_SCROLL_LIST_STYLE,
  type SelectableProjectOption,
} from "./IssueAutomationConfigModals";
import {
  IssueAutomationInspectorContent,
  type InspectorSubTab,
  type ManualWriteBackPayload,
} from "./IssueAutomationInspector";
import {
  cleanIssueText,
  formatIssueNumber,
  isStageActive,
  RemoteIssueStatusGlyph,
  SeverityIndicator,
  StageBadge,
  TaskStageGlyph,
  useActionModeLabel,
} from "./issueAutomationPresentation";
import { IssueAutomationRulesView } from "./IssueAutomationRulesView";

const MIN_INSPECTOR_WIDTH = 440;
const MAX_INSPECTOR_WIDTH = 960;

function LiveRunningDuration({
  task,
  environmentId,
}: {
  readonly task: IssueAutomationTask;
  readonly environmentId: EnvironmentId | null;
}) {
  const nowMs = useNowSecond();
  const effectiveNowMs = environmentId !== null ? toServerClock(environmentId, nowMs) : nowMs;
  const durationMs = resolveTaskDurationMs(task, effectiveNowMs);
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap font-mono text-xs text-info tabular-nums">
      <ClockIcon className="size-3 shrink-0" />
      {formatCompactDuration(durationMs)}
    </span>
  );
}

function TaskDurationBadge({
  task,
  environmentId,
}: {
  readonly task: IssueAutomationTask;
  readonly environmentId: EnvironmentId | null;
}) {
  if (isStageRunning(task.stage)) {
    return <LiveRunningDuration task={task} environmentId={environmentId} />;
  }
  const durationMs = resolveTaskDurationMs(task, 0);
  if (durationMs === null) return null;
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
      <ClockIcon className="size-3 shrink-0 opacity-70" />
      {formatCompactDuration(durationMs)}
    </span>
  );
}

export function IssueAutomationPage() {
  const gt = useGT();
  const locale = useLocale();
  const pageTitle =
    locale === "zh" ? issueAutomationWorkbenchTitleZh : gt("ZenTao Issue Auto-Analysis");
  const navigate = useNavigate();
  const actionModeLabel = useActionModeLabel();
  const isWideDesktop = useMediaQuery("(min-width: 1024px)");
  const environmentId = usePrimaryEnvironmentId();
  const capabilities = useEnvironment(environmentId)?.serverConfig?.environment.capabilities;
  const supportsRuleScan = capabilities?.issueAutomationRuleScan === true;
  const supportsRetry = capabilities?.issueAutomationRetry === true;
  const supportsRepair = capabilities?.issueAutomationRepair === true;
  const canStartRepair = useAtomValue(
    issueAutomationEnvironment.analyzeIssues.permissionAtom(environmentId),
  );
  const canConfirmRepair = useAtomValue(
    issueAutomationEnvironment.confirmRepair.permissionAtom(environmentId),
  );
  const canConfigureConnector = useAtomValue(
    issueAutomationEnvironment.startConnectorAuth.permissionAtom(environmentId),
  );
  const canWriteBack = useAtomValue(
    issueAutomationEnvironment.writeBack.permissionAtom(environmentId),
  );
  const { snapshot } = useIssueAutomationLiveState(environmentId);
  const taskGroups = groupIssueAutomationTasks(snapshot.tasks);

  const storageKey = `t3code:issue-automation:prefs:v1:${environmentId ?? "default"}`;
  const [prefs, setPrefs] = useLocalStorage(
    storageKey,
    DEFAULT_WORKBENCH_PREFS,
    IssueAutomationWorkbenchPrefsSchema,
  );

  const allProjects = useProjects();
  const envProjects: ReadonlyArray<SelectableProjectOption> = allProjects
    .filter((p) => environmentId === null || p.environmentId === environmentId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      workspaceRoot: p.workspaceRoot,
    }));

  const projectTitleById = new Map(envProjects.map((p) => [p.id as string, p.title]));

  const activeTab = prefs.activeTab;
  const setActiveTab = (next: WorkbenchTab) => {
    setPrefs((prev) => ({ ...prev, activeTab: next }));
  };

  const activeConnector: IssueAutomationConnector | null =
    snapshot.connectors.find((c) => c.id === prefs.selectedConnectorId) ??
    snapshot.connectors[0] ??
    null;
  const activeConnectorHealthy = activeConnector !== null && activeConnector.status === "connected";

  const sortedConnectorScopes = activeConnector ? sortScopesByIdDesc(activeConnector.scopes) : [];

  const persistedScopeForConnector = activeConnector
    ? prefs.scopeByConnector[activeConnector.id]
    : undefined;
  const effectiveScopeId =
    persistedScopeForConnector &&
    sortedConnectorScopes.some((s) => s.id === persistedScopeForConnector)
      ? persistedScopeForConnector
      : (sortedConnectorScopes[0]?.id ?? "");
  const effectiveScopeName =
    sortedConnectorScopes.find((s) => s.id === effectiveScopeId)?.name ?? effectiveScopeId;

  const browseType = prefs.browseType;
  const runFilter = prefs.runFilter;
  const analyticsRange = prefs.analyticsRange;
  const analyticsScopeMode = prefs.analyticsScopeMode;
  const inspectorWidth = Math.max(
    MIN_INSPECTOR_WIDTH,
    Math.min(MAX_INSPECTOR_WIDTH, prefs.inspectorWidth || DEFAULT_WORKBENCH_PREFS.inspectorWidth),
  );

  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [runQuery, setRunQuery] = useState("");
  const [scanningProfileId, setScanningProfileId] = useState<IssueAutomationProfile["id"] | null>(
    null,
  );
  const [scanSelection, setScanSelection] = useState<{
    environmentId: EnvironmentId;
    profileId: IssueAutomationProfile["id"];
  } | null>(null);

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [checkedIssueKeys, setCheckedIssueKeys] = useState<ReadonlyArray<string>>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorSubTab>("detail");
  const [isDraggingInspector, setIsDraggingInspector] = useState(false);

  const [connectorModalOpen, setConnectorModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<IssueAutomationConnector | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<IssueAutomationProfile | null>(null);

  const scopePrefKey = makeScopePrefKey(activeConnector?.id, effectiveScopeId);

  const scannedProfile =
    scanSelection && scanSelection.environmentId === environmentId
      ? (snapshot.profiles.find(
          (profile) =>
            profile.id === scanSelection.profileId &&
            profile.connectorId === activeConnector?.id &&
            profile.scopeId === effectiveScopeId,
        ) ?? null)
      : null;
  const matchedScopeProfile =
    scannedProfile ??
    (activeConnector && effectiveScopeId
      ? (snapshot.profiles.find(
          (p) => p.connectorId === activeConnector.id && p.scopeId === effectiveScopeId,
        ) ?? null)
      : null);

  const validProjectIds = envProjects.map((p) => p.id);

  const resolvedTargets = resolvePersistedTarget({
    prefs,
    scopeKey: scopePrefKey,
    profilePrimaryProjectId: matchedScopeProfile?.repositories.primaryProjectId,
    profilePrimaryModelKey: "",
    profileActionMode: matchedScopeProfile?.policy.actionMode,
    validProjectIds,
    validModelKeys: [],
  });

  const diagnosisOnly = resolvedTargets.actionMode === "diagnose_only";
  const catalog = useOfficialModelCatalog(environmentId, diagnosisOnly);
  const resolvedProjectId = resolvedTargets.projectId;
  const resolvedModelSelection = resolvePersistedModelSelection({
    prefs,
    scopeKey: scopePrefKey,
    profilePrimaryModel: matchedScopeProfile?.models.primaryModel,
    ...(diagnosisOnly || catalog.pickableEntries.length > 0
      ? { isSelectionAvailable: catalog.isSelectionAvailable }
      : {}),
    fallbackSelection: catalog.firstAvailableSelection,
  });
  const resolvedActionMode = resolvedTargets.actionMode;

  const clearIssueSelection = () => {
    setSelectedIssueKey(null);
    setCheckedIssueKeys([]);
    setPage(1);
  };

  const clearScan = () => {
    setScanSelection(null);
    clearIssueSelection();
  };

  const handleSelectConnector = (nextConnectorId: string) => {
    setPrefs((prev) => ({
      ...prev,
      selectedConnectorId: nextConnectorId,
    }));
    clearScan();
  };

  const handleSelectScope = (nextScopeId: string) => {
    if (!activeConnector) return;
    setPrefs((prev) => ({
      ...prev,
      selectedConnectorId: activeConnector.id,
      scopeByConnector: {
        ...prev.scopeByConnector,
        [activeConnector.id]: nextScopeId,
      },
    }));
    clearScan();
  };

  const handleSelectBrowseType = (nextBrowseType: IssueAutomationBrowseFilter) => {
    setPrefs((prev) => ({ ...prev, browseType: nextBrowseType }));
    setPage(1);
  };

  const handleSelectProject = (nextProjectId: string) => {
    setPrefs((prev) => ({
      ...prev,
      lastProjectId: nextProjectId,
      ...(scopePrefKey
        ? {
            projectByScope: {
              ...prev.projectByScope,
              [scopePrefKey]: nextProjectId,
            },
          }
        : {}),
    }));
  };

  const handleSelectModel = (nextModelSelection: ModelSelection) => {
    const nextModelKey = `${nextModelSelection.instanceId}::${nextModelSelection.model}`;
    setPrefs((prev) => ({
      ...prev,
      lastModelKey: nextModelKey,
      lastModelSelection: nextModelSelection,
      ...(scopePrefKey
        ? {
            modelByScope: {
              ...prev.modelByScope,
              [scopePrefKey]: nextModelKey,
            },
            modelSelectionByScope: {
              ...prev.modelSelectionByScope,
              [scopePrefKey]: nextModelSelection,
            },
          }
        : {}),
    }));
  };

  const handleSelectActionMode = (nextMode: IssueAutomationActionMode) => {
    setPrefs((prev) => ({
      ...prev,
      lastMode: nextMode,
      ...(scopePrefKey
        ? {
            modeByScope: {
              ...prev.modeByScope,
              [scopePrefKey]: nextMode,
            },
          }
        : {}),
    }));
  };

  const handleSelectRunFilter = (nextFilter: RunStatusFilter) => {
    setPrefs((prev) => ({ ...prev, runFilter: nextFilter }));
  };

  const handleSelectAnalyticsRange = (nextRange: AnalyticsTimeRange) => {
    setPrefs((prev) => ({ ...prev, analyticsRange: nextRange }));
  };

  const handleSelectAnalyticsScopeMode = (nextMode: AnalyticsScopeMode) => {
    setPrefs((prev) => ({ ...prev, analyticsScopeMode: nextMode }));
  };

  const remoteIssuesQuery = useEnvironmentQuery<
    IssueAutomationListRemoteIssuesResult | IssueAutomationScanProfileIssuesResult,
    unknown
  >(
    environmentId !== null &&
      activeConnector !== null &&
      activeConnector.status !== "disconnected" &&
      effectiveScopeId.length > 0
      ? scannedProfile
        ? issueAutomationEnvironment.scanProfileIssues({
            environmentId,
            profile: scannedProfile,
            page,
            supportsRuleScan,
          })
        : issueAutomationEnvironment.remoteIssues({
            environmentId,
            input: {
              connectorId: activeConnector.id,
              scopeId: effectiveScopeId,
              browseType,
              ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
              page,
              pageSize: 25,
            },
          })
      : null,
  );

  const activeTask: IssueAutomationTask | null =
    selectedTaskId !== null
      ? (snapshot.tasks.find((t) => t.id === selectedTaskId) ?? null)
      : selectedIssueKey !== null
        ? (taskGroups.find(
            ({ latest }) =>
              latest.issueKey === selectedIssueKey && latest.connectorId === activeConnector?.id,
          )?.latest ?? null)
        : null;
  const inspectingRun = inspectorTab === "trace" && activeTask !== null;
  const detailConnectorId = inspectingRun ? activeTask.connectorId : activeConnector?.id;
  const detailScopeId = inspectingRun ? activeTask.scopeId : effectiveScopeId;
  const remoteDetailQuery = useEnvironmentQuery(
    environmentId !== null &&
      detailConnectorId !== undefined &&
      detailScopeId.length > 0 &&
      selectedIssueKey !== null &&
      inspectorOpen
      ? issueAutomationEnvironment.remoteIssueDetail({
          environmentId,
          input: {
            connectorId: detailConnectorId,
            scopeId: detailScopeId,
            issueKey: selectedIssueKey,
          },
        })
      : null,
  );

  const analyzeIssuesCmd = useAtomCommand(issueAutomationEnvironment.analyzeIssues, {
    reportFailure: false,
  });
  const cancelTaskCmd = useAtomCommand(issueAutomationEnvironment.cancelTask, {
    reportFailure: false,
  });
  const confirmRepairCmd = useAtomCommand(issueAutomationEnvironment.confirmRepair, {
    reportFailure: false,
  });
  const writeBackCmd = useAtomCommand(issueAutomationEnvironment.writeBack, {
    reportFailure: false,
  });
  const refreshScopesCmd = useAtomCommand(issueAutomationEnvironment.refreshScopes, {
    reportFailure: false,
  });
  const deleteConnectorCmd = useAtomCommand(issueAutomationEnvironment.deleteConnector, {
    reportFailure: false,
  });
  const setProfileEnabledCmd = useAtomCommand(issueAutomationEnvironment.setProfileEnabled, {
    reportFailure: false,
  });
  const deleteProfileCmd = useAtomCommand(issueAutomationEnvironment.deleteProfile, {
    reportFailure: false,
  });
  const [dispatching, setDispatching] = useState(false);
  const [writingBack, setWritingBack] = useState(false);

  const issues = remoteIssuesQuery.data?.issues ?? [];
  const issuePage = remoteIssuesQuery.data;
  const hasNextIssuesPage =
    issuePage && ("hasNextPage" in issuePage ? issuePage.hasNextPage : issues.length >= 25);
  const changeIssuePage = (next: number) => {
    if (scannedProfile !== null && environmentId !== null) {
      const query = issueAutomationEnvironment.scanProfileIssues({
        environmentId,
        profile: scannedProfile,
        page: next,
        supportsRuleScan,
      });
      const cached = query.initialValueTarget ?? query;
      if (appAtomRegistry.getNodes().has(cached) && !appAtomRegistry.get(cached).waiting) {
        appAtomRegistry.refresh(query);
      }
    }
    setPage(next);
  };
  const selectedIssueSummary =
    selectedIssueKey !== null ? (issues.find((i) => i.key === selectedIssueKey) ?? null) : null;
  const selectedDetail = remoteDetailQuery.data;

  const latestTask =
    activeTask &&
    taskGroups.find(
      ({ latest }) =>
        latest.connectorId === activeTask.connectorId && latest.issueKey === activeTask.issueKey,
    )?.latest;
  const canRetryRepair =
    activeTask?.repairOfTaskId !== undefined &&
    (activeTask.stage === "cancelled" || activeTask.stage === "failed");
  const repairSource =
    activeTask?.id === latestTask?.id
      ? canRetryRepair
        ? snapshot.tasks.find((task) => task.id === activeTask?.repairOfTaskId)
        : activeTask
      : null;

  const hasSelection = selectedIssueKey !== null || activeTask !== null;
  const inspectorActive =
    inspectorOpen &&
    hasSelection &&
    (activeTab === "issues" || activeTab === "runs") &&
    environmentId !== null;
  const desktopInspectorVisible = inspectorActive && isWideDesktop;

  const analyticsSummary = computeIssueAutomationAnalytics({
    tasks: snapshot.tasks,
    range: analyticsRange,
    scopeMode: analyticsScopeMode,
    currentConnectorId: activeConnector?.id ?? null,
    currentScopeId: effectiveScopeId,
    projectTitleById,
  });

  const allRunsQuickSummary = computeIssueAutomationAnalytics({
    tasks: snapshot.tasks,
    range: "all",
    scopeMode: "all",
    currentConnectorId: activeConnector?.id ?? null,
    currentScopeId: effectiveScopeId,
    projectTitleById,
  });

  const openThread = (threadId: ThreadId) => {
    if (!environmentId) return;
    const params = buildThreadRouteParams(scopeThreadRef(environmentId, threadId));
    void navigate({
      to: "/$environmentId/$threadId",
      params,
    });
  };

  const selectIssue = (issueKey: string, linkedTaskId: IssueAutomationTask["id"] | null) => {
    setSelectedIssueKey(issueKey);
    setSelectedTaskId(linkedTaskId ?? null);
    setInspectorTab("detail");
    setInspectorOpen(true);
  };

  const selectRun = (task: IssueAutomationTask) => {
    setSelectedTaskId(task.id);
    setSelectedIssueKey(task.issueKey);
    setInspectorTab("trace");
    setInspectorOpen(true);
  };

  const startResizeInspector = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingInspector(true);
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    let latestWidth = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const maxAllowed = Math.min(MAX_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.62));
      latestWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxAllowed, startWidth + delta));
      setPrefs((prev) => ({ ...prev, inspectorWidth: latestWidth }));
    };
    const onUp = () => {
      setIsDraggingInspector(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleScanProfile = async (profile: IssueAutomationProfile) => {
    if (!environmentId || scanningProfileId !== null) return;
    setScanningProfileId(profile.id);
    const query = issueAutomationEnvironment.scanProfileIssues({
      environmentId,
      profile,
      page: 1,
      supportsRuleScan,
    });
    const result = await executeAtomQuery(appAtomRegistry, query, {
      refresh: appAtomRegistry.getNodes().has(query.initialValueTarget ?? query),
      reportFailure: false,
    });
    setScanningProfileId(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Could not scan issues"),
        description: formatEnvironmentQueryError(result.cause),
      });
      return;
    }

    clearIssueSelection();
    setSelectedTaskId(null);
    setInspectorOpen(false);
    setScanSelection({ environmentId, profileId: profile.id });
    setPrefs((prev) => ({
      ...prev,
      activeTab: "issues",
      selectedConnectorId: profile.connectorId,
      scopeByConnector: { ...prev.scopeByConnector, [profile.connectorId]: profile.scopeId },
    }));
  };

  const handleInspectorSplitterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 24;
    const delta = event.key === "ArrowLeft" ? step : -step;
    const maxAllowed = Math.min(MAX_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.62));
    const nextWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxAllowed, inspectorWidth + delta));
    setPrefs((prev) => ({ ...prev, inspectorWidth: nextWidth }));
  };

  const handleDispatchIssues = async (keysToRun: ReadonlyArray<string>) => {
    if (!environmentId || !activeConnector || !effectiveScopeId || keysToRun.length === 0) return;
    const chosenProjectId = (resolvedProjectId as ProjectId) || envProjects[0]?.id;
    const chosenModel =
      resolvedModelSelection ??
      (diagnosisOnly ? null : matchedScopeProfile?.models.primaryModel) ??
      catalog.firstAvailableSelection ??
      null;

    if (!chosenProjectId || !chosenModel) {
      toastManager.add({
        type: "error",
        title: gt("Missing repository or model"),
        description: gt("Add at least one local project and an active model provider first."),
      });
      return;
    }

    const baseLinkedIds =
      matchedScopeProfile?.repositories.linkedProjectIds ?? envProjects.map((p) => p.id);
    const mergedLinkedIds = baseLinkedIds.includes(chosenProjectId)
      ? baseLinkedIds
      : [chosenProjectId, ...baseLinkedIds];
    const profileModels = matchedScopeProfile?.models;
    const availableOverride = (selection: ModelSelection | null | undefined) =>
      diagnosisOnly && !catalog.isSelectionAvailable(selection) ? null : (selection ?? null);

    setDispatching(true);
    const res = await analyzeIssuesCmd({
      environmentId,
      input: {
        connectorId: activeConnector.id,
        scopeId: effectiveScopeId,
        scopeName: effectiveScopeName,
        issueKeys: [...keysToRun],
        ...(matchedScopeProfile ? { profileId: matchedScopeProfile.id } : {}),
        overrideRepositories: {
          primaryProjectId: chosenProjectId,
          linkedProjectIds: [...mergedLinkedIds],
          moduleMappings: matchedScopeProfile?.repositories.moduleMappings ?? [],
        },
        overrideModels: {
          primaryModel: chosenModel,
          highSeverityModel: availableOverride(profileModels?.highSeverityModel),
          triageModel: profileModels?.triageModel ?? null,
          reviewModel: profileModels?.reviewModel ?? null,
          fallbackModel: availableOverride(profileModels?.fallbackModel),
        },
        overridePolicy: {
          actionMode: resolvedActionMode,
          autoWriteComment: matchedScopeProfile?.policy.autoWriteComment ?? true,
          baseBranch: matchedScopeProfile?.policy.baseBranch ?? null,
          customPromptInstructions: matchedScopeProfile?.policy.customPromptInstructions ?? null,
        },
      },
    });
    setDispatching(false);

    if (res._tag === "Failure") {
      const err = squashAtomCommandFailure(res);
      toastManager.add({
        type: "error",
        title: gt("Failed to start analysis"),
        description: err instanceof Error ? err.message : gt("Dispatch failed."),
      });
      return;
    }

    setCheckedIssueKeys([]);
    const launched = res.value.tasks[0];
    if (launched) {
      setSelectedTaskId(launched.id);
      setSelectedIssueKey(launched.issueKey);
      setInspectorTab("trace");
      setInspectorOpen(true);
    }
  };

  const handleRunFromTask = async (task: IssueAutomationTask, kind: "retry" | "repair") => {
    if (
      !environmentId ||
      dispatching ||
      (kind === "repair" ? !supportsRepair || !canStartRepair : !supportsRetry)
    )
      return;
    setDispatching(true);
    const result = await analyzeIssuesCmd({
      environmentId,
      input: {
        connectorId: task.connectorId,
        scopeId: task.scopeId,
        scopeName: task.scopeName,
        issueKeys: [task.issueKey],
        ...(task.profileId ? { profileId: task.profileId } : {}),
        ...(kind === "repair" ? { repairFromTaskId: task.id } : { retryTaskId: task.id }),
      },
    });
    setDispatching(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: kind === "repair" ? gt("Failed to start repair") : gt("Failed to start analysis"),
        description: error instanceof Error ? error.message : gt("Dispatch failed."),
      });
      return;
    }
    const attempt = result.value.tasks[0];
    if (attempt) selectRun(attempt);
  };

  const handleConfirmRepair = async (taskId: IssueAutomationTask["id"]) => {
    if (!environmentId || dispatching || !canConfirmRepair) return;
    setDispatching(true);
    const result = await confirmRepairCmd({ environmentId, input: { taskId } });
    setDispatching(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not confirm repair"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const handleCancelTask = async (taskId: IssueAutomationTask["id"]) => {
    if (!environmentId) return;
    const result = await cancelTaskCmd({ environmentId, input: { taskId } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not cancel diagnosis"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const handleManualWriteBack = async (action: ManualWriteBackPayload): Promise<boolean> => {
    if (!environmentId || !detailConnectorId || writingBack) return false;
    setWritingBack(true);
    const res = await writeBackCmd({
      environmentId,
      input: {
        connectorId: detailConnectorId,
        action,
      },
    });
    setWritingBack(false);
    if (res._tag === "Failure") {
      const err = squashAtomCommandFailure(res);
      toastManager.add({
        type: "error",
        title: gt("ZenTao write-back failed"),
        description: err instanceof Error ? err.message : gt("The platform rejected the write."),
      });
      return false;
    }
    remoteDetailQuery.refresh();
    remoteIssuesQuery.refresh();
    toastManager.add({
      type: "success",
      title: gt("Synced to ZenTao"),
    });
    return true;
  };

  const browseFilterLabel = (filter: IssueAutomationBrowseFilter): string => {
    switch (filter) {
      case "unresolved":
        return gt("Unresolved");
      case "unclosed":
        return gt("Unclosed");
      case "assigntome":
        return gt("Assigned to me");
      case "openedbyme":
        return gt("Opened by me");
      case "all":
        return gt("All issues");
    }
  };

  const groupCounts = {
    all: taskGroups.length,
    active: 0,
    needs_human: 0,
    completed: 0,
    failed: 0,
  };
  const query = runQuery.trim().toLowerCase();
  const filteredGroups = taskGroups.filter(({ latest, attempts }) => {
    const stage = latest.stage;
    const filter =
      stage === "needs_human" || stage === "completed"
        ? stage
        : isStageActive(stage)
          ? "active"
          : "failed";
    groupCounts[filter] += 1;
    return (
      (runFilter === "all" || runFilter === filter) &&
      (!query ||
        attempts.some(
          (task) =>
            task.displayKey.toLowerCase().includes(query) ||
            task.issueTitle.toLowerCase().includes(query) ||
            task.assignedModelLabel.toLowerCase().includes(query),
        ))
    );
  });

  const allVisibleChecked =
    issues.length > 0 && issues.every((issue) => checkedIssueKeys.includes(issue.key));

  const inspectorBody =
    environmentId !== null ? (
      <IssueAutomationInspectorContent
        environmentId={environmentId}
        connector={activeConnector}
        issueSummary={selectedIssueSummary}
        issueDetail={selectedDetail}
        detailLoading={remoteDetailQuery.isPending}
        detailError={remoteDetailQuery.error}
        onRefreshDetail={remoteDetailQuery.refresh}
        activeTask={activeTask}
        inspectorTab={inspectorTab}
        onInspectorTabChange={setInspectorTab}
        projects={envProjects}
        matchedProfile={matchedScopeProfile}
        adhocProjectId={resolvedProjectId}
        onAdhocProjectIdChange={handleSelectProject}
        adhocModelSelection={resolvedModelSelection}
        onAdhocModelSelectionChange={handleSelectModel}
        adhocMode={resolvedActionMode}
        onAdhocModeChange={handleSelectActionMode}
        dispatching={dispatching}
        onDispatchIssue={(key) => void handleDispatchIssues([key])}
        onStartRepair={
          supportsRepair &&
          canStartRepair &&
          repairSource?.actionMode === "diagnose_only" &&
          repairSource.stage === "completed" &&
          repairSource.diagnosisReport &&
          repairSource.targetProjectId
            ? () => void handleRunFromTask(repairSource, "repair")
            : undefined
        }
        onConfirmRepair={canConfirmRepair ? (id) => void handleConfirmRepair(id) : undefined}
        canWriteBack={canWriteBack}
        writingBack={writingBack}
        onManualWriteBack={handleManualWriteBack}
        onCancelTask={(taskId) => void handleCancelTask(taskId)}
        onOpenThread={openThread}
        onEditConnector={
          activeConnector
            ? () => {
                setEditingConnector(activeConnector);
                setConnectorModalOpen(true);
              }
            : undefined
        }
        onClose={() => setInspectorOpen(false)}
      />
    ) : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <WorkspacePageHeader
            data-chat-header
            electron={isElectron}
            reserveNativeControls={!desktopInspectorVisible}
            className="relative bg-background"
          >
            <WorkspacePageTitle ariaLabel={pageTitle}>{pageTitle}</WorkspacePageTitle>
            <div className="min-w-0 flex-1" />

            <div
              className="flex items-center gap-2 [-webkit-app-region:no-drag]"
              data-workspace-titlebar-controls
            >
              {activeConnector ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="sm"
                        variant={activeConnectorHealthy ? "ghost" : "outline"}
                        aria-label={gt("Edit connection settings")}
                        onClick={() => {
                          setEditingConnector(activeConnector);
                          setConnectorModalOpen(true);
                        }}
                      />
                    }
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        activeConnectorHealthy ? "bg-primary" : "bg-warning",
                      )}
                    />
                    <span className="max-w-28 truncate xl:max-w-48">
                      {activeConnector.name}
                      <span className="hidden text-muted-foreground xl:inline">
                        {" "}
                        · {activeConnector.viewerName ?? activeConnector.name}
                      </span>
                    </span>
                    <PencilIcon className="size-3 shrink-0 opacity-70" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">{gt("Edit connection settings")}</TooltipPopup>
                </Tooltip>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canConfigureConnector}
                  onClick={() => {
                    setEditingConnector(null);
                    setConnectorModalOpen(true);
                  }}
                >
                  <Plug2Icon className="size-3.5" />
                  <T>Connect ZenTao</T>
                </Button>
              )}

              {activeConnector?.status === "disconnected" ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canConfigureConnector}
                  onClick={() => {
                    setEditingConnector(activeConnector);
                    setConnectorModalOpen(true);
                  }}
                >
                  <Plug2Icon className="size-3.5" />
                  <T>Authorize MCP</T>
                </Button>
              ) : activeConnector ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingProfile(matchedScopeProfile);
                    setProfileModalOpen(true);
                  }}
                >
                  <Settings2Icon className="size-3.5" />
                  <T>Unattended rule</T>
                </Button>
              ) : null}

              {activeTab === "issues" || activeTab === "runs" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant={inspectorActive ? "secondary" : "ghost"}
                        disabled={!hasSelection}
                        aria-label={gt("Toggle detail inspector")}
                        onClick={() => setInspectorOpen((open) => !open)}
                      />
                    }
                  >
                    <PanelRightIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {hasSelection ? gt("Toggle detail panel") : gt("Select an issue or run first")}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </WorkspacePageHeader>

          {snapshot.connectors.length > 0 ? (
            <WorkspacePageToolbar>
              <ToggleGroup
                className="max-w-full flex-wrap"
                value={[activeTab]}
                onValueChange={(next) => {
                  const picked = next[0] as WorkbenchTab | undefined;
                  if (picked) setActiveTab(picked);
                }}
              >
                <Toggle value="issues">
                  <CircleDotIcon className="size-3.5" />
                  <T>Issue list</T>
                </Toggle>
                <Toggle value="runs">
                  {snapshot.activeRunCount > 0 ? (
                    <Spinner size="xs" />
                  ) : (
                    <WorkflowIcon className="size-3.5" />
                  )}
                  <T>Runs</T> ({taskGroups.length})
                </Toggle>
                <Toggle value="analytics">
                  <BarChart3Icon className="size-3.5" />
                  <T>Analytics</T>
                </Toggle>
                <Toggle value="rules">
                  <Settings2Icon className="size-3.5" />
                  <T>Automation</T>
                </Toggle>
              </ToggleGroup>
            </WorkspacePageToolbar>
          ) : null}

          {snapshot.connectors.length === 0 ? (
            <div className="scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-12">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BotIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    <T>Enterprise Issue Auto-Analysis & Resolution</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      Connect your ZenTao MCP service, bind products to multiple local code
                      repositories, and dispatch local AI models for unattended root-cause
                      diagnosis, isolated Worktree fixes, and automatic comment write-back.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={!canConfigureConnector}
                    onClick={() => {
                      setEditingConnector(null);
                      setConnectorModalOpen(true);
                    }}
                  >
                    <Plug2Icon className="size-4" />
                    <T>Connect internal ZenTao</T>
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : activeTab === "issues" ? (
            <div
              key="issues"
              className={cn("flex min-h-0 flex-1 flex-col", WORKSPACE_TAB_PANEL_CLASS)}
            >
              {/* Fixed Non-Scrolling Issues Toolbar */}
              <div className="shrink-0 space-y-2.5 border-b border-border/50 bg-background px-5 pt-3.5 pb-2.5 sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  {scannedProfile ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 wrap-anywhere text-sm">{scannedProfile.name}</span>
                      <Button size="xs" variant="ghost" onClick={clearScan}>
                        <XIcon className="size-3" />
                        <T>Clear rule filter</T>
                      </Button>
                    </div>
                  ) : (
                    <div className="min-w-32 max-w-64 flex-1">
                      <PullRequestSearchInput
                        value={keyword}
                        busy={remoteIssuesQuery.isPending && keyword.trim().length > 0}
                        label={gt("Search issues")}
                        placeholder={gt("Search bug ID, title, or module…")}
                        onChange={(next) => {
                          setKeyword(next);
                          setPage(1);
                        }}
                        onSubmit={(next) => {
                          setKeyword(next);
                          setPage(1);
                        }}
                      />
                    </div>
                  )}

                  {snapshot.connectors.length > 1 ? (
                    <Menu>
                      <MenuTrigger
                        aria-label={gt("Select platform connection")}
                        render={<Button variant="outline" />}
                      >
                        <Plug2Icon className="size-3.5" />
                        <span className="max-w-36 truncate">{activeConnector?.name}</span>
                        <ChevronDownIcon className="size-3.5 opacity-70" />
                      </MenuTrigger>
                      <MenuPopup align="start">
                        <div
                          className="overflow-y-auto overscroll-contain"
                          style={SELECTOR_SCROLL_LIST_STYLE}
                        >
                          <MenuRadioGroup
                            value={activeConnector?.id ?? ""}
                            onValueChange={(next) => {
                              if (next) handleSelectConnector(next);
                            }}
                          >
                            {snapshot.connectors.map((c) => (
                              <MenuRadioItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-2">
                                  <span className="truncate">{c.name}</span>
                                  <MenuRadioItemIndicator />
                                </span>
                              </MenuRadioItem>
                            ))}
                          </MenuRadioGroup>
                        </div>
                      </MenuPopup>
                    </Menu>
                  ) : null}

                  <SearchableScopeMenu
                    scopes={sortedConnectorScopes}
                    value={effectiveScopeId}
                    onChange={handleSelectScope}
                    ariaLabel={gt("Select ZenTao product")}
                    className="max-w-60"
                  />

                  {scannedProfile === null && (
                    <Menu>
                      <MenuTrigger
                        aria-label={gt("Filter issues")}
                        render={<Button variant="outline" />}
                      >
                        {browseType === "assigntome" || browseType === "openedbyme" ? (
                          <UserRoundIcon className="size-3.5 text-muted-foreground" />
                        ) : browseType === "all" ? (
                          <LayersIcon className="size-3.5 text-muted-foreground" />
                        ) : (
                          <CircleDotIcon className="size-3.5 text-muted-foreground" />
                        )}
                        <span>{browseFilterLabel(browseType)}</span>
                        <ChevronDownIcon className="size-3.5 opacity-70" />
                      </MenuTrigger>
                      <MenuPopup align="start">
                        <MenuRadioGroup
                          value={browseType}
                          onValueChange={(next) => {
                            if (next) handleSelectBrowseType(next as IssueAutomationBrowseFilter);
                          }}
                        >
                          {(
                            ["unresolved", "unclosed", "assigntome", "openedbyme", "all"] as const
                          ).map((opt) => (
                            <MenuRadioItem key={opt} value={opt} closeOnClick>
                              <span className="flex items-center gap-2">
                                <span className="flex-1">{browseFilterLabel(opt)}</span>
                                <MenuRadioItemIndicator />
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuPopup>
                    </Menu>
                  )}

                  {envProjects.length > 0 ? (
                    <SearchableProjectMenu
                      projects={envProjects}
                      value={resolvedProjectId}
                      onChange={handleSelectProject}
                      ariaLabel={gt("Default target repository")}
                      size="default"
                      triggerVariant="outline"
                      leadingIcon={
                        <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      }
                      className={cn(
                        "min-w-0",
                        desktopInspectorVisible
                          ? "hidden w-36 xl:inline-flex"
                          : "hidden w-44 lg:inline-flex",
                      )}
                    />
                  ) : null}

                  {environmentId && catalog.pickableEntries.length > 0 ? (
                    <OfficialModelPicker
                      diagnosisOnly={diagnosisOnly}
                      environmentId={environmentId}
                      value={resolvedModelSelection}
                      onChange={(next) => {
                        if (next) handleSelectModel(next);
                      }}
                      ariaLabel={gt("Default AI model")}
                      size="sm"
                      popupSide="bottom"
                      popupAlign="end"
                      triggerClassName={cn(
                        "h-8 min-w-0 text-left",
                        desktopInspectorVisible
                          ? "hidden w-36 2xl:inline-flex"
                          : "hidden w-40 xl:inline-flex",
                      )}
                    />
                  ) : null}

                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={gt("Refresh issues")}
                    disabled={remoteIssuesQuery.isPending}
                    onClick={remoteIssuesQuery.refresh}
                  >
                    <RefreshIcon size="md" refreshing={remoteIssuesQuery.isPending} />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      checked={allVisibleChecked}
                      aria-label={gt("Select all issues on this page")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCheckedIssueKeys(issues.map((i) => i.key));
                        } else {
                          setCheckedIssueKeys([]);
                        }
                      }}
                    />
                    <span>
                      <strong className="font-medium text-foreground">{effectiveScopeName}</strong>{" "}
                      {scannedProfile ? (
                        <>
                          {" "}
                          · {gt("Matches on this page")} {issues.length}
                        </>
                      ) : (
                        <>
                          {" "}
                          · <T>Total</T> {issuePage && "total" in issuePage ? issuePage.total : 0}
                        </>
                      )}
                    </span>
                    {matchedScopeProfile ? (
                      <Badge variant="secondary" size="sm">
                        {matchedScopeProfile.enabled ? (
                          <T>Unattended polling active</T>
                        ) : (
                          <T>Rule paused</T>
                        )}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={gt("Previous page")}
                      disabled={page <= 1 || remoteIssuesQuery.isPending}
                      onClick={() => changeIssuePage(page - 1)}
                    >
                      <ChevronLeftIcon className="size-3.5" />
                    </Button>
                    <span className="px-1.5 font-mono tabular-nums">
                      <T>Page</T> {page}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={gt("Next page")}
                      disabled={!hasNextIssuesPage || remoteIssuesQuery.isPending}
                      onClick={() => changeIssuePage(page + 1)}
                    >
                      <ChevronRightIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Independent Scrollable Issue Rows */}
              <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-24 sm:px-7">
                {remoteIssuesQuery.isPending && issues.length === 0 ? (
                  <PullRequestListGhost rows={6} />
                ) : remoteIssuesQuery.error !== null && issues.length === 0 ? (
                  <div className="pt-3">
                    <Alert variant="error">
                      <AlertTitle>{gt("Could not load issues from ZenTao")}</AlertTitle>
                      <AlertDescription>{remoteIssuesQuery.error}</AlertDescription>
                      {activeConnector ? (
                        <AlertAction>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              setEditingConnector(activeConnector);
                              setConnectorModalOpen(true);
                            }}
                          >
                            <PencilIcon className="size-3.5" />
                            <T>Edit connection</T>
                          </Button>
                        </AlertAction>
                      ) : null}
                    </Alert>
                  </div>
                ) : issues.length === 0 ? (
                  <Empty size="compact" className="my-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CircleDotIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        <T>No matching issues</T>
                      </EmptyTitle>
                      <EmptyDescription>
                        {scannedProfile ? (
                          <T>
                            Check the rule filters or clear the rule filter to see other issues.
                          </T>
                        ) : (
                          <T>Try switching the product or status filter above.</T>
                        )}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {issues.map((issue) => {
                      const checked = checkedIssueKeys.includes(issue.key);
                      const selected = inspectorActive && selectedIssueKey === issue.key;
                      return (
                        <div
                          key={issue.key}
                          className={cn(
                            "group/issue-row flex items-center gap-2 rounded-md px-3 py-1 transition-colors",
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            aria-label={gt("Select {issue}", { issue: issue.displayKey })}
                            onCheckedChange={(next) =>
                              setCheckedIssueKeys((prev) =>
                                next ? [...prev, issue.key] : prev.filter((k) => k !== issue.key),
                              )
                            }
                          />

                          <button
                            type="button"
                            aria-current={selected ? "true" : undefined}
                            onClick={() => selectIssue(issue.key, issue.latestTaskId)}
                            className={cn(PULL_REQUEST_ROW_CLASS, "min-w-0 flex-1 py-2")}
                          >
                            <RemoteIssueStatusGlyph
                              status={issue.status}
                              statusLabel={issue.statusLabel}
                            />
                            <PullRequestRowLines
                              number={
                                <span className={PULL_REQUEST_ROW_NUMBER_CLASS}>
                                  {formatIssueNumber(issue.displayKey, issue.key)}
                                </span>
                              }
                              title={cleanIssueText(issue.title)}
                              signals={
                                <>
                                  <SeverityIndicator severity={issue.severity} />
                                  {issue.latestStage ? (
                                    <StageBadge stage={issue.latestStage} />
                                  ) : null}
                                </>
                              }
                              meta={
                                <PullRequestMetaLine className="min-w-0 truncate">
                                  <span>{issue.statusLabel}</span>
                                  {issue.moduleName ? (
                                    <span className="truncate">
                                      {cleanIssueText(issue.moduleName)}
                                    </span>
                                  ) : null}
                                  {issue.assignee ? (
                                    <span className="truncate">{issue.assignee}</span>
                                  ) : null}
                                  <span className="font-mono tabular-nums">{issue.updatedAt}</span>
                                </PullRequestMetaLine>
                              }
                            />
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            {issue.latestTaskId ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedIssueKey(issue.key);
                                  setSelectedTaskId(issue.latestTaskId);
                                  setInspectorTab("trace");
                                  setInspectorOpen(true);
                                }}
                              >
                                <T>Trace</T>
                              </Button>
                            ) : null}
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={dispatching}
                              onClick={() => void handleDispatchIssues([issue.key])}
                            >
                              <PlayIcon className="size-3" />
                              <T>Diagnose</T>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "runs" ? (
            <div
              key="runs"
              className={cn("flex min-h-0 flex-1 flex-col", WORKSPACE_TAB_PANEL_CLASS)}
            >
              {/* Fixed Non-Scrolling Runs Toolbar + Compact Telemetry Strip */}
              <div className="shrink-0 space-y-2.5 border-b border-border/50 bg-background px-5 pt-3.5 pb-3 sm:px-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    variant="segmented"
                    size="segmented"
                    value={[runFilter]}
                    onValueChange={(next) => {
                      const picked = next[0] as RunStatusFilter | undefined;
                      if (picked) handleSelectRunFilter(picked);
                    }}
                  >
                    <Toggle value="all">
                      <span className="inline-flex items-center gap-1.5">
                        <LayersIcon />
                        <T>All</T>
                        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                          {groupCounts.all}
                        </span>
                      </span>
                    </Toggle>
                    <Toggle value="active">
                      <span className="inline-flex items-center gap-1.5">
                        <ActivityIcon />
                        <T>Running</T>
                        {groupCounts.active > 0 ? (
                          <span className="font-mono text-2xs text-info tabular-nums">
                            {groupCounts.active}
                          </span>
                        ) : null}
                      </span>
                    </Toggle>
                    <Toggle value="needs_human">
                      <span className="inline-flex items-center gap-1.5">
                        <CircleAlertIcon />
                        <T>Needs review</T>
                        {groupCounts.needs_human > 0 ? (
                          <span className="font-mono text-2xs text-warning tabular-nums">
                            {groupCounts.needs_human}
                          </span>
                        ) : null}
                      </span>
                    </Toggle>
                    <Toggle value="completed">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2Icon />
                        <T>Completed</T>
                        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                          {groupCounts.completed}
                        </span>
                      </span>
                    </Toggle>
                    <Toggle value="failed">
                      <span className="inline-flex items-center gap-1.5">
                        <XCircleIcon />
                        <T>Failed</T>
                        {groupCounts.failed > 0 ? (
                          <span className="font-mono text-2xs text-destructive tabular-nums">
                            {groupCounts.failed}
                          </span>
                        ) : null}
                      </span>
                    </Toggle>
                  </ToggleGroup>

                  <div className="min-w-52 flex-1 sm:max-w-sm">
                    <PullRequestSearchInput
                      value={runQuery}
                      label={gt("Search automation runs")}
                      placeholder={gt("Filter runs by bug, title, or model…")}
                      onChange={setRunQuery}
                      onSubmit={setRunQuery}
                    />
                  </div>
                </div>

                {allRunsQuickSummary.totalRunsCount > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                      <span>
                        <T>Covered</T>:{" "}
                        <strong className="font-mono text-foreground">
                          {allRunsQuickSummary.uniqueIssuesCount}
                        </strong>
                      </span>
                      <span>
                        <T>Success rate</T>:{" "}
                        <strong className="font-mono text-success">
                          {allRunsQuickSummary.successRate !== null
                            ? `${allRunsQuickSummary.successRate.toFixed(1)}%`
                            : "-"}
                        </strong>
                      </span>
                      <span>
                        <T>Completion</T>:{" "}
                        <strong className="font-mono text-foreground">
                          {allRunsQuickSummary.completionRate !== null
                            ? `${allRunsQuickSummary.completionRate.toFixed(1)}%`
                            : "-"}
                        </strong>
                      </span>
                      <span>
                        <T>Avg time</T>:{" "}
                        <strong className="font-mono text-foreground">
                          {formatCompactDuration(allRunsQuickSummary.avgDurationMs)}
                        </strong>
                      </span>
                      <span>
                        <T>Saved</T>:{" "}
                        <strong className="font-mono text-primary">
                          ≈ {allRunsQuickSummary.estimatedHoursSaved.toFixed(1)}h
                        </strong>
                      </span>
                    </div>

                    <Button size="xs" variant="ghost" onClick={() => setActiveTab("analytics")}>
                      <BarChart3Icon className="size-3.5 text-primary" />
                      <T>Full analytics</T>
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Independent Scrollable Run Rows */}
              <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-16 sm:px-7">
                {filteredGroups.length === 0 ? (
                  <Empty size="compact" className="my-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BotIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        <T>No automation runs</T>
                      </EmptyTitle>
                      <EmptyDescription>
                        <T>
                          Select any issue in the Issues view to start diagnosis, or enable an
                          unattended polling rule.
                        </T>
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {filteredGroups.map(({ key, latest: task, attempts }) => {
                      const selected = inspectorActive && activeTask?.id === task.id;
                      const repoTitle =
                        envProjects.find((p) => p.id === task.targetProjectId)?.title ?? null;
                      const hasHistory = attempts.length > 1;
                      const canCancel =
                        isStageActive(task.stage) &&
                        (task.stage !== "cancelling" || task.lastError !== null);
                      return (
                        <Collapsible key={key}>
                          <div
                            className={cn(
                              "flex items-center gap-2 rounded-md px-3 py-1 transition-colors",
                              selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                            )}
                          >
                            <button
                              type="button"
                              aria-current={selected ? "true" : undefined}
                              onClick={() => selectRun(task)}
                              className={cn(PULL_REQUEST_ROW_CLASS, "min-w-0 flex-1 py-2")}
                            >
                              <TaskStageGlyph stage={task.stage} />
                              <PullRequestRowLines
                                number={
                                  <span className={PULL_REQUEST_ROW_NUMBER_CLASS}>
                                    {formatIssueNumber(task.displayKey, task.issueKey)}
                                  </span>
                                }
                                title={cleanIssueText(task.issueTitle)}
                                signals={
                                  <>
                                    <SeverityIndicator severity={task.severity} />
                                    <StageBadge stage={task.stage} task={task} />
                                    {task.commentSyncedAt ? (
                                      <Badge variant="outline" size="sm">
                                        <T>Synced</T>
                                      </Badge>
                                    ) : null}
                                  </>
                                }
                                meta={
                                  <PullRequestMetaLine className="min-w-0 truncate">
                                    <span className="truncate">{task.scopeName}</span>
                                    {repoTitle ? (
                                      <span className="inline-flex shrink-0 items-center gap-1">
                                        <FolderGit2Icon className="size-3" />
                                        {repoTitle}
                                      </span>
                                    ) : null}
                                    <span className="truncate font-mono">
                                      {task.assignedModelLabel}
                                    </span>
                                    {task.worktreeBranch ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 font-mono">
                                        <GitBranchIcon className="size-3" />
                                        {task.worktreeBranch}
                                      </span>
                                    ) : null}
                                  </PullRequestMetaLine>
                                }
                              />
                            </button>

                            <div className="flex shrink-0 items-center gap-3 pl-2">
                              {hasHistory ? (
                                <CollapsibleTrigger
                                  render={<Button variant="ghost-muted" size="xs" />}
                                >
                                  <ChevronDownIcon className="size-3.5" />
                                  {gt("Execution history · {count} runs", {
                                    count: attempts.length,
                                  })}
                                </CollapsibleTrigger>
                              ) : null}
                              <div className="flex min-w-16 items-center justify-end">
                                <TaskDurationBadge task={task} environmentId={environmentId} />
                              </div>
                              <span className="hidden w-16 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums sm:inline-block">
                                <RelativeTime timestamp={task.updatedAt} />
                              </span>
                              <div className="flex w-22 shrink-0 items-center justify-end">
                                {task.repairOfTaskId !== undefined ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => selectRun(task)}
                                  >
                                    {task.stage === "needs_human" ? (
                                      <T>Review repair</T>
                                    ) : isStageActive(task.stage) ? (
                                      <T>View progress</T>
                                    ) : (
                                      <T>View repair</T>
                                    )}
                                  </Button>
                                ) : canCancel && environmentId ? (
                                  <Button
                                    size="xs"
                                    variant="ghost-destructive"
                                    className="shrink-0"
                                    onClick={() => void handleCancelTask(task.id)}
                                  >
                                    <XIcon className="size-3.5" />
                                    {task.stage === "cancelling" ? (
                                      <T>Retry cancellation</T>
                                    ) : (
                                      <T>Cancel</T>
                                    )}
                                  </Button>
                                ) : supportsRetry &&
                                  task.stage === "cancelled" &&
                                  task.actionMode === "diagnose_only" ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    className="shrink-0"
                                    disabled={dispatching}
                                    onClick={() => void handleRunFromTask(task, "retry")}
                                  >
                                    <PlayIcon className="size-3.5" />
                                    <T>Run diagnosis again</T>
                                  </Button>
                                ) : task.stage === "completed" &&
                                  task.actionMode === "diagnose_only" &&
                                  task.diagnosisReport ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => selectRun(task)}
                                  >
                                    <T>View diagnosis</T>
                                  </Button>
                                ) : task.primaryThreadId ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    className="shrink-0"
                                    onClick={() => openThread(task.primaryThreadId!)}
                                  >
                                    <MessageSquareIcon className="size-3.5" />
                                    <T>Open Thread</T>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {hasHistory ? (
                            <CollapsiblePanel animate={false}>
                              <div className="my-1 ms-5 flex flex-col gap-1 border-s border-border/60 ps-3">
                                {attempts.map((attempt, index) => (
                                  <div
                                    key={attempt.id}
                                    className="flex flex-wrap items-center gap-2 py-1 pe-3 text-xs"
                                  >
                                    <span className="text-muted-foreground">
                                      {gt("Run {number}", { number: attempts.length - index })}
                                    </span>
                                    <StageBadge stage={attempt.stage} task={attempt} />
                                    <RelativeTime timestamp={attempt.createdAt} />
                                    <Button
                                      size="xs"
                                      variant="ghost-muted"
                                      onClick={() => selectRun(attempt)}
                                    >
                                      {attempt.diagnosisReport !== null ? (
                                        <T>View result</T>
                                      ) : (
                                        <T>View logs</T>
                                      )}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </CollapsiblePanel>
                          ) : null}
                        </Collapsible>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "analytics" ? (
            <div
              key="analytics"
              className={cn("flex min-h-0 flex-1 flex-col", WORKSPACE_TAB_PANEL_CLASS)}
            >
              {/* Fixed Non-Scrolling Analytics Filter Bar */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-background px-5 py-3 sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleGroup
                    variant="segmented"
                    size="segmented"
                    value={[analyticsScopeMode]}
                    onValueChange={(next) => {
                      const picked = next[0] as AnalyticsScopeMode | undefined;
                      if (picked) handleSelectAnalyticsScopeMode(picked);
                    }}
                  >
                    <Toggle value="all">
                      <LayersIcon />
                      <T>All products</T>
                    </Toggle>
                    <Toggle value="current">
                      <FolderGit2Icon />
                      <span className="max-w-52 truncate">
                        {effectiveScopeName
                          ? `#${effectiveScopeId} · ${effectiveScopeName}`
                          : gt("Current product")}
                      </span>
                    </Toggle>
                  </ToggleGroup>

                  {analyticsScopeMode === "current" ? (
                    <SearchableScopeMenu
                      scopes={sortedConnectorScopes}
                      value={effectiveScopeId}
                      onChange={handleSelectScope}
                      ariaLabel={gt("Switch product for analytics")}
                      className="max-w-56"
                    />
                  ) : null}
                </div>

                <ToggleGroup
                  variant="segmented"
                  size="segmented"
                  value={[analyticsRange]}
                  onValueChange={(next) => {
                    const picked = next[0] as AnalyticsTimeRange | undefined;
                    if (picked) handleSelectAnalyticsRange(picked);
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

              <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-7">
                <IssueAutomationAnalyticsView
                  summary={analyticsSummary}
                  onJumpToRuns={(targetFilter) => {
                    setPrefs((prev) => ({
                      ...prev,
                      activeTab: "runs",
                      runFilter: targetFilter,
                    }));
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              key="rules"
              className={cn(
                "topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-24 sm:px-7",
                WORKSPACE_TAB_PANEL_CLASS,
              )}
            >
              <IssueAutomationRulesView
                environmentId={environmentId}
                canConfigureConnector={canConfigureConnector}
                platforms={snapshot.platforms}
                connectors={snapshot.connectors}
                profiles={snapshot.profiles}
                projects={envProjects}
                onAddConnector={() => {
                  setEditingConnector(null);
                  setConnectorModalOpen(true);
                }}
                onEditConnector={(conn) => {
                  setEditingConnector(conn);
                  setConnectorModalOpen(true);
                }}
                onRefreshScopes={(connectorId) => {
                  if (!environmentId) return;
                  void refreshScopesCmd({ environmentId, input: { connectorId } });
                }}
                onDeleteConnector={(connectorId) => {
                  if (!environmentId) return;
                  void deleteConnectorCmd({ environmentId, input: { connectorId } });
                }}
                onAddProfile={() => {
                  setEditingProfile(null);
                  setProfileModalOpen(true);
                }}
                onEditProfile={(prof) => {
                  setEditingProfile(prof);
                  setProfileModalOpen(true);
                }}
                onToggleProfile={(profileId, enabled) => {
                  if (!environmentId) return;
                  void setProfileEnabledCmd({
                    environmentId,
                    input: { profileId, enabled },
                  });
                }}
                onScanProfile={(profile) => void handleScanProfile(profile)}
                scanningProfileId={scanningProfileId}
                onDeleteProfile={(profileId) => {
                  if (!environmentId) return;
                  void deleteProfileCmd({ environmentId, input: { profileId } });
                }}
              />
            </div>
          )}

          {activeTab === "issues" && checkedIssueKeys.length > 0 ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4",
                WORKSPACE_BAR_ENTER_CLASS,
                "starting:translate-y-2",
              )}
            >
              <ComposerSurface.Shell className="pointer-events-auto w-full max-w-3xl">
                <ComposerSurface.Host>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Badge variant="secondary" size="sm">
                        {checkedIssueKeys.length}
                      </Badge>
                      <span>
                        <T>issues selected for batch diagnosis</T>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <SearchableProjectMenu
                        projects={envProjects}
                        value={resolvedProjectId}
                        onChange={handleSelectProject}
                        ariaLabel={gt("Batch target repository")}
                        size="compact"
                        className="w-36 min-w-0"
                      />

                      {environmentId ? (
                        <OfficialModelPicker
                          diagnosisOnly={diagnosisOnly}
                          environmentId={environmentId}
                          value={resolvedModelSelection}
                          onChange={(next) => {
                            if (next) handleSelectModel(next);
                          }}
                          ariaLabel={gt("Batch AI model")}
                          size="xs"
                          popupSide="top"
                          triggerClassName="w-40 min-w-0"
                        />
                      ) : null}

                      <Select
                        value={resolvedActionMode}
                        onValueChange={(next) => {
                          if (next) handleSelectActionMode(next as IssueAutomationActionMode);
                        }}
                      >
                        <SelectTrigger
                          size="compact"
                          className="w-40 min-w-0"
                          aria-label={gt("Batch execution mode")}
                        >
                          <SelectValue>{actionModeLabel(resolvedActionMode)}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="fix_worktree_review">
                            {actionModeLabel("fix_worktree_review")}
                          </SelectItem>
                          <SelectItem value="diagnose_only">
                            {actionModeLabel("diagnose_only")}
                          </SelectItem>
                          <SelectItem value="auto_resolve">
                            {actionModeLabel("auto_resolve")}
                          </SelectItem>
                        </SelectPopup>
                      </Select>

                      <Button
                        size="xs"
                        disabled={dispatching}
                        onClick={() => void handleDispatchIssues(checkedIssueKeys)}
                      >
                        {dispatching ? <Spinner size="xs" /> : <PlayIcon className="size-3" />}
                        <T>Run batch</T>
                      </Button>

                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={gt("Clear selection")}
                        onClick={() => setCheckedIssueKeys([])}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </ComposerSurface.Host>
              </ComposerSurface.Shell>
            </div>
          ) : null}
        </div>

        <WorkspaceInspectorDrawer
          open={desktopInspectorVisible}
          scopeKey={environmentId}
          width={inspectorWidth}
          isResizing={isDraggingInspector}
          resizeLabel={gt("Resize detail inspector")}
          onResizePointerDown={startResizeInspector}
          onResizeKeyDown={handleInspectorSplitterKeyDown}
          onResizeDoubleClick={() =>
            setPrefs((prev) => ({
              ...prev,
              inspectorWidth: DEFAULT_WORKBENCH_PREFS.inspectorWidth,
            }))
          }
        >
          {inspectorBody}
        </WorkspaceInspectorDrawer>

        {!isWideDesktop && inspectorActive ? (
          <Sheet open={inspectorActive} onOpenChange={setInspectorOpen}>
            <SheetPopup side="right" showCloseButton={false} className="max-w-xl">
              {inspectorBody}
            </SheetPopup>
          </Sheet>
        ) : null}
      </div>

      {environmentId && connectorModalOpen ? (
        <ConnectorModal
          key={editingConnector?.id ?? "new"}
          open={connectorModalOpen}
          onOpenChange={setConnectorModalOpen}
          environmentId={environmentId}
          platforms={snapshot.platforms}
          initial={editingConnector}
          onSaved={(saved) => {
            if (!editingConnector) {
              handleSelectConnector(saved.id);
            } else if (saved.id === activeConnector?.id) {
              remoteIssuesQuery.refresh();
              remoteDetailQuery.refresh();
            }
          }}
        />
      ) : null}

      {environmentId && profileModalOpen ? (
        <ProfileModal
          open={profileModalOpen}
          onOpenChange={setProfileModalOpen}
          environmentId={environmentId}
          connectors={snapshot.connectors}
          projects={envProjects}
          initial={editingProfile}
          defaultConnectorId={activeConnector?.id}
          defaultScopeId={effectiveScopeId}
        />
      ) : null}
    </SidebarInset>
  );
}
