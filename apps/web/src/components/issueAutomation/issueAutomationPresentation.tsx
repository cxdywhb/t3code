import type { IssueAutomationActionMode, IssueAutomationStage } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function cleanIssueText(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function formatIssueNumber(displayKey: string, fallbackKey?: string): string {
  const normalized = displayKey.replace(/^bug\s+/i, "").trim();
  if (normalized.length > 0) {
    return normalized.startsWith("#") ? normalized : `#${normalized}`;
  }
  return fallbackKey ? `#${fallbackKey}` : "";
}

export function isStageActive(stage: IssueAutomationStage): boolean {
  return (
    stage === "queued" ||
    stage === "enriching" ||
    stage === "routing" ||
    stage === "diagnosing" ||
    stage === "reviewing" ||
    stage === "writing_back"
  );
}

export function stageStepIndex(stage: IssueAutomationStage): number {
  switch (stage) {
    case "queued":
      return 0;
    case "enriching":
      return 1;
    case "routing":
      return 2;
    case "diagnosing":
      return 3;
    case "reviewing":
      return 4;
    case "writing_back":
      return 5;
    case "completed":
    case "needs_human":
      return 6;
    case "failed":
    case "cancelled":
      return -1;
  }
}

export function RemoteIssueStatusGlyph({
  status,
  statusLabel,
  className,
}: {
  readonly status: string;
  readonly statusLabel: string;
  readonly className?: string;
}) {
  const normalized = status.toLowerCase();
  const resolved = normalized === "resolved";
  const closed = normalized === "closed";
  const Icon = resolved ? CircleCheckIcon : closed ? CircleSlashIcon : CircleDotIcon;
  const toneClass = closed
    ? "text-muted-foreground"
    : resolved
      ? "text-accent-foreground"
      : "text-primary";

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Icon
          role="img"
          aria-label={statusLabel}
          className={cn("size-4 shrink-0", toneClass, className)}
        />
      </TooltipTrigger>
      <TooltipPopup>{statusLabel}</TooltipPopup>
    </Tooltip>
  );
}

export function TaskStageGlyph({
  stage,
  className,
}: {
  readonly stage: IssueAutomationStage;
  readonly className?: string;
}) {
  if (isStageActive(stage)) {
    return (
      <span className="inline-flex shrink-0 text-info">
        <Spinner size="md" className={cn("shrink-0", className)} />
      </span>
    );
  }
  if (stage === "completed") {
    return (
      <CheckCircle2Icon aria-hidden className={cn("size-4 shrink-0 text-success", className)} />
    );
  }
  if (stage === "needs_human") {
    return (
      <CircleAlertIcon aria-hidden className={cn("size-4 shrink-0 text-warning", className)} />
    );
  }
  if (stage === "failed") {
    return (
      <XCircleIcon aria-hidden className={cn("size-4 shrink-0 text-destructive", className)} />
    );
  }
  return (
    <CircleSlashIcon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

export function StageBadge({
  stage,
  size = "sm",
}: {
  readonly stage: IssueAutomationStage;
  readonly size?: "sm" | "default";
}) {
  switch (stage) {
    case "queued":
      return (
        <Badge variant="outline" size={size}>
          <T>Queued</T>
        </Badge>
      );
    case "enriching":
      return (
        <Badge variant="info" size={size}>
          <span aria-hidden className="size-1.5 rounded-full bg-info" />
          <T>Fetching context</T>
        </Badge>
      );
    case "routing":
      return (
        <Badge variant="info" size={size}>
          <span aria-hidden className="size-1.5 rounded-full bg-info" />
          <T>Routing repo</T>
        </Badge>
      );
    case "diagnosing":
      return (
        <Badge variant="info" size={size}>
          <span aria-hidden className="size-1.5 rounded-full bg-info" />
          <T>Diagnosing</T>
        </Badge>
      );
    case "reviewing":
      return (
        <Badge variant="info" size={size}>
          <span aria-hidden className="size-1.5 rounded-full bg-info" />
          <T>Cross-review</T>
        </Badge>
      );
    case "writing_back":
      return (
        <Badge variant="info" size={size}>
          <span aria-hidden className="size-1.5 rounded-full bg-info" />
          <T>Syncing</T>
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="success" size={size}>
          <T>Completed</T>
        </Badge>
      );
    case "needs_human":
      return (
        <Badge variant="warning" size={size}>
          <T>Needs review</T>
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="error" size={size}>
          <T>Failed</T>
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" size={size}>
          <T>Cancelled</T>
        </Badge>
      );
  }
}

export function SeverityIndicator({ severity }: { readonly severity: number | null }) {
  if (severity === null) return null;
  if (severity <= 1) {
    return (
      <Badge variant="error" size="sm">
        <span className="font-mono tabular-nums">S{severity}</span>
      </Badge>
    );
  }
  if (severity === 2) {
    return (
      <Badge variant="warning" size="sm">
        <span className="font-mono tabular-nums">S{severity}</span>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size="sm">
      <span className="font-mono text-muted-foreground tabular-nums">S{severity}</span>
    </Badge>
  );
}

export function useActionModeLabel() {
  const gt = useGT();
  return (mode: IssueAutomationActionMode): string => {
    switch (mode) {
      case "diagnose_only":
        return gt("Diagnose only + Comment");
      case "fix_worktree_review":
        return gt("Worktree fix + Comment");
      case "auto_resolve":
        return gt("Auto fix + Mark resolved");
    }
  };
}
