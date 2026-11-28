import type {
  EnvironmentId,
  IssueAutomationRemoteIssueDetail,
  IssueAutomationSyncRepairAction,
  IssueAutomationTask,
} from "@t3tools/contracts";
import { formatIssueAutomationWriteBackComment } from "@t3tools/shared/issueAutomationWriteBack";
import { T, useGT } from "gt-react";
import { CheckCircle2Icon, MessageSquareIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function IssueAutomationRepairSyncDialog({
  task,
  report,
  detail,
  environmentId,
  cwd,
  writingBack,
  supportsComment,
  supportsResolve,
  onSync,
}: {
  readonly task: IssueAutomationTask;
  readonly report: string;
  readonly detail: IssueAutomationRemoteIssueDetail | null;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly writingBack: boolean;
  readonly supportsComment: boolean;
  readonly supportsResolve: boolean;
  readonly onSync: (action: IssueAutomationSyncRepairAction) => Promise<boolean>;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(false);
  const [resolve, setResolve] = useState(false);
  const [buildId, setBuildId] = useState<string | null>(null);
  const writeComment = supportsComment && comment && task.commentSyncedAt === null;
  const canResolve =
    supportsResolve &&
    detail?.status === "active" &&
    task.stateSyncedAt === null &&
    detail.availableBuilds.length > 0;
  const build =
    resolve && canResolve ? detail.availableBuilds.find((item) => item.id === buildId) : undefined;
  const canSubmit = (writeComment || build !== undefined) && (!resolve || build !== undefined);

  const submit = async () => {
    if (!canSubmit || writingBack) return;
    if (
      await onSync({
        kind: "sync_repair",
        taskId: task.id,
        writeComment,
        ...(build ? { resolvedBuild: build.id } : {}),
      })
    )
      setOpen(false);
  };

  if (task.commentSyncedAt !== null && task.stateSyncedAt !== null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5 text-success" />
        {gt("Synced to ZenTao")}
      </span>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (writingBack) return;
        if (next) {
          setComment(false);
          setResolve(false);
          setBuildId(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="xs" />}>
        <SendIcon className="size-3" />
        <T>Sync repair to ZenTao</T>
      </DialogTrigger>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <T>Sync repair to ZenTao</T>
          </DialogTitle>
          <DialogDescription>
            {task.displayKey}
            {detail ? ` · ${detail.statusLabel}` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <div className="rounded-lg border border-border/70 bg-card/40 p-3 transition-colors hover:border-border">
              <div className="flex items-center justify-between gap-2.5">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={writeComment}
                    onCheckedChange={setComment}
                    disabled={writingBack || !supportsComment || task.commentSyncedAt !== null}
                  />
                  <span className="text-sm font-medium text-foreground">
                    <T>Write repair comment</T>
                  </span>
                </label>
                {task.commentSyncedAt ? (
                  <Badge variant="outline" size="sm">
                    <T>Synced</T>
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-card/40 p-3 transition-colors hover:border-border space-y-3">
              <div className="flex items-center justify-between gap-2.5">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={resolve}
                    onCheckedChange={setResolve}
                    disabled={writingBack || (!canResolve && !resolve)}
                  />
                  <span className="text-sm font-medium text-foreground">
                    <T>Mark as resolved</T>
                  </span>
                </label>
                {task.stateSyncedAt ? (
                  <Badge variant="outline" size="sm">
                    <T>Synced</T>
                  </Badge>
                ) : null}
              </div>
              {resolve && canResolve ? (
                <div className="pt-1 ps-6 space-y-2">
                  <Select value={buildId} onValueChange={setBuildId} disabled={writingBack}>
                    <SelectTrigger size="sm" aria-label={gt("Resolved build")}>
                      <SelectValue placeholder={gt("Select the resolved build")}>
                        {build?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {detail.availableBuilds.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  {build ? (
                    <p className="text-xs text-muted-foreground">
                      {gt("Bug will be marked as resolved in {build}.", { build: build.name })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {writeComment ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <MessageSquareIcon className="size-3.5 text-muted-foreground" />
                  <span>
                    <T>Comment preview</T>
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border/40 bg-background/80 p-2.5 text-xs">
                  <PullRequestMarkdown
                    text={formatIssueAutomationWriteBackComment(report)}
                    cwd={cwd}
                    environmentId={environmentId}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={writingBack} />}>
            <T>Cancel</T>
          </DialogClose>
          <Button disabled={!canSubmit || writingBack} onClick={() => void submit()}>
            <T>Confirm sync</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
