import { WORKSPACE_TAB_PANEL_CLASS } from "~/components/WorkspacePageHeader";
import type {
  EnvironmentId,
  IssueAutomationActionMode,
  IssueAutomationConnector,
  IssueAutomationProfile,
  IssueAutomationRemoteIssue,
  IssueAutomationRemoteIssueDetail,
  IssueAutomationSyncRepairAction,
  IssueAutomationTask,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  ArrowUpIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayersIcon,
  MessageSquareIcon,
  PlayIcon,
  PencilIcon,
  SendIcon,
  ShieldAlertIcon,
  UsersIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { ComposerSurface } from "~/components/chat/ComposerSurface";
import { OfficialModelPicker } from "~/components/chat/OfficialModelPicker";
import { PullRequestDetailTitleRow } from "~/components/pullRequest/PullRequestDetailLayout";
import { PullRequestMarkdown } from "~/components/pullRequest/PullRequestMarkdown";
import { PullRequestMetaLine } from "~/components/pullRequest/pullRequestPresentation";
import {
  PullRequestMetaRow,
  PullRequestSection,
} from "~/components/pullRequest/PullRequestSummaryTab";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  SearchableProjectMenu,
  SELECTOR_SCROLL_LIST_STYLE,
  type SelectableProjectOption,
} from "./IssueAutomationConfigModals";
import { IssueAutomationRepairSyncDialog } from "./IssueAutomationRepairSyncDialog";
import {
  cleanIssueText,
  formatIssueNumber,
  isStageActive,
  RemoteIssueStatusGlyph,
  SeverityIndicator,
  StageBadge,
  stageStepIndex,
  TaskStageGlyph,
  useActionModeLabel,
} from "./issueAutomationPresentation";

export type InspectorSubTab = "detail" | "trace";

export type ManualWriteBackPayload =
  | IssueAutomationSyncRepairAction
  | { kind: "comment"; issueKey: string; comment: string; taskId?: IssueAutomationTask["id"] }
  | { kind: "confirm"; issueKey: string; comment?: string; taskId?: IssueAutomationTask["id"] }
  | {
      kind: "resolve";
      issueKey: string;
      resolution: "fixed";
      resolvedBuild: string;
      comment?: string;
      taskId?: IssueAutomationTask["id"];
    }
  | { kind: "activate"; issueKey: string; comment?: string; taskId?: IssueAutomationTask["id"] }
  | { kind: "close"; issueKey: string; comment?: string; taskId?: IssueAutomationTask["id"] };

