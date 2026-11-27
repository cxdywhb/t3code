import type {
  EnvironmentId,
  IssueAutomationRemoteIssueDetail,
  IssueAutomationSyncRepairAction,
  IssueAutomationTask,
} from "@t3tools/contracts";
import { formatIssueAutomationWriteBackComment } from "@t3tools/shared/issueAutomationWriteBack";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
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
    return <span className="text-xs text-muted-foreground">{gt("Synced to ZenTao")}</span>;
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
        <T>Sync repair to ZenTao</T>
      </DialogTrigger>
      <DialogPopup>
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
            <label className="flex items-center gap-2">
              <Checkbox
                checked={writeComment}
                onCheckedChange={setComment}
                disabled={writingBack || !supportsComment || task.commentSyncedAt !== null}
              />
              <T>Write repair comment</T>
              {task.commentSyncedAt ? (
                <span className="text-xs text-muted-foreground">
                  <T>Synced</T>
                </span>
              ) : null}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={resolve}
                onCheckedChange={setResolve}
                disabled={writingBack || (!canResolve && !resolve)}
              />
              <T>Mark as resolved</T>
              {task.stateSyncedAt ? (
                <span className="text-xs text-muted-foreground">
                  <T>Synced</T>
                </span>
              ) : null}
            </label>
            {resolve && canResolve ? (
              <Select value={buildId} onValueChange={setBuildId} disabled={writingBack}>
                <SelectTrigger aria-label={gt("Resolved build")}>
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
            ) : null}
            {build ? (
              <p className="text-sm">
                {gt("Bug will be marked as resolved in {build}.", { build: build.name })}
              </p>
            ) : null}
            {writeComment ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-sm font-medium">
                  <T>Comment preview</T>
                </p>
                <PullRequestMarkdown
                  text={formatIssueAutomationWriteBackComment(report)}
                  cwd={cwd}
                  environmentId={environmentId}
                />
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
