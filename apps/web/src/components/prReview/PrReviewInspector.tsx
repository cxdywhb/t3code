import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PrReviewFinding,
  PrReviewFindingSeverity,
  PrReviewModelRun,
  PrReviewStage,
  PrReviewTask,
  PrReviewVerdict,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCode2Icon,
  LayersIcon,
  Maximize2Icon,
  MessageSquareShareIcon,
  Minimize2Icon,
  PencilLineIcon,
  SendIcon,
  ShieldCheckIcon,
  SquareIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { PullRequestMarkdown } from "~/components/pullRequest/PullRequestMarkdown";
import { PullRequestSection } from "~/components/pullRequest/PullRequestSummaryTab";
import { RelativeTime } from "~/components/RelativeTime";
import { WORKSPACE_TAB_PANEL_CLASS } from "~/components/WorkspacePageHeader";
import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { prReviewEnvironment } from "~/state/prReview";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePrReviewRoleLabel } from "./PrReviewLaunchModal";
import {
  computeParallelSpeedup,
  extractTaskDiffStats,
  formatCompactDuration,
  formatCompactNumber,
  isPrReviewTaskRunning,
  resolveModelRunDurationMs,
  resolvePrReviewTaskDurationMs,
} from "./prReviewAnalytics.logic";

export function isPrReviewStageActive(stage: PrReviewStage): boolean {
  return isPrReviewTaskRunning(stage);
}

export function PrReviewVerdictBadge({ verdict }: { readonly verdict: PrReviewVerdict | null }) {
  if (verdict === "approve") {
    return (
      <Badge variant="success">
        <CheckCircle2Icon className="mr-1 size-3" />
        <T>Approve</T>
      </Badge>
    );
  }
  if (verdict === "request-changes") {
    return (
      <Badge variant="error">
        <AlertTriangleIcon className="mr-1 size-3" />
        <T>Request Changes</T>
      </Badge>
    );
  }
  if (verdict === "comment") {
    return (
      <Badge variant="outline">
        <T>Comment</T>
      </Badge>
    );
  }
  return null;
}

export function PrReviewStageBadge({ stage }: { readonly stage: PrReviewStage }) {
  const active = isPrReviewStageActive(stage);
  return (
    <Badge variant={stage === "failed" ? "destructive" : active ? "info" : "outline"}>
      {active ? <Spinner className="mr-1 size-2.5" /> : null}
      {stage === "queued" ? (
        <T>Queued</T>
      ) : stage === "fetching_context" ? (
        <T>Fetching Diff</T>
      ) : stage === "parallel_reviewing" ? (
        <T>Parallel Reviewing</T>
      ) : stage === "synthesizing" ? (
        <T>Synthesizing</T>
      ) : stage === "writing_back" ? (
        <T>Writing Back</T>
      ) : stage === "completed" ? (
        <T>Completed</T>
      ) : stage === "cancelled" ? (
        <T>Cancelled</T>
      ) : (
        <T>Failed</T>
      )}
    </Badge>
  );
}

function SeverityBadge({ severity }: { readonly severity: PrReviewFindingSeverity }) {
  const variant =
    severity === "blocker"
      ? "error"
      : severity === "major"
        ? "warning"
        : severity === "minor"
          ? "info"
          : "outline";
  return (
    <Badge variant={variant} size="sm">
      {severity.toUpperCase()}
    </Badge>
  );
}

function LiveTaskDurationPill({
  task,
  environmentId,
}: {
  readonly task: PrReviewTask;
  readonly environmentId: EnvironmentId;
}) {
  const nowMs = useNowSecond();
  const effectiveNowMs = toServerClock(environmentId, nowMs);
  const durationMs = resolvePrReviewTaskDurationMs(task, effectiveNowMs);
  if (durationMs === null) return null;
  const running = isPrReviewStageActive(task.stage);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-2xs tabular-nums",
        running
          ? "border-info/40 bg-info/10 text-info"
          : "border-border/60 bg-muted/40 text-muted-foreground",
      )}
    >
      <ClockIcon className="size-3 shrink-0" />
      {formatCompactDuration(durationMs)}
    </span>
  );
}

