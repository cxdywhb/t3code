import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueAutomationActionMode,
  IssueAutomationBrowseFilter,
  IssueAutomationConnector,
  IssueAutomationProfile,
  IssueAutomationTask,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import {
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayersIcon,
  MessageSquareIcon,
  PanelRightIcon,
  PlayIcon,
  Plug2Icon,
  PlusIcon,
  Settings2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { ComposerSurface } from "~/components/chat/ComposerSurface";
import { PullRequestSearchInput } from "~/components/pullRequest/PullRequestListFilters";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowLines,
} from "~/components/pullRequest/PullRequestListRow";
import { PullRequestMetaLine } from "~/components/pullRequest/pullRequestPresentation";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerVisible,
} from "~/providerInstances";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { issueAutomationEnvironment, useIssueAutomationLiveState } from "~/state/issueAutomation";
import { useEnvironmentQuery } from "~/state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ConnectorModal,
  CreatePlatformIssueModal,
  decodeModelOptionKey,
  encodeModelOptionKey,
  ProfileModal,
  SearchableModelMenu,
  SearchableProjectMenu,
  SearchableScopeMenu,
  SELECTOR_SCROLL_LIST_STYLE,
  type SelectableModelOption,
  type SelectableProjectOption,
} from "./IssueAutomationConfigModals";
import {
  IssueAutomationInspectorContent,
  type InspectorSubTab,
  type ManualWriteBackPayload,
} from "./IssueAutomationInspector";
import {
  cleanIssueText,
  isStageActive,
  RemoteIssueStatusGlyph,
  SeverityIndicator,
  StageBadge,
  TaskStageGlyph,
  useActionModeLabel,
} from "./issueAutomationPresentation";
import { IssueAutomationRulesView } from "./IssueAutomationRulesView";

type WorkbenchTab = "issues" | "runs" | "rules";
type RunStatusFilter = "all" | "active" | "needs_human" | "completed" | "failed";

const DEFAULT_INSPECTOR_WIDTH = 660;
const MIN_INSPECTOR_WIDTH = 440;
const MAX_INSPECTOR_WIDTH = 960;

