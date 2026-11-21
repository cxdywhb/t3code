import { projectCloneProgressSummary } from "@t3tools/client-runtime/contract-labels";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FolderIcon,
  FolderOpenIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Spinner } from "../ui/spinner";
import type { CloneBatchSummary } from "./repositoriesPage.logic";

export function CloneProgressDialog({
  open,
  onOpenChange,
  environmentId,
  summary,
  canOpenLocalFolder,
  onCancelClone,
  onCancelAllRunning,
  onRetryClone,
  onOpenProject,
  onOpenLocalFolder,
  onClearList,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly summary: CloneBatchSummary;
  readonly canOpenLocalFolder: boolean;
  readonly onCancelClone: (projectId: ProjectId) => Promise<void>;
  readonly onCancelAllRunning: () => Promise<void>;
  readonly onRetryClone: (projectId: ProjectId) => Promise<void>;
  readonly onOpenProject: (projectId: ProjectId) => Promise<void>;
  readonly onOpenLocalFolder: (folderPath: string) => Promise<void>;
  readonly onClearList: () => void;
}) {
  const gt = useGT();
  const hasFailures = summary.failedCount > 0 || summary.cancelledCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {!summary.isComplete ? (
                <>
                  <Spinner className="size-4 shrink-0" />
                  <T>
                    Cloning repositories (<Var>{summary.settledCount}</Var>/
                    <Var>{summary.total}</Var>)
                  </T>
                </>
              ) : hasFailures ? (
                <>
                  <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
                  <T>Cloning finished with issues</T>
                </>
              ) : (
                <>
                  <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
                  {summary.total === 1 ? (
                    <T>Repository cloned</T>
                  ) : (
                    <T>
                      Cloned <Var>{summary.doneCount}</Var> repositories
                    </T>
                  )}
                </>
              )}
            </span>
          </DialogTitle>
          <DialogDescription>
            {!summary.isComplete ? (
              <T>
                You can keep this window open to monitor progress, or close it to continue browsing
                while clones finish in the background.
              </T>
            ) : (
              <T>Completed repositories are registered as T3 Code projects and ready to open.</T>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="flex w-full min-w-0 flex-col gap-4">
            {/* Overall batch progress bar + counters */}
            <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {summary.runningCount > 0 ? (
                    <Badge size="sm" variant="secondary">
                      <T>
                        <Var>{summary.runningCount}</Var> running
                      </T>
                    </Badge>
                  ) : null}
                  {summary.doneCount > 0 ? (
                    <Badge size="sm" variant="success">
                      <T>
                        <Var>{summary.doneCount}</Var> completed
                      </T>
                    </Badge>
                  ) : null}
                  {summary.failedCount > 0 ? (
                    <Badge size="sm" variant="error">
                      <T>
                        <Var>{summary.failedCount}</Var> failed
                      </T>
                    </Badge>
                  ) : null}
                  {summary.cancelledCount > 0 ? (
                    <Badge size="sm" variant="outline">
                      <T>
                        <Var>{summary.cancelledCount}</Var> cancelled
                      </T>
                    </Badge>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {summary.overallPercent}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    summary.isComplete && summary.failedCount > 0 ? "bg-destructive" : "bg-primary",
                  )}
                  style={{
                    width: `${Math.max(summary.overallPercent, summary.isComplete ? 100 : 4)}%`,
                  }}
                />
              </div>
            </div>

            {/* Per-repository progress items */}
            <div className="max-h-80 w-full min-w-0 overflow-x-hidden overflow-y-auto pr-0.5">
              <div className="flex w-full min-w-0 flex-col gap-2.5">
                {summary.items.map((entry) => {
                  const { item, status, clone, project, percent, error } = entry;
                  const progressText =
                    status === "running"
                      ? clone
                        ? projectCloneProgressSummary(clone, m)
                        : gt("Starting clone…")
                      : null;
                  const folderPath = project?.workspaceRoot ?? item.destinationPath;

                  return (
                    <div
                      key={`${environmentId}:${item.key}`}
                      className="flex w-full min-w-0 shrink-0 flex-col gap-2 rounded-lg border border-border/80 bg-background/80 p-3"
                    >
                      <div className="flex w-full min-w-0 items-start justify-between gap-3">
                        <div className="flex w-0 min-w-0 flex-1 items-start gap-2.5">
                          <div className="pt-0.5">
                            {status === "running" ? (
                              <Spinner className="size-4" />
                            ) : status === "done" ? (
                              <CheckCircle2Icon className="size-4 text-success-foreground" />
                            ) : status === "cancelled" ? (
                              <XCircleIcon className="size-4 text-muted-foreground" />
                            ) : (
                              <AlertCircleIcon className="size-4 text-destructive" />
                            )}
                          </div>
                          <div className="flex w-0 min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="max-w-full truncate text-sm font-medium text-foreground">
                                {item.repo.name}
                              </span>
                              <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
                                {item.repo.pathWithNamespace}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                              <FolderIcon className="size-3 shrink-0" />
                              <span className="flex w-0 min-w-0 flex-1 font-mono">
                                <MiddleTruncate showTitle={false} value={folderPath} />
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {status === "running" && item.projectId ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => void onCancelClone(item.projectId!)}
                            >
                              <XIcon className="size-3.5" />
                              <T>Cancel</T>
                            </Button>
                          ) : status === "done" ? (
                            <>
                              {project ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  onClick={() => {
                                    onOpenChange(false);
                                    void onOpenProject(project.id);
                                  }}
                                >
                                  <MessageSquarePlusIcon className="size-3.5" />
                                  <T>Open</T>
                                </Button>
                              ) : null}
                              {canOpenLocalFolder ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  onClick={() => void onOpenLocalFolder(folderPath)}
                                >
                                  <FolderOpenIcon className="size-3.5" />
                                  <T>Open folder</T>
                                </Button>
                              ) : null}
                            </>
                          ) : (status === "failed" || status === "cancelled") &&
                            item.projectId &&
                            clone ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => void onRetryClone(item.projectId!)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                              <T>Retry</T>
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {status === "running" ? (
                        <div className="flex min-w-0 flex-col gap-1.5 pl-6">
                          <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="w-0 min-w-0 flex-1 truncate">{progressText}</span>
                            {percent !== null ? (
                              <span className="shrink-0 font-mono text-2xs tabular-nums">
                                {percent}%
                              </span>
                            ) : null}
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full bg-primary transition-all duration-300",
                                percent === null && "animate-pulse",
                              )}
                              style={{ width: `${percent ?? 18}%` }}
                            />
                          </div>
                        </div>
                      ) : status === "done" ? (
                        <p className="pl-6 text-xs text-muted-foreground">
                          <T>Cloned and registered as a project.</T>
                        </p>
                      ) : status === "cancelled" ? (
                        <p className="pl-6 text-xs text-muted-foreground">
                          <T>Clone cancelled.</T>
                        </p>
                      ) : (
                        <p className="pl-6 text-xs wrap-anywhere text-destructive">
                          {error ?? gt("Clone failed.")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {!summary.isComplete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void onCancelAllRunning()}
                >
                  <XIcon className="size-3.5" />
                  <T>Cancel all</T>
                </Button>
              ) : summary.total > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClearList();
                    onOpenChange(false);
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                  <T>Clear list</T>
                </Button>
              ) : null}
            </div>

            <Button type="button" onClick={() => onOpenChange(false)}>
              {summary.isComplete ? <T>Done</T> : <T>Run in background</T>}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