function ModelRunDurationText({
  run,
  environmentId,
}: {
  readonly run: PrReviewModelRun;
  readonly environmentId: EnvironmentId;
}) {
  const nowMs = useNowSecond();
  const effectiveNowMs = toServerClock(environmentId, nowMs);
  const durationMs = resolveModelRunDurationMs(run, effectiveNowMs);
  if (durationMs === null) return null;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground tabular-nums">
      <ClockIcon className="size-3 shrink-0 opacity-70" />
      {formatCompactDuration(durationMs)}
    </span>
  );
}

function buildDefaultWriteBackBody(task: PrReviewTask): string {
  const verdictText =
    task.verdict === "approve"
      ? "✅ **Approve / 建议通过**"
      : task.verdict === "request-changes"
        ? "⚠️ **Request Changes / 建议修改**"
        : "💬 **Comment / 审查建议**";
  const models = task.reviewerRuns.map((r) => `\`${r.modelLabel}\``).join(" · ");
  return [
    "## 🤖 T3 多模型融合代码审查报告",
    `- **综合裁决**: ${verdictText}`,
    `- **参与审查模型**: ${models || "-"}`,
    ...(task.synthesizerModelLabel
      ? [`- **融合裁决主模型**: \`${task.synthesizerModelLabel}\``]
      : []),
    ...(task.boundSkillNames.length > 0
      ? [`- **绑定专业 Skills**: ${task.boundSkillNames.map((s) => `\`${s}\``).join(", ")}`]
      : []),
    "",
    (task.summaryMarkdown ?? "").trim(),
  ].join("\n");
}

export type InspectorTab = "report" | "models" | "writeback";
type SeverityFilter = "all" | PrReviewFindingSeverity;

export function PrReviewInspector({
  environmentId,
  task,
  cwd = "",
  isExpanded = false,
  onToggleExpand,
  onJumpToThread,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: PrReviewTask;
  readonly cwd?: string;
  readonly isExpanded?: boolean;
  readonly onToggleExpand?: () => void;
  readonly onJumpToThread: (threadId: ThreadId) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const roleLabel = usePrReviewRoleLabel();
  const threadRef = task.synthesisThreadId
    ? scopeThreadRef(environmentId, task.synthesisThreadId)
    : null;
  const openLink = useOpenLink(threadRef);
  const cancelTask = useAtomCommand(prReviewEnvironment.cancelTask, { reportFailure: false });
  const writeBack = useAtomCommand(prReviewEnvironment.writeBack, { reportFailure: false });

  const [tab, setTab] = useState<InspectorTab>("report");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [wbKind, setWbKind] = useState<"comment" | "review">("comment");
  const [wbVerdictOverride, setWbVerdictOverride] = useState<{
    taskId: string;
    verdict: PrReviewVerdict;
  } | null>(null);
  const [wbBodyDraft, setWbBodyDraft] = useState<{ taskId: string; text: string } | null>(null);
  const [wbPreviewMode, setWbPreviewMode] = useState<"edit" | "preview">("edit");
  const [findingSelectionOverride, setFindingSelectionOverride] = useState<{
    taskId: string;
    ids: ReadonlyArray<string>;
  } | null>(null);
  const [posting, setPosting] = useState(false);

  const effectiveVerdict: PrReviewVerdict =
    wbVerdictOverride?.taskId === task.id ? wbVerdictOverride.verdict : (task.verdict ?? "comment");

  const defaultBody = buildDefaultWriteBackBody(task);
  const effectiveBody = wbBodyDraft?.taskId === task.id ? wbBodyDraft.text : defaultBody;

  const sigil = task.provider === "gitlab" ? "!" : "#";
  const active = isPrReviewStageActive(task.stage);
  const { Icon: ProviderIcon } = getSourceControlPresentationForKind(task.provider);
  const diffStats = extractTaskDiffStats(task);
  const parallelSpeedup = computeParallelSpeedup(task);

  const inlineCapableFindings = task.findings.filter(
    (f): f is PrReviewFinding & { filePath: string; line: number } =>
      f.filePath !== null && f.line !== null && f.line > 0,
  );

  // Default to selecting Blocker + Major findings (or all if none are Blocker/Major)
  const defaultSelectedIds = (() => {
    const highPriority = inlineCapableFindings
      .filter((f) => f.severity === "blocker" || f.severity === "major")
      .map((f) => f.id);
    return highPriority.length > 0 ? highPriority : inlineCapableFindings.map((f) => f.id);
  })();

  const selectedFindingIds =
    findingSelectionOverride?.taskId === task.id
      ? findingSelectionOverride.ids
      : defaultSelectedIds;

  const toggleFinding = (id: string) => {
    const next = selectedFindingIds.includes(id)
      ? selectedFindingIds.filter((item) => item !== id)
      : [...selectedFindingIds, id];
    setFindingSelectionOverride({ taskId: task.id, ids: next });
  };

  const highSevCount = task.findings.filter(
    (f) => f.severity === "blocker" || f.severity === "major",
  ).length;
  const consensusCount = task.findings.filter((f) => f.raisedByModels.length >= 2).length;

  const visibleFindings =
    severityFilter === "all"
      ? task.findings
      : task.findings.filter((f) => f.severity === severityFilter);

  const handleWriteBack = async () => {
    if (!effectiveBody.trim() || posting) return;
    setPosting(true);
    const res = await writeBack({
      environmentId,
      input: {
        taskId: task.id,
        kind: wbKind,
        verdict: effectiveVerdict,
        body: effectiveBody.trim(),
        ...(wbKind === "review" ? { inlineFindingIds: [...selectedFindingIds] } : {}),
      },
    });
    setPosting(false);
    if (res._tag === "Failure") {
      const failure = squashAtomCommandFailure(res);
      toastManager.add({
        type: "error",
        title: gt("Write-back failed"),
        description: failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title:
        wbKind === "review"
          ? gt("Submitted formal review to remote PR/MR")
          : gt("Posted fusion review comment to remote PR/MR"),
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ProviderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono break-all text-foreground/90">
              {task.repository}
              {sigil}
              {task.prNumber}
            </span>
            {task.projectId.startsWith("cloud:") ? (
              <Badge variant="outline" size="sm">
                <T>Cloud MR</T>
              </Badge>
            ) : null}
            <PrReviewStageBadge stage={task.stage} />
            <PrReviewVerdictBadge verdict={task.verdict} />
            <LiveTaskDurationPill task={task} environmentId={environmentId} />
            {diffStats ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-2xs tabular-nums">
                <span className="text-success">+{formatCompactNumber(diffStats.additions)}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-destructive">
                  -{formatCompactNumber(diffStats.deletions)}
                </span>
              </span>
            ) : null}
          </div>

          <h2 className="mt-2 text-base font-semibold leading-snug text-foreground">
            {task.prTitle}
          </h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
            {task.prAuthor ? <span>@{task.prAuthor}</span> : null}
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs">
              {task.headBranch} → {task.baseBranch}
            </span>
            <InlineButton onClick={(event) => void openLink(task.prUrl, { event })}>
              <T>Open on host</T>
              <ExternalLinkIcon className="size-3" />
            </InlineButton>
            {task.synthesisThreadId ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onJumpToThread(task.synthesisThreadId!)}
              >
                <BotIcon className="size-3.5" />
                <T>Jump to Main Agent</T>
                <ArrowUpRightIcon className="size-3" />
              </Button>
            ) : null}
            {active ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void cancelTask({ environmentId, input: { taskId: task.id } })}
              >
                <SquareIcon className="size-3" />
                <T>Cancel</T>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onToggleExpand ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={onToggleExpand}
                    aria-label={isExpanded ? gt("Restore split view") : gt("Expand reading view")}
                  />
                }
              >
                {isExpanded ? (
                  <Minimize2Icon className="size-3.5" />
                ) : (
                  <Maximize2Icon className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {isExpanded ? <T>Restore split view</T> : <T>Expand wide reading view</T>}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={gt("Close inspector")}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background px-5 py-2.5">
        <ToggleGroup
          variant="segmented"
          size="segmented"
          value={[tab]}
          onValueChange={(vals) => {
            const next = vals[0] as InspectorTab | undefined;
            if (next) setTab(next);
          }}
        >
          <Toggle value="report">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheckIcon className="size-3.5" />
              <T>Fusion Report</T>
              {task.findings.length > 0 ? (
                <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                  {task.findings.length}
                </span>
              ) : null}
            </span>
          </Toggle>
          <Toggle value="models">
            <span className="inline-flex items-center gap-1.5">
              <BotIcon className="size-3.5" />
              <T>Reviewer Models</T>
              <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                {task.reviewerRuns.length}
              </span>
            </span>
          </Toggle>
          <Toggle value="writeback">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareShareIcon className="size-3.5" />
              <T>Write-Back</T>
              {task.commentSyncedAt || task.reviewSyncedAt ? (
                <CheckCircle2Icon className="size-3 text-success" />
              ) : null}
            </span>
          </Toggle>
        </ToggleGroup>

        {parallelSpeedup !== null ? (
          <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground tabular-nums">
            <ZapIcon className="size-3 text-primary" />
            {parallelSpeedup.toFixed(1)}x <T>parallel speedup</T>
          </span>
        ) : null}
      </div>

      <div
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
        data-pull-request-summary-scroll
      >
        {tab === "report" ? (
          <div key="report" className={cn("flex flex-col pb-8", WORKSPACE_TAB_PANEL_CLASS)}>
            {task.stage === "completed" ||
            task.findings.length > 0 ||
            task.boundSkillNames.length > 0 ||
            task.lastError ? (
              <div className="flex flex-col gap-3 px-4 pt-4 pb-1">
                {task.stage === "completed" || task.findings.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 shadow-xs/5">
                      <div className="text-2xs text-muted-foreground">
                        <T>Total findings</T>
                      </div>
                      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                        {task.findings.length}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 shadow-xs/5">
                      <div className="text-2xs text-muted-foreground">
                        <T>Blocker / Major</T>
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 font-mono text-lg font-semibold tabular-nums",
                          highSevCount > 0 ? "text-warning" : "text-success",
                        )}
                      >
                        {highSevCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 shadow-xs/5">
                      <div className="text-2xs text-muted-foreground">
                        <T>Multi-model consensus</T>
                      </div>
                      <div className="mt-0.5 font-mono text-lg font-semibold text-primary tabular-nums">
                        {consensusCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 shadow-xs/5">
                      <div className="text-2xs text-muted-foreground">
                        <T>Models & Judge</T>
                      </div>
                      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                        {task.reviewerRuns.length}
                        {task.synthesizerModelLabel ? "+1" : ""}
                      </div>
                    </div>
                  </div>
                ) : null}

                {task.boundSkillNames.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      <T>Skills:</T>
                    </span>
                    {task.boundSkillNames.map((skill) => (
                      <Badge key={skill} variant="secondary" size="sm">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {task.lastError ? (
                  <Alert variant="error">
                    <AlertDescription>{task.lastError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            {task.findings.length > 0 ? (
              <PullRequestSection
                key={`findings:${task.id}`}
                title={`${gt("Consensus Findings")} (${String(visibleFindings.length)}/${String(task.findings.length)})`}
                keepMounted
                actions={
                  <ToggleGroup
                    variant="segmented"
                    size="segmented"
                    value={[severityFilter]}
                    onValueChange={(vals) => {
                      const next = vals[0] as SeverityFilter | undefined;
                      if (next) setSeverityFilter(next);
                    }}
                  >
                    <Toggle value="all">
                      <LayersIcon />
                      <T>All</T>
                    </Toggle>
                    <Toggle value="blocker">
                      <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                      <T>Blocker</T>
                    </Toggle>
                    <Toggle value="major">
                      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                      <T>Major</T>
                    </Toggle>
                    <Toggle value="minor">
                      <span aria-hidden className="size-1.5 rounded-full bg-info" />
                      <T>Minor</T>
                    </Toggle>
                    <Toggle value="nit">
                      <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/70" />
                      <T>Nit</T>
                    </Toggle>
                  </ToggleGroup>
                }
              >
                <div
                  key={severityFilter}
                  className={cn("flex flex-col gap-2.5", WORKSPACE_TAB_PANEL_CLASS)}
                >
                  {visibleFindings.map((finding) => (
                    <div
                      key={finding.id}
                      className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-3.5 text-xs shadow-xs/5 transition-colors duration-150 hover:border-border"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <SeverityBadge severity={finding.severity} />
                          {finding.raisedByModels.length >= 2 ? (
                            <Badge variant="secondary" size="sm">
                              <UsersIcon className="mr-1 size-3 text-primary" />
                              <Var>{finding.raisedByModels.length}</Var> <T>models agreed</T>
                            </Badge>
                          ) : null}
                          <span className="text-sm font-semibold leading-snug text-foreground">
                            {finding.title}
                          </span>
                        </div>
                        {finding.filePath ? (
                          <code className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 font-mono text-2xs break-all text-foreground/90">
                            <FileCode2Icon className="size-3 shrink-0 text-primary" />
                            {finding.filePath}
                            {finding.line ? `:${finding.line}` : ""}
                          </code>
                        ) : null}
                      </div>

                      <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">
                        {finding.description}
                      </p>

                      {finding.suggestion ? (
                        <div className="rounded-md border border-border/50 bg-muted/50 p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                          {finding.suggestion}
                        </div>
                      ) : null}

                      {finding.raisedByModels.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-2xs text-muted-foreground">
                          <span>
                            <T>Flagged by:</T>
                          </span>
                          {finding.raisedByModels.map((m) => (
                            <Badge key={m} variant="outline" size="sm">
                              {m}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </PullRequestSection>
            ) : null}

            {task.summaryMarkdown ? (
              <PullRequestSection
                key={`summary:${task.id}`}
                title={gt("Detailed Fusion Report")}
                keepMounted
              >
                <div className="rounded-xl border border-border/60 bg-card/40 p-4 shadow-xs/5">
                  <PullRequestMarkdown
                    text={task.summaryMarkdown}
                    cwd={cwd}
                    environmentId={environmentId}
                    threadRef={threadRef}
                  />
                </div>
              </PullRequestSection>
            ) : active ? (
              <div className="px-4 pt-3">
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
                  <Spinner className="size-4 shrink-0" />
                  <T>
                    Models are analyzing the diff and cross-verifying consensus findings… Click
                    &quot;Reviewer Models&quot; above to inspect any live Agent session in real
                    time.
                  </T>
                </div>
              </div>
            ) : null}

            {task.steps.length > 0 ? (
              <PullRequestSection key={`steps:${task.id}`} title={gt("Execution Log")} keepMounted>
                <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card/30 p-3 text-xs">
                  {task.steps.map((step) => (
                    <div
                      key={`${step.at}-${step.stage}-${step.message}`}
                      className="flex items-start gap-2.5 motion-safe:animate-step-in"
                    >
                      <span className="shrink-0 pt-0.5 text-2xs text-muted-foreground tabular-nums">
                        <RelativeTime timestamp={step.at} />
                      </span>
                      {step.modelLabel ? (
                        <span className="shrink-0">
                          <Badge variant="outline" size="sm">
                            {step.modelLabel}
                          </Badge>
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 leading-relaxed break-words">
                        {step.message}
                      </span>
                    </div>
                  ))}
                </div>
              </PullRequestSection>
            ) : null}
          </div>
        ) : tab === "models" ? (
          <div
            key="models"
            className={cn("flex flex-col gap-3.5 px-5 py-4 pb-8", WORKSPACE_TAB_PANEL_CLASS)}
          >
            {task.synthesizerModelLabel ? (
              <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-accent/20 p-3.5 text-xs shadow-xs/5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheckIcon className="size-4 text-primary" />
                    <span className="font-mono font-semibold">{task.synthesizerModelLabel}</span>
                    <Badge variant="secondary" size="sm">
                      <T>Synthesizer Judge</T>
                    </Badge>
                  </div>
                  {task.synthesisThreadId ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onJumpToThread(task.synthesisThreadId!)}
                    >
                      <BotIcon className="size-3.5" />
                      <T>Open Judge Thread</T>
                      <ArrowUpRightIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
                <p className="text-2xs text-muted-foreground">
                  <T>
                    Cross-verifies independent reviewer outputs, filters false positives, and emits
                    the final consensus verdict.
                  </T>
                </p>
              </div>
            ) : null}

            {task.reviewerRuns.map((run) => (
              <div
                key={run.slotId}
                className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 p-3.5 text-xs shadow-xs/5 transition-colors duration-150 hover:border-border"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-foreground">
                      {run.modelLabel}
                    </span>
                    <Badge variant="secondary" size="sm">
                      {roleLabel(run.role)}
                    </Badge>
                    <Badge
                      variant={
                        run.status === "failed"
                          ? "destructive"
                          : run.status === "completed"
                            ? "outline"
                            : "secondary"
                      }
                      size="sm"
                    >
                      {run.status === "running" ? <Spinner className="mr-1 size-2.5" /> : null}
                      {run.status}
                    </Badge>
                    <ModelRunDurationText run={run} environmentId={environmentId} />
                  </div>
                  {run.threadId ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onJumpToThread(run.threadId!)}
                    >
                      <BotIcon className="size-3.5" />
                      <T>Open Agent Thread</T>
                      <ArrowUpRightIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
                {run.error ? (
                  <Alert variant="error">
                    <AlertDescription>{run.error}</AlertDescription>
                  </Alert>
                ) : null}
                {run.reportMarkdown ? (
                  <Collapsible defaultOpen={task.reviewerRuns.length === 1}>
                    <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                      <ChevronRightIcon
                        aria-hidden
                        className="size-3.5 text-muted-foreground/60 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
                      />
                      <T>View individual model review report</T>
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="mt-2.5 rounded-lg border border-border/60 bg-background p-3.5">
                        <PullRequestMarkdown
                          text={run.reportMarkdown}
                          cwd={cwd}
                          environmentId={environmentId}
                          threadRef={
                            run.threadId ? scopeThreadRef(environmentId, run.threadId) : null
                          }
                        />
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div
            key="writeback"
            className={cn("flex flex-col gap-4 px-5 py-4 pb-8", WORKSPACE_TAB_PANEL_CLASS)}
          >
            {task.commentSyncedAt || task.reviewSyncedAt ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {task.commentSyncedAt ? (
                  <Badge variant="secondary">
                    <CheckCircle2Icon className="mr-1 size-3 text-success" />
                    <T>Comment synced</T> (<RelativeTime timestamp={task.commentSyncedAt} />)
                  </Badge>
                ) : null}
                {task.reviewSyncedAt ? (
                  <Badge variant="secondary">
                    <CheckCircle2Icon className="mr-1 size-3 text-success" />
                    <T>Formal review synced</T> (<RelativeTime timestamp={task.reviewSyncedAt} />)
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setWbKind("comment")}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors duration-150",
                  wbKind === "comment"
                    ? "border-primary bg-accent/60"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-accent/30",
                )}
              >
                <div className="font-semibold text-foreground">
                  <T>Post Summary Comment</T>
                </div>
                <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                  <T>Adds a general MR/PR comment with the fusion report.</T>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setWbKind("review")}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors duration-150",
                  wbKind === "review"
                    ? "border-primary bg-accent/60"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-accent/30",
                )}
              >
                <div className="font-semibold text-foreground">
                  <T>Submit Formal Review</T>
                </div>
                <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                  <T>Submits verdict (Approve / Request Changes / Comment) + inline notes.</T>
                </div>
              </button>
            </div>

            {wbKind === "review" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>
                    <T>Review Verdict</T>
                  </Label>
                  <Select
                    value={effectiveVerdict}
                    onValueChange={(v) => {
                      if (v) {
                        setWbVerdictOverride({
                          taskId: task.id,
                          verdict: v as PrReviewVerdict,
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {effectiveVerdict === "approve" ? (
                          <T>Approve</T>
                        ) : effectiveVerdict === "request-changes" ? (
                          <T>Request changes</T>
                        ) : (
                          <T>Comment only</T>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="comment">
                        <T>Comment only</T>
                      </SelectItem>
                      <SelectItem value="approve">
                        <T>Approve</T>
                      </SelectItem>
                      <SelectItem value="request-changes">
                        <T>Request changes</T>
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                {inlineCapableFindings.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label>
                        <T>
                          Include Inline Diff Comments (<Var>{selectedFindingIds.length}</Var>/
                          <Var>{inlineCapableFindings.length}</Var>)
                        </T>
                      </Label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setFindingSelectionOverride({
                              taskId: task.id,
                              ids: inlineCapableFindings
                                .filter((f) => f.severity === "blocker" || f.severity === "major")
                                .map((f) => f.id),
                            })
                          }
                        >
                          <T>Blocker/Major only</T>
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setFindingSelectionOverride({
                              taskId: task.id,
                              ids: inlineCapableFindings.map((f) => f.id),
                            })
                          }
                        >
                          <T>Select all</T>
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setFindingSelectionOverride({
                              taskId: task.id,
                              ids: [],
                            })
                          }
                        >
                          <T>Clear</T>
                        </Button>
                      </div>
                    </div>

                    <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border/70 bg-card/30 p-2.5">
                      {inlineCapableFindings.map((f) => {
                        const checked = selectedFindingIds.includes(f.id);
                        return (
                          <label
                            key={f.id}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 text-xs transition-colors",
                              checked
                                ? "border-primary/50 bg-accent/40"
                                : "border-transparent hover:bg-accent/30",
                            )}
                          >
                            <span className="pt-0.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleFinding(f.id)}
                              />
                            </span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <SeverityBadge severity={f.severity} />
                                {f.raisedByModels.length >= 2 ? (
                                  <Badge variant="outline" size="sm">
                                    <Var>{f.raisedByModels.length}</Var> <T>models</T>
                                  </Badge>
                                ) : null}
                                <span className="font-medium leading-snug text-foreground">
                                  {f.title}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 font-mono text-2xs text-muted-foreground">
                                <span className="break-all">
                                  {f.filePath}:{f.line}
                                </span>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>
                  <T>Markdown Content to Post</T>
                </Label>
                <ToggleGroup
                  variant="segmented"
                  size="segmented"
                  value={[wbPreviewMode]}
                  onValueChange={(vals) => {
                    const next = vals[0] as "edit" | "preview" | undefined;
                    if (next) setWbPreviewMode(next);
                  }}
                >
                  <Toggle value="edit">
                    <PencilLineIcon />
                    <T>Edit</T>
                  </Toggle>
                  <Toggle value="preview">
                    <EyeIcon />
                    <T>Preview</T>
                  </Toggle>
                </ToggleGroup>
              </div>

              {wbPreviewMode === "edit" ? (
                <Textarea
                  rows={15}
                  value={effectiveBody}
                  onChange={(e) => setWbBodyDraft({ taskId: task.id, text: e.currentTarget.value })}
                />
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-lg border border-border/70 bg-card/40 p-4">
                  <PullRequestMarkdown
                    text={effectiveBody}
                    cwd={cwd}
                    environmentId={environmentId}
                    threadRef={threadRef}
                  />
                </div>
              )}
            </div>

            <Button
              onClick={() => void handleWriteBack()}
              disabled={posting || !effectiveBody.trim()}
            >
              <SendIcon className="size-4" />
              {posting ? (
                <T>Publishing to host…</T>
              ) : wbKind === "review" ? (
                <T>Submit Review to Remote PR/MR</T>
              ) : (
                <T>Post Comment to Remote PR/MR</T>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