export function IssueAutomationPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const actionModeLabel = useActionModeLabel();
  const isWideDesktop = useMediaQuery("(min-width: 1024px)");
  const environmentId = usePrimaryEnvironmentId();
  const { snapshot } = useIssueAutomationLiveState(environmentId);

  const allProjects = useProjects();
  const envProjects: ReadonlyArray<SelectableProjectOption> = allProjects
    .filter((p) => environmentId === null || p.environmentId === environmentId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      workspaceRoot: p.workspaceRoot,
    }));

  const serverConfigResult = useAtomValue(
    environmentId !== null
      ? serverEnvironment.configProjection({ environmentId, input: {} })
      : serverEnvironment.configProjection({
          environmentId: "none" as EnvironmentId,
          input: {},
        }),
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

  const [activeTab, setActiveTab] = useState<WorkbenchTab>("issues");
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>("");
  const activeConnector: IssueAutomationConnector | null =
    snapshot.connectors.find((c) => c.id === selectedConnectorId) ?? snapshot.connectors[0] ?? null;

  const [selectedScopeId, setSelectedScopeId] = useState<string>("");
  const effectiveScopeId = activeConnector?.scopes.some((s) => s.id === selectedScopeId)
    ? selectedScopeId
    : (activeConnector?.scopes[0]?.id ?? "");
  const effectiveScopeName =
    activeConnector?.scopes.find((s) => s.id === effectiveScopeId)?.name ?? effectiveScopeId;

  const [browseType, setBrowseType] = useState<IssueAutomationBrowseFilter>("unclosed");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const [runFilter, setRunFilter] = useState<RunStatusFilter>("all");
  const [runQuery, setRunQuery] = useState("");

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [checkedIssueKeys, setCheckedIssueKeys] = useState<ReadonlyArray<string>>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorSubTab>("detail");
  const [inspectorWidth, setInspectorWidth] = useState<number>(DEFAULT_INSPECTOR_WIDTH);

  const [adhocProjectId, setAdhocProjectId] = useState<string>("");
  const [adhocModelKey, setAdhocModelKey] = useState<string>("");
  const [adhocMode, setAdhocMode] = useState<IssueAutomationActionMode>("fix_worktree_review");

  const [connectorModalOpen, setConnectorModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<IssueAutomationConnector | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<IssueAutomationProfile | null>(null);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  const remoteIssuesQuery = useEnvironmentQuery(
    environmentId !== null && activeConnector !== null && effectiveScopeId.length > 0
      ? issueAutomationEnvironment.remoteIssues({
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

  const remoteDetailQuery = useEnvironmentQuery(
    environmentId !== null &&
      activeConnector !== null &&
      effectiveScopeId.length > 0 &&
      selectedIssueKey !== null &&
      inspectorOpen
      ? issueAutomationEnvironment.remoteIssueDetail({
          environmentId,
          input: {
            connectorId: activeConnector.id,
            scopeId: effectiveScopeId,
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
  const triggerPollCmd = useAtomCommand(issueAutomationEnvironment.triggerPoll, {
    reportFailure: false,
  });

  const [dispatching, setDispatching] = useState(false);
  const [writingBack, setWritingBack] = useState(false);

  const issues = remoteIssuesQuery.data?.issues ?? [];
  const selectedIssueSummary =
    selectedIssueKey !== null ? (issues.find((i) => i.key === selectedIssueKey) ?? null) : null;
  const selectedDetail = remoteDetailQuery.data;

  const activeTask: IssueAutomationTask | null =
    selectedTaskId !== null
      ? (snapshot.tasks.find((t) => t.id === selectedTaskId) ?? null)
      : selectedIssueKey !== null
        ? (snapshot.tasks.find(
            (t) =>
              t.issueKey === selectedIssueKey &&
              (activeConnector === null || t.connectorId === activeConnector.id),
          ) ?? null)
        : null;

  const matchedScopeProfile =
    activeConnector && effectiveScopeId
      ? (snapshot.profiles.find(
          (p) => p.connectorId === activeConnector.id && p.scopeId === effectiveScopeId,
        ) ?? null)
      : null;

  const resolvedProjectId =
    adhocProjectId ||
    matchedScopeProfile?.repositories.primaryProjectId ||
    envProjects[0]?.id ||
    "";
  const resolvedModelKey =
    adhocModelKey ||
    encodeModelOptionKey(
      matchedScopeProfile?.models.primaryModel ?? modelOptions[0]?.selection ?? null,
    );

  const hasSelection = selectedIssueKey !== null || activeTask !== null;
  const inspectorActive =
    inspectorOpen && hasSelection && activeTab !== "rules" && environmentId !== null;
  const desktopInspectorVisible = inspectorActive && isWideDesktop;

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
    if (linkedTaskId) {
      setSelectedTaskId(linkedTaskId);
    } else {
      setSelectedTaskId(null);
    }
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
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const maxAllowed = Math.min(MAX_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.62));
      const next = Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxAllowed, startWidth + delta));
      setInspectorWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleDispatchIssues = async (keysToRun: ReadonlyArray<string>) => {
    if (!environmentId || !activeConnector || !effectiveScopeId || keysToRun.length === 0) return;
    const chosenProjectId =
      (adhocProjectId as ProjectId) ||
      matchedScopeProfile?.repositories.primaryProjectId ||
      envProjects[0]?.id;
    const chosenModel =
      decodeModelOptionKey(adhocModelKey, modelOptions) ??
      matchedScopeProfile?.models.primaryModel ??
      modelOptions[0]?.selection ??
      null;

    if (!chosenProjectId || !chosenModel) {
      toastManager.add({
        type: "error",
        title: gt("Missing repository or model"),
        description: gt("Add at least one local project and an active model provider first."),
      });
      return;
    }

    setDispatching(true);
    const res = await analyzeIssuesCmd({
      environmentId,
      input: {
        connectorId: activeConnector.id,
        scopeId: effectiveScopeId,
        scopeName: effectiveScopeName,
        issueKeys: [...keysToRun],
        ...(matchedScopeProfile ? { profileId: matchedScopeProfile.id } : {}),
        overrideRepositories: matchedScopeProfile?.repositories ?? {
          primaryProjectId: chosenProjectId,
          linkedProjectIds: envProjects.map((p) => p.id),
          moduleMappings: [],
        },
        overrideModels: matchedScopeProfile?.models ?? {
          primaryModel: chosenModel,
          highSeverityModel: null,
          triageModel: null,
          reviewModel: null,
          fallbackModel: null,
        },
        overridePolicy: matchedScopeProfile?.policy ?? {
          actionMode: adhocMode,
          autoWriteComment: true,
          baseBranch: null,
          customPromptInstructions: null,
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

  const handleManualWriteBack = async (action: ManualWriteBackPayload): Promise<boolean> => {
    if (!environmentId || !activeConnector) return false;
    setWritingBack(true);
    const res = await writeBackCmd({
      environmentId,
      input: {
        connectorId: activeConnector.id,
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

  const filteredTasks = snapshot.tasks.filter((task) => {
    if (runFilter === "active" && !isStageActive(task.stage)) return false;
    if (runFilter === "needs_human" && task.stage !== "needs_human") return false;
    if (runFilter === "completed" && task.stage !== "completed") return false;
    if (runFilter === "failed" && task.stage !== "failed" && task.stage !== "cancelled") {
      return false;
    }
    const q = runQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      task.displayKey.toLowerCase().includes(q) ||
      task.issueTitle.toLowerCase().includes(q) ||
      task.assignedModelLabel.toLowerCase().includes(q)
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
        modelOptions={modelOptions}
        matchedProfile={matchedScopeProfile}
        adhocProjectId={adhocProjectId}
        onAdhocProjectIdChange={setAdhocProjectId}
        adhocModelKey={adhocModelKey}
        onAdhocModelKeyChange={setAdhocModelKey}
        adhocMode={adhocMode}
        onAdhocModeChange={setAdhocMode}
        dispatching={dispatching}
        onDispatchIssue={(key) => void handleDispatchIssues([key])}
        writingBack={writingBack}
        onManualWriteBack={handleManualWriteBack}
        onCancelTask={(taskId) => {
          if (!environmentId) return;
          void cancelTaskCmd({ environmentId, input: { taskId } });
        }}
        onOpenThread={openThread}
        onClose={() => setInspectorOpen(false)}
      />
    ) : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            data-chat-header
            electron={isElectron}
            reserveNativeControls={!desktopInspectorVisible}
            className="relative border-b border-border/50 bg-background"
          >
            <WorkspaceBreadcrumb ariaLabel={gt("ZenTao Issue Auto-Analysis")}>
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate font-semibold">
                  <T>ZenTao Issue Auto-Analysis</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>

            {snapshot.connectors.length > 0 ? (
              <div className="hidden items-center [-webkit-app-region:no-drag] sm:flex">
                <ToggleGroup
                  variant="segmented"
                  size="segmented"
                  value={[activeTab]}
                  onValueChange={(next) => {
                    const picked = next[0] as WorkbenchTab | undefined;
                    if (picked) setActiveTab(picked);
                  }}
                >
                  <Toggle value="issues">
                    <T>Issues</T>
                  </Toggle>
                  <Toggle value="runs">
                    <span className="inline-flex items-center gap-1.5">
                      {snapshot.activeRunCount > 0 ? <Spinner size="xs" /> : null}
                      <T>Runs</T>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {snapshot.tasks.length}
                      </span>
                    </span>
                  </Toggle>
                  <Toggle value="rules">
                    <span className="inline-flex items-center gap-1.5">
                      <T>Automation</T>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {snapshot.profiles.length}
                      </span>
                    </span>
                  </Toggle>
                </ToggleGroup>
              </div>
            ) : null}

            <div className="min-w-0 flex-1" />

            <div
              className="flex items-center gap-2 [-webkit-app-region:no-drag]"
              data-workspace-titlebar-controls
            >
              {activeConnector ? (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:inline-flex">
                  <span aria-hidden className="size-2 rounded-full bg-primary" />
                  <span className="max-w-48 truncate">
                    {activeConnector.name} · {activeConnector.viewerName ?? activeConnector.account}
                  </span>
                </span>
              ) : null}

              {activeConnector ? (
                <Button size="xs" variant="outline" onClick={() => setCreateIssueOpen(true)}>
                  <PlusIcon className="size-3.5" />
                  <T>New issue</T>
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setEditingConnector(null);
                    setConnectorModalOpen(true);
                  }}
                >
                  <Plug2Icon className="size-3.5" />
                  <T>Connect ZenTao</T>
                </Button>
              )}

              {activeConnector ? (
                <Button
                  size="xs"
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

              {activeTab !== "rules" ? (
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

          <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full w-full flex-col gap-4 px-5 pt-5 pb-24 sm:px-7">
              {snapshot.connectors.length > 0 ? (
                <div className="flex sm:hidden">
                  <ToggleGroup
                    variant="segmented"
                    size="segmented"
                    value={[activeTab]}
                    onValueChange={(next) => {
                      const picked = next[0] as WorkbenchTab | undefined;
                      if (picked) setActiveTab(picked);
                    }}
                  >
                    <Toggle value="issues">
                      <T>Issues</T>
                    </Toggle>
                    <Toggle value="runs">
                      <T>Runs</T> ({snapshot.tasks.length})
                    </Toggle>
                    <Toggle value="rules">
                      <T>Automation</T> ({snapshot.profiles.length})
                    </Toggle>
                  </ToggleGroup>
                </div>
              ) : null}

              {snapshot.connectors.length === 0 ? (
                <Empty className="my-auto">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BotIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      <T>Enterprise Issue Auto-Analysis & Resolution</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>
                        Connect your internal ZenTao server, bind products to multiple local code
                        repositories, and dispatch local AI models for unattended root-cause
                        diagnosis, isolated Worktree fixes, and automatic comment write-back.
                      </T>
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
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
              ) : activeTab === "issues" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-52 flex-1">
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
                                if (!next) return;
                                setSelectedConnectorId(next);
                                setSelectedIssueKey(null);
                                setPage(1);
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
                      scopes={activeConnector?.scopes ?? []}
                      value={effectiveScopeId}
                      onChange={(next) => {
                        setSelectedScopeId(next);
                        setSelectedIssueKey(null);
                        setCheckedIssueKeys([]);
                        setPage(1);
                      }}
                      ariaLabel={gt("Select ZenTao product")}
                      className="max-w-64"
                    />

                    <Menu>
                      <MenuTrigger
                        aria-label={gt("Filter issues")}
                        render={<Button variant="outline" />}
                      >
                        {browseType === "assigntome" || browseType === "openedbyme" ? (
                          <UserRoundIcon className="size-3.5" />
                        ) : browseType === "all" ? (
                          <LayersIcon className="size-3.5" />
                        ) : (
                          <CircleDotIcon className="size-3.5" />
                        )}
                        <span>{browseFilterLabel(browseType)}</span>
                        <ChevronDownIcon className="size-3.5 opacity-70" />
                      </MenuTrigger>
                      <MenuPopup align="start">
                        <MenuRadioGroup
                          value={browseType}
                          onValueChange={(next) => {
                            if (!next) return;
                            setBrowseType(next as IssueAutomationBrowseFilter);
                            setPage(1);
                          }}
                        >
                          {(["unclosed", "assigntome", "openedbyme", "all"] as const).map((opt) => (
                            <MenuRadioItem key={opt} value={opt}>
                              <span className="flex items-center gap-2">
                                <span className="flex-1">{browseFilterLabel(opt)}</span>
                                <MenuRadioItemIndicator />
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuPopup>
                    </Menu>

                    {!desktopInspectorVisible && envProjects.length > 0 ? (
                      <SearchableProjectMenu
                        projects={envProjects}
                        value={resolvedProjectId}
                        onChange={setAdhocProjectId}
                        ariaLabel={gt("Default target repository")}
                        size="default"
                        leadingIcon={
                          <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        }
                        className="hidden w-44 min-w-0 xl:inline-flex"
                      />
                    ) : null}

                    {!desktopInspectorVisible && modelOptions.length > 0 ? (
                      <SearchableModelMenu
                        options={modelOptions}
                        value={resolvedModelKey}
                        onChange={setAdhocModelKey}
                        ariaLabel={gt("Default AI model")}
                        size="default"
                        leadingIcon={
                          <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        }
                        className="hidden w-48 min-w-0 2xl:inline-flex"
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

                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 text-xs text-muted-foreground">
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
                        <strong className="font-medium text-foreground">
                          {effectiveScopeName}
                        </strong>{" "}
                        · <T>Total</T> {remoteIssuesQuery.data?.total ?? 0}
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
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                        disabled={issues.length < 25 || remoteIssuesQuery.isPending}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRightIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {remoteIssuesQuery.isPending && issues.length === 0 ? (
                    <div className="space-y-2 px-2 pt-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : remoteIssuesQuery.error !== null && issues.length === 0 ? (
                    <Alert variant="error">
                      <AlertTitle>{gt("Could not load issues from ZenTao")}</AlertTitle>
                      <AlertDescription>{remoteIssuesQuery.error}</AlertDescription>
                    </Alert>
                  ) : issues.length === 0 ? (
                    <Empty size="compact">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <CircleDotIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                          <T>No matching issues</T>
                        </EmptyTitle>
                        <EmptyDescription>
                          <T>Try switching the product or status filter above.</T>
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
                                    {issue.displayKey}
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
                                    <span className="font-mono tabular-nums">
                                      {issue.updatedAt}
                                    </span>
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
                </>
              ) : activeTab === "runs" ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ToggleGroup
                      variant="segmented"
                      size="segmented"
                      value={[runFilter]}
                      onValueChange={(next) => {
                        const picked = next[0] as RunStatusFilter | undefined;
                        if (picked) setRunFilter(picked);
                      }}
                    >
                      <Toggle value="all">
                        <T>All</T>
                      </Toggle>
                      <Toggle value="active">
                        <T>Running</T>
                      </Toggle>
                      <Toggle value="needs_human">
                        <T>Needs review</T>
                      </Toggle>
                      <Toggle value="completed">
                        <T>Completed</T>
                      </Toggle>
                      <Toggle value="failed">
                        <T>Failed</T>
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

                  {filteredTasks.length === 0 ? (
                    <Empty size="compact">
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
                      {filteredTasks.map((task) => {
                        const selected = inspectorActive && activeTask?.id === task.id;
                        const repoTitle =
                          envProjects.find((p) => p.id === task.targetProjectId)?.title ?? null;
                        return (
                          <div
                            key={task.id}
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
                                    {task.displayKey}
                                  </span>
                                }
                                title={cleanIssueText(task.issueTitle)}
                                signals={
                                  <>
                                    <StageBadge stage={task.stage} />
                                    {task.commentSyncedAt ? (
                                      <Badge variant="outline" size="sm">
                                        <T>Synced</T>
                                      </Badge>
                                    ) : null}
                                  </>
                                }
                                meta={
                                  <PullRequestMetaLine className="min-w-0 truncate">
                                    <span>{task.scopeName}</span>
                                    {repoTitle ? (
                                      <span className="inline-flex items-center gap-1">
                                        <FolderGit2Icon className="size-3" />
                                        {repoTitle}
                                      </span>
                                    ) : null}
                                    <span className="font-mono">{task.assignedModelLabel}</span>
                                    {task.worktreeBranch ? (
                                      <span className="inline-flex items-center gap-1 font-mono">
                                        <GitBranchIcon className="size-3" />
                                        {task.worktreeBranch}
                                      </span>
                                    ) : null}
                                  </PullRequestMetaLine>
                                }
                                updatedAt={task.updatedAt}
                              />
                            </button>

                            {task.primaryThreadId ? (
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
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <IssueAutomationRulesView
                  environmentId={environmentId}
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
                  onTriggerPoll={(profileId) => {
                    if (!environmentId) return;
                    void triggerPollCmd({ environmentId, input: { profileId } }).then((r) => {
                      if (r._tag === "Success") {
                        toastManager.add({
                          type: "success",
                          title: gt("Poll completed"),
                          description: `${String(r.value.enqueuedCount)} enqueued`,
                        });
                      }
                    });
                  }}
                  onDeleteProfile={(profileId) => {
                    if (!environmentId) return;
                    void deleteProfileCmd({ environmentId, input: { profileId } });
                  }}
                />
              )}
            </div>
          </div>

          {activeTab === "issues" && checkedIssueKeys.length > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
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
                        onChange={setAdhocProjectId}
                        ariaLabel={gt("Batch target repository")}
                        size="compact"
                        className="w-36 min-w-0"
                      />

                      <SearchableModelMenu
                        options={modelOptions}
                        value={resolvedModelKey}
                        onChange={setAdhocModelKey}
                        ariaLabel={gt("Batch AI model")}
                        size="compact"
                        className="w-40 min-w-0"
                      />

                      <Select
                        value={adhocMode}
                        onValueChange={(next) => {
                          if (next) setAdhocMode(next as IssueAutomationActionMode);
                        }}
                      >
                        <SelectTrigger
                          size="compact"
                          className="w-40 min-w-0"
                          aria-label={gt("Batch execution mode")}
                        >
                          <SelectValue>{actionModeLabel(adhocMode)}</SelectValue>
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

        {desktopInspectorVisible ? (
          <aside
            className="relative hidden h-full min-h-0 shrink-0 border-l border-border bg-background lg:flex"
            style={{ width: `${String(inspectorWidth)}px` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={gt("Resize detail inspector")}
              onPointerDown={startResizeInspector}
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize transition-colors hover:bg-ring/30"
            />
            {inspectorBody}
          </aside>
        ) : null}

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
          open={connectorModalOpen}
          onOpenChange={setConnectorModalOpen}
          environmentId={environmentId}
          platforms={snapshot.platforms}
          initial={editingConnector}
        />
      ) : null}

      {environmentId && profileModalOpen ? (
        <ProfileModal
          open={profileModalOpen}
          onOpenChange={setProfileModalOpen}
          environmentId={environmentId}
          connectors={snapshot.connectors}
          projects={envProjects}
          modelOptions={modelOptions}
          initial={editingProfile}
          defaultConnectorId={activeConnector?.id}
          defaultScopeId={effectiveScopeId}
        />
      ) : null}

      {environmentId && activeConnector && createIssueOpen ? (
        <CreatePlatformIssueModal
          open={createIssueOpen}
          onOpenChange={setCreateIssueOpen}
          environmentId={environmentId}
          connector={activeConnector}
          defaultScopeId={effectiveScopeId}
        />
      ) : null}
    </SidebarInset>
  );
}