function ResolveBuildSubmenu({
  builds,
  onSelectBuild,
}: {
  readonly builds: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onSelectBuild: (buildId: string) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = builds.filter(
    (b) =>
      needle.length === 0 ||
      b.name.toLowerCase().includes(needle) ||
      b.id.toLowerCase().includes(needle),
  );

  return (
    <MenuSub>
      <MenuSubTrigger>
        <CheckCircle2Icon className="size-3.5 text-primary" />
        <span className="flex-1">
          <T>Mark resolved (Fixed)</T>
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {builds.length > 8 ? (
          <MenuSearchInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Search builds…")}
            aria-label={gt("Search builds")}
          />
        ) : null}
        <div className="overflow-y-auto overscroll-contain" style={SELECTOR_SCROLL_LIST_STYLE}>
          {filtered.length === 0 ? (
            <MenuItem disabled>
              <T>No matching builds</T>
            </MenuItem>
          ) : (
            filtered.map((build) => (
              <MenuItem key={build.id} onClick={() => onSelectBuild(build.id)}>
                <span className="truncate">{build.name}</span>
              </MenuItem>
            ))
          )}
        </div>
      </MenuSubPopup>
    </MenuSub>
  );
}

export function IssueAutomationInspectorContent({
  environmentId,
  connector,
  issueSummary,
  issueDetail,
  detailLoading,
  detailError,
  onRefreshDetail,
  activeTask,
  inspectorTab,
  onInspectorTabChange,
  projects,
  matchedProfile,
  adhocProjectId,
  onAdhocProjectIdChange,
  adhocModelSelection,
  onAdhocModelSelectionChange,
  adhocMode,
  onAdhocModeChange,
  dispatching,
  onDispatchIssue,
  onStartRepair,
  onConfirmRepair,
  canWriteBack,
  writingBack,
  onManualWriteBack,
  onCancelTask,
  onOpenThread,
  onEditConnector,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly connector: IssueAutomationConnector | null;
  readonly issueSummary: IssueAutomationRemoteIssue | null;
  readonly issueDetail: IssueAutomationRemoteIssueDetail | null;
  readonly detailLoading: boolean;
  readonly detailError: string | null;
  readonly onRefreshDetail: () => void;
  readonly activeTask: IssueAutomationTask | null;
  readonly inspectorTab: InspectorSubTab;
  readonly onInspectorTabChange: (next: InspectorSubTab) => void;
  readonly projects: ReadonlyArray<SelectableProjectOption>;
  readonly matchedProfile: IssueAutomationProfile | null;
  readonly adhocProjectId: string;
  readonly onAdhocProjectIdChange: (next: string) => void;
  readonly adhocModelSelection: ModelSelection | null;
  readonly onAdhocModelSelectionChange: (next: ModelSelection) => void;
  readonly adhocMode: IssueAutomationActionMode;
  readonly onAdhocModeChange: (next: IssueAutomationActionMode) => void;
  readonly dispatching: boolean;
  readonly onDispatchIssue: (issueKey: string) => void;
  readonly onStartRepair?: (() => void) | undefined;
  readonly onConfirmRepair?: ((taskId: IssueAutomationTask["id"]) => void) | undefined;
  readonly canWriteBack: boolean;
  readonly writingBack: boolean;
  readonly onManualWriteBack: (payload: ManualWriteBackPayload) => Promise<boolean>;
  readonly onCancelTask: (taskId: IssueAutomationTask["id"]) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onEditConnector?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const canComment =
    canWriteBack &&
    connector?.status !== "disconnected" &&
    connector?.writeActions.includes("comment");
  const canConfirm =
    canWriteBack &&
    connector?.status !== "disconnected" &&
    connector?.writeActions.includes("confirm");
  const canResolve =
    canWriteBack &&
    connector?.status !== "disconnected" &&
    connector?.writeActions.includes("resolve");
  const canActivate =
    canWriteBack &&
    connector?.status !== "disconnected" &&
    connector?.writeActions.includes("activate");
  const canClose =
    canWriteBack &&
    connector?.status !== "disconnected" &&
    connector?.writeActions.includes("close");
  const actionModeLabel = useActionModeLabel();
  const [commentDraft, setCommentDraft] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const effectiveTab: InspectorSubTab =
    inspectorTab === "trace" && activeTask !== null
      ? "trace"
      : issueDetail !== null || issueSummary !== null || detailLoading
        ? "detail"
        : activeTask !== null
          ? "trace"
          : "detail";

  const resolvedProjectId =
    adhocProjectId || matchedProfile?.repositories.primaryProjectId || projects[0]?.id || "";
  const selectedProject = projects.find((p) => p.id === resolvedProjectId) ?? projects[0] ?? null;
  const cwd = selectedProject?.workspaceRoot ?? "";

  const resolvedModelSelection = adhocModelSelection ?? matchedProfile?.models.primaryModel ?? null;

  const displayKey =
    effectiveTab === "trace" && activeTask
      ? activeTask.displayKey
      : (issueDetail?.displayKey ?? issueSummary?.displayKey ?? activeTask?.displayKey ?? "");
  const scopeLabel =
    effectiveTab === "trace" && activeTask
      ? activeTask.scopeName
      : (issueDetail?.scopeName ??
        issueSummary?.scopeName ??
        activeTask?.scopeName ??
        connector?.name ??
        "");
  const externalUrl =
    effectiveTab === "trace" && activeTask
      ? activeTask.issueUrl
      : (issueDetail?.url ?? issueSummary?.url ?? activeTask?.issueUrl ?? "");
  const targetIssueKey = issueDetail?.key ?? issueSummary?.key ?? activeTask?.issueKey ?? null;
  const formattedBugKey = formatIssueNumber(displayKey, targetIssueKey ?? undefined);

  const bugLinkElement = formattedBugKey ? (
    externalUrl ? (
      <InlineButton
        className="shrink-0 font-mono text-xs font-medium text-foreground hover:text-primary"
        aria-label={gt("Open {issue} in ZenTao", { issue: formattedBugKey })}
        render={<a href={externalUrl} target="_blank" rel="noopener noreferrer" />}
      >
        {formattedBugKey}
        <ExternalLinkIcon aria-hidden className="size-3" />
      </InlineButton>
    ) : (
      <span className="shrink-0 font-mono text-xs font-medium text-foreground">
        {formattedBugKey}
      </span>
    )
  ) : null;

  const submitComment = async () => {
    const body = commentDraft.trim();
    if (!canComment || !body || !targetIssueKey || writingBack) return;
    const ok = await onManualWriteBack({
      kind: "comment",
      issueKey: targetIssueKey,
      comment: body,
    });
    if (ok) {
      setCommentDraft("");
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
      <div
        data-chat-header
        className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border/60 bg-background px-4"
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {scopeLabel}
        </span>

        {issueDetail &&
        targetIssueKey &&
        ((!issueDetail.confirmed && canConfirm) || canResolve || canActivate || canClose) ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className="shrink-0"
                  disabled={writingBack}
                  aria-label={gt("Update ZenTao issue status")}
                />
              }
            >
              <RemoteIssueStatusGlyph
                status={issueDetail.status}
                statusLabel={issueDetail.statusLabel}
                className="size-3.5"
              />
              <span>{issueDetail.statusLabel}</span>
              <ChevronDownIcon aria-hidden className="size-3" />
            </MenuTrigger>
            <MenuPopup align="end">
              {!issueDetail.confirmed && canConfirm ? (
                <MenuItem
                  onClick={() =>
                    void onManualWriteBack({
                      kind: "confirm",
                      issueKey: targetIssueKey,
                      ...(commentDraft.trim() ? { comment: commentDraft.trim() } : {}),
                    })
                  }
                >
                  <CheckCircle2Icon className="size-3.5 text-primary" />
                  <T>Confirm bug</T>
                </MenuItem>
              ) : null}

              {canResolve ? (
                issueDetail.availableBuilds.length > 0 ? (
                  <ResolveBuildSubmenu
                    builds={issueDetail.availableBuilds}
                    onSelectBuild={(buildId) =>
                      void onManualWriteBack({
                        kind: "resolve",
                        issueKey: targetIssueKey,
                        resolution: "fixed",
                        resolvedBuild: buildId,
                        ...(commentDraft.trim() ? { comment: commentDraft.trim() } : {}),
                      })
                    }
                  />
                ) : (
                  <MenuItem
                    onClick={() =>
                      void onManualWriteBack({
                        kind: "resolve",
                        issueKey: targetIssueKey,
                        resolution: "fixed",
                        resolvedBuild: "trunk",
                        ...(commentDraft.trim() ? { comment: commentDraft.trim() } : {}),
                      })
                    }
                  >
                    <CheckCircle2Icon className="size-3.5 text-primary" />
                    <T>Mark resolved (Fixed · trunk)</T>
                  </MenuItem>
                )
              ) : null}

              {canActivate ? (
                <MenuItem
                  onClick={() =>
                    void onManualWriteBack({
                      kind: "activate",
                      issueKey: targetIssueKey,
                      ...(commentDraft.trim() ? { comment: commentDraft.trim() } : {}),
                    })
                  }
                >
                  <PlayIcon className="size-3.5" />
                  <T>Reactivate bug</T>
                </MenuItem>
              ) : null}
              {canClose ? (
                <MenuItem
                  onClick={() =>
                    void onManualWriteBack({
                      kind: "close",
                      issueKey: targetIssueKey,
                      ...(commentDraft.trim() ? { comment: commentDraft.trim() } : {}),
                    })
                  }
                >
                  <XCircleIcon className="size-3.5" />
                  <T>Close bug</T>
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}

        {effectiveTab === "detail" && activeTask?.primaryThreadId ? (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => onOpenThread(activeTask.primaryThreadId!)}
          >
            <MessageSquareIcon className="size-3.5" />
            <T>Thread & Diff</T>
          </Button>
        ) : null}

        {effectiveTab === "detail" && targetIssueKey ? (
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            aria-label={gt("Refresh issue detail")}
            disabled={detailLoading}
            onClick={onRefreshDetail}
          >
            <RefreshIcon size="sm" refreshing={detailLoading} />
          </Button>
        ) : null}

        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0"
          aria-label={gt("Close inspector")}
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {(issueDetail !== null || issueSummary !== null) && activeTask !== null ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-5 py-2">
          <ToggleGroup
            variant="segmented"
            size="segmented"
            value={[effectiveTab]}
            onValueChange={(next) => {
              const picked = next[0] as InspectorSubTab | undefined;
              if (picked) onInspectorTabChange(picked);
            }}
          >
            <Toggle value="detail">
              <T>Issue detail</T>
            </Toggle>
            <Toggle value="trace">
              <span className="inline-flex items-center gap-1.5">
                <TaskStageGlyph stage={activeTask.stage} className="size-3.5" />
                <T>Execution trace</T>
              </span>
            </Toggle>
          </ToggleGroup>

          <StageBadge stage={activeTask.stage} size="default" task={activeTask} />
        </div>
      ) : null}

      {effectiveTab === "detail" ? (
        <>
          <div
            className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto pb-36"
            data-pull-request-summary-scroll
          >
            <div key="detail" className={WORKSPACE_TAB_PANEL_CLASS}>
              {detailLoading && issueDetail === null ? (
                <div className="space-y-4 px-5 py-5">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-36 w-full" />
                </div>
              ) : detailError !== null && issueDetail === null ? (
                <div className="px-5 py-5">
                  <Alert variant="error">
                    <AlertTitle>{gt("Could not load issue details")}</AlertTitle>
                    <AlertDescription>{detailError}</AlertDescription>
                    {onEditConnector ? (
                      <AlertAction>
                        <Button size="xs" variant="outline" onClick={onEditConnector}>
                          <PencilIcon className="size-3.5" />
                          <T>Edit connection</T>
                        </Button>
                      </AlertAction>
                    ) : null}
                  </Alert>
                </div>
              ) : issueDetail !== null ? (
                <>
                  <div className="px-5 pt-4 pb-2">
                    <PullRequestDetailTitleRow className="gap-2">
                      <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">
                        {cleanIssueText(issueDetail.title)}
                      </h2>
                    </PullRequestDetailTitleRow>

                    <PullRequestMetaLine className="mt-2 min-h-5 flex-wrap gap-y-1 text-xs text-muted-foreground">
                      {bugLinkElement}
                      {issueDetail.author ? (
                        <span>
                          <T>Opened by</T> {issueDetail.author}
                        </span>
                      ) : null}
                      <span className="tabular-nums">{issueDetail.createdAt}</span>
                      <span>{issueDetail.confirmed ? <T>Confirmed</T> : <T>Unconfirmed</T>}</span>
                      {issueDetail.openedBuild ? (
                        <span>
                          <T>Build</T>: {issueDetail.openedBuild}
                        </span>
                      ) : null}
                    </PullRequestMetaLine>

                    <div className="mt-4 space-y-1.5">
                      <PullRequestMetaRow
                        icon={<UsersIcon className="size-3.5" />}
                        label={gt("Assignee")}
                      >
                        <span>{issueDetail.assignee ?? gt("Unassigned")}</span>
                      </PullRequestMetaRow>

                      <PullRequestMetaRow
                        icon={<LayersIcon className="size-3.5" />}
                        label={gt("Module")}
                      >
                        <span>{issueDetail.moduleName ?? gt("Root module")}</span>
                      </PullRequestMetaRow>

                      <PullRequestMetaRow
                        icon={<ShieldAlertIcon className="size-3.5" />}
                        label={gt("Severity")}
                      >
                        <span className="inline-flex items-center gap-2">
                          <SeverityIndicator severity={issueDetail.severity} />
                          {issueDetail.priority !== null ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              P{issueDetail.priority}
                            </span>
                          ) : null}
                        </span>
                      </PullRequestMetaRow>
                    </div>

                    <div className="mt-4 rounded-xl border border-border/60 bg-card/40 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                          <BotIcon className="size-3.5 text-muted-foreground" />
                          <span>
                            <T>Automated diagnosis & Worktree fix</T>
                          </span>
                          {matchedProfile ? (
                            <Badge variant="secondary" size="sm">
                              {matchedProfile.name}
                            </Badge>
                          ) : null}
                        </div>

                        <Button
                          size="xs"
                          disabled={dispatching}
                          onClick={() => onDispatchIssue(issueDetail.key)}
                        >
                          {dispatching ? <Spinner size="xs" /> : <PlayIcon className="size-3" />}
                          <T>Run diagnosis</T>
                        </Button>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <SearchableProjectMenu
                          projects={projects}
                          value={resolvedProjectId}
                          onChange={onAdhocProjectIdChange}
                          ariaLabel={gt("Target local repository")}
                          className="min-w-0"
                        />

                        <OfficialModelPicker
                          driverKind={adhocMode === "diagnose_only" ? "claudeAgent" : undefined}
                          environmentId={environmentId}
                          value={resolvedModelSelection}
                          onChange={(next) => {
                            if (next) onAdhocModelSelectionChange(next);
                          }}
                          ariaLabel={gt("Primary AI model")}
                          popupSide="bottom"
                          popupAlign="end"
                          workspaceCwd={cwd || null}
                          triggerClassName="min-w-0"
                        />

                        <Select
                          value={adhocMode}
                          onValueChange={(next) => {
                            if (next) onAdhocModeChange(next as IssueAutomationActionMode);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="min-w-0"
                            aria-label={gt("Execution mode")}
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
                      </div>
                    </div>
                  </div>

                  <PullRequestSection
                    key={`steps:${issueDetail.key}`}
                    title={gt("Reproduction steps & description")}
                    keepMounted
                    actions={
                      issueDetail.imageUrls.length > 0 ? (
                        <Badge variant="secondary" size="sm">
                          <T>Attachments</T>: {issueDetail.imageUrls.length}
                        </Badge>
                      ) : null
                    }
                  >
                    <PullRequestMarkdown
                      text={
                        issueDetail.stepsMarkdown.trim().length > 0
                          ? issueDetail.stepsMarkdown
                          : gt("_No reproduction steps provided._")
                      }
                      cwd={cwd}
                      environmentId={environmentId}
                      lineBreaks
                    />
                    {issueDetail.imageUrls.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
                        {issueDetail.imageUrls.map((url, index) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline"
                            >
                              {gt("Download attachment {number}", { number: index + 1 })}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </PullRequestSection>

                  <PullRequestSection
                    key={`comments:${issueDetail.key}`}
                    title={`${gt("ZenTao history & comments")} (${String(issueDetail.comments.length)})`}
                    keepMounted
                  >
                    {issueDetail.comments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        <T>No history or comments yet.</T>
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {issueDetail.comments.map((comment) => (
                          <article
                            key={comment.id}
                            className="rounded-lg border border-border/60 bg-card/20 p-3"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                              <span className="font-medium text-foreground">
                                {comment.actor}
                                <span className="font-normal text-muted-foreground">
                                  {" "}
                                  · {comment.action}
                                </span>
                              </span>
                              <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                                {comment.createdAt}
                              </span>
                            </div>
                            {comment.body.trim().length > 0 ? (
                              <div className="mt-2">
                                <PullRequestMarkdown
                                  text={comment.body}
                                  cwd={cwd}
                                  environmentId={environmentId}
                                  lineBreaks
                                />
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </PullRequestSection>
                </>
              ) : null}
            </div>
          </div>
          {targetIssueKey && canComment ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
              <ComposerSurface.Shell className="pointer-events-auto">
                <ComposerSurface.Host>
                  <form
                    className="relative z-10 flex flex-col"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitComment();
                    }}
                  >
                    <textarea
                      ref={commentRef}
                      rows={2}
                      className="field-sizing-content max-h-56 min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-base text-foreground outline-none wrap-anywhere placeholder:text-muted-foreground/70 disabled:opacity-64 sm:text-sm"
                      aria-label={gt("Write a comment to ZenTao")}
                      placeholder={gt(
                        "Leave a comment or analysis note on ZenTao (Markdown supported)…",
                      )}
                      value={commentDraft}
                      disabled={writingBack}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey) &&
                          !event.shiftKey
                        ) {
                          event.preventDefault();
                          if (!event.repeat) void submitComment();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                      <span className="text-2xs text-muted-foreground">
                        <T>Cmd+Enter to post directly to ZenTao</T>
                      </span>
                      <button
                        type="submit"
                        className="flex size-8 items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:shadow-message-action/24 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:shadow-none active:inset-shadow-control-pressed disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none"
                        disabled={writingBack || commentDraft.trim().length === 0}
                        aria-label={gt("Post comment to ZenTao")}
                      >
                        {writingBack ? (
                          <Spinner size="sm" aria-hidden />
                        ) : (
                          <ArrowUpIcon aria-hidden className="size-4" />
                        )}
                      </button>
                    </div>
                  </form>
                </ComposerSurface.Host>
              </ComposerSurface.Shell>
            </div>
          ) : null}
        </>
      ) : activeTask ? (
        <div
          className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto pb-12"
          data-pull-request-summary-scroll
        >
          <div key="trace" className={WORKSPACE_TAB_PANEL_CLASS}>
            <div className="px-5 pt-4 pb-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h2 className="text-base font-semibold leading-snug text-foreground">
                    {cleanIssueText(activeTask.issueTitle)}
                  </h2>
                  <PullRequestMetaLine className="flex-wrap gap-y-1 text-xs text-muted-foreground">
                    {bugLinkElement}
                    <span className="font-mono">{activeTask.assignedModelLabel}</span>
                    {activeTask.targetProjectId ? (
                      <span className="inline-flex items-center gap-1">
                        <FolderGit2Icon className="size-3 shrink-0" />
                        {projects.find((p) => p.id === activeTask.targetProjectId)?.title ??
                          activeTask.targetProjectId}
                      </span>
                    ) : null}
                    {activeTask.worktreeBranch ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <GitBranchIcon className="size-3 shrink-0" />
                        {activeTask.worktreeBranch}
                      </span>
                    ) : null}
                  </PullRequestMetaLine>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {activeTask.primaryThreadId ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onOpenThread(activeTask.primaryThreadId!)}
                    >
                      <MessageSquareIcon className="size-3.5" />
                      <T>Thread & Diff</T>
                    </Button>
                  ) : null}
                  {activeTask.reviewThreadId ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onOpenThread(activeTask.reviewThreadId!)}
                    >
                      <MessageSquareIcon className="size-3.5" />
                      <T>Cross-review Thread</T>
                    </Button>
                  ) : null}
                  {isStageActive(activeTask.stage) &&
                  (activeTask.stage !== "cancelling" || activeTask.lastError !== null) ? (
                    <Button
                      size="xs"
                      variant="ghost-destructive"
                      onClick={() => onCancelTask(activeTask.id)}
                    >
                      <XCircleIcon className="size-3.5" />
                      {activeTask.stage === "cancelling" ? (
                        <T>Retry cancellation</T>
                      ) : (
                        <T>Cancel</T>
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-2.5 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 sm:grid-cols-6">
                {[
                  { idx: 1, label: gt("Fetch") },
                  { idx: 2, label: gt("Route") },
                  { idx: 3, label: gt("Diagnose & fix") },
                  { idx: 4, label: gt("Cross-review") },
                  { idx: 5, label: gt("Write-back") },
                  { idx: 6, label: gt("Done") },
                ].map((step) => {
                  const currentIdx = stageStepIndex(activeTask.stage);
                  const done =
                    currentIdx > step.idx ||
                    activeTask.stage === "completed" ||
                    activeTask.stage === "needs_human";
                  const current = currentIdx === step.idx && isStageActive(activeTask.stage);
                  return (
                    <div key={step.idx} className="flex min-w-0 items-center gap-1.5">
                      {done ? (
                        <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />
                      ) : current ? (
                        <span className="inline-flex shrink-0 text-info">
                          <Spinner size="xs" className="shrink-0" />
                        </span>
                      ) : (
                        <span className="size-2 shrink-0 rounded-full bg-muted-foreground/35" />
                      )}
                      <span
                        className={cn(
                          "truncate text-xs",
                          done
                            ? "font-medium text-foreground"
                            : current
                              ? "font-medium text-info"
                              : "text-muted-foreground",
                        )}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {activeTask.lastError ? (
                <div className="mt-3">
                  <Alert variant="error">
                    <CircleAlertIcon className="size-4" />
                    <AlertTitle>{gt("Execution error")}</AlertTitle>
                    <AlertDescription>{activeTask.lastError}</AlertDescription>
                  </Alert>
                </div>
              ) : null}
            </div>

            {activeTask.diagnosisReport || onStartRepair ? (
              <PullRequestSection
                key={`report:${activeTask.id}`}
                title={
                  activeTask.repairOfTaskId !== undefined
                    ? gt("Repair report")
                    : activeTask.actionMode === "diagnose_only"
                      ? gt("Diagnosis report")
                      : gt("Root-cause analysis & solution report")
                }
                keepMounted
                actions={
                  onStartRepair ? (
                    <Button size="xs" disabled={dispatching} onClick={onStartRepair}>
                      {activeTask.repairOfTaskId !== undefined ? (
                        <T>Retry repair</T>
                      ) : (
                        <T>Start repair</T>
                      )}
                    </Button>
                  ) : activeTask.repairOfTaskId !== undefined ? (
                    activeTask.stage === "needs_human" && onConfirmRepair ? (
                      <Button
                        size="xs"
                        disabled={dispatching}
                        onClick={() => onConfirmRepair(activeTask.id)}
                      >
                        <T>Confirm repair</T>
                      </Button>
                    ) : activeTask.repairConfirmedAt &&
                      (canComment || canResolve) &&
                      activeTask.diagnosisReport ? (
                      <IssueAutomationRepairSyncDialog
                        task={activeTask}
                        report={activeTask.diagnosisReport}
                        detail={issueDetail}
                        environmentId={environmentId}
                        cwd={
                          projects.find((p) => p.id === activeTask.targetProjectId)
                            ?.workspaceRoot ?? cwd
                        }
                        writingBack={writingBack}
                        supportsComment={canComment === true}
                        supportsResolve={canResolve === true}
                        onSync={onManualWriteBack}
                      />
                    ) : null
                  ) : activeTask.actionMode !== "diagnose_only" && (canComment || canResolve) ? (
                    <div className="flex items-center gap-1.5">
                      {canComment ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={writingBack}
                          onClick={() =>
                            void onManualWriteBack({
                              kind: "comment",
                              issueKey: activeTask.issueKey,
                              comment: activeTask.diagnosisReport!,
                              taskId: activeTask.id,
                            })
                          }
                        >
                          <SendIcon className="size-3" />
                          {activeTask.commentSyncedAt ? (
                            <T>Re-sync comment</T>
                          ) : (
                            <T>Sync to ZenTao</T>
                          )}
                        </Button>
                      ) : null}
                      {canResolve ? (
                        <Button
                          size="xs"
                          disabled={writingBack}
                          onClick={() =>
                            void onManualWriteBack({
                              kind: "resolve",
                              issueKey: activeTask.issueKey,
                              resolution: "fixed",
                              resolvedBuild: "trunk",
                              comment: activeTask.diagnosisReport!,
                              taskId: activeTask.id,
                            })
                          }
                        >
                          <CheckCircle2Icon className="size-3" />
                          <T>Sync & mark Resolved</T>
                        </Button>
                      ) : null}
                    </div>
                  ) : null
                }
              >
                {activeTask.diagnosisReport ? (
                  <div className="rounded-xl border border-border/60 bg-card/30 p-4">
                    <PullRequestMarkdown
                      text={activeTask.diagnosisReport}
                      cwd={
                        projects.find((p) => p.id === activeTask.targetProjectId)?.workspaceRoot ??
                        cwd
                      }
                      environmentId={environmentId}
                    />
                  </div>
                ) : null}
              </PullRequestSection>
            ) : null}

            {activeTask.reviewReport ? (
              <PullRequestSection
                key={`review:${activeTask.id}`}
                title={gt("Heterogeneous model cross-review")}
              >
                <div className="rounded-xl border border-border/60 bg-card/30 p-4">
                  <PullRequestMarkdown
                    text={activeTask.reviewReport}
                    cwd={
                      projects.find((p) => p.id === activeTask.targetProjectId)?.workspaceRoot ??
                      cwd
                    }
                    environmentId={environmentId}
                  />
                </div>
              </PullRequestSection>
            ) : null}

            <PullRequestSection
              key={`timeline:${activeTask.id}`}
              title={gt("Execution timeline")}
              defaultOpen={isStageActive(activeTask.stage) || !activeTask.diagnosisReport}
              keepMounted
            >
              <div className="relative ml-2 space-y-3 border-l border-border/70 pl-4">
                {activeTask.steps.map((step, idx) => (
                  <div
                    key={`${step.at}-${String(idx)}`}
                    className="relative flex flex-col gap-0.5 text-xs"
                  >
                    <span
                      aria-hidden
                      className="absolute -left-5 top-1.5 size-2 rounded-full bg-primary/70 ring-4 ring-background"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                        {new Date(step.at).toLocaleTimeString()}
                      </span>
                      {step.modelLabel ? (
                        <Badge variant="secondary" size="sm">
                          {step.modelLabel}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="leading-relaxed text-foreground">{step.message}</p>
                  </div>
                ))}
              </div>
            </PullRequestSection>
          </div>
        </div>
      ) : null}
    </div>
  );
}
