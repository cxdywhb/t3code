import type { EnvironmentId, PrReviewMode, PrReviewTargetItem, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { prReviewTargetKey, usePrReviewLiveState } from "~/state/prReview";
import { PrReviewActionButtons } from "./PrReviewActionButtons";
import { PrReviewInspector } from "./PrReviewInspector";

export function PrReviewDetailTab({
  environmentId,
  target,
  headSha,
  cwd,
  onLaunch,
  onJumpToThread,
}: {
  environmentId: EnvironmentId;
  target: PrReviewTargetItem;
  headSha: string | null;
  cwd: string;
  onLaunch: ((mode: PrReviewMode) => void) | undefined;
  onJumpToThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const [choice, setChoice] = useState<{
    readonly id: string;
    readonly latestId: string | undefined;
  } | null>(null);
  const { snapshot, isPending, error, refresh } = usePrReviewLiveState(environmentId);
  const targetKey = prReviewTargetKey(target);
  const tasks = snapshot.tasks
    .filter((task) => prReviewTargetKey(task) === targetKey)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestId = tasks[0]?.id;
  const chosenTask =
    choice && choice.latestId === latestId
      ? tasks.find((task) => task.id === choice.id)
      : undefined;
  const selectedTask = chosenTask ?? tasks[0];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        {tasks.length > 0 ? (
          <Select
            value={chosenTask?.id ?? ""}
            onValueChange={(value) => setChoice(value ? { id: value, latestId } : null)}
          >
            <SelectTrigger aria-label={gt("Review runs")}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">
                <T>Latest run</T>
              </SelectItem>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {new Date(task.createdAt).toLocaleString()}
                  {task.headSha ? ` · ${task.headSha.slice(0, 7)}` : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <span />
        )}
        {onLaunch ? (
          <PrReviewActionButtons
            onLaunch={(mode) => {
              setChoice(null);
              onLaunch(mode);
            }}
          />
        ) : null}
      </div>
      {error ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        >
          <span>{error}</span>
          <Button size="xs" variant="outline" onClick={refresh}>
            <T>Retry</T>
          </Button>
        </div>
      ) : null}
      {selectedTask ? (
        <>
          {selectedTask.headSha && headSha && selectedTask.headSha !== headSha ? (
            <p role="status" className="border-b px-3 py-2 text-xs text-warning">
              <T>This report covers an earlier commit.</T>
            </p>
          ) : null}
          <div className="min-h-0 flex-1">
            <PrReviewInspector
              key={selectedTask.id}
              environmentId={environmentId}
              task={selectedTask}
              cwd={cwd}
              onJumpToThread={onJumpToThread}
            />
          </div>
        </>
      ) : (
        <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
          {isPending ? <T>Loading…</T> : <T>No review runs yet.</T>}
        </p>
      )}
    </div>
  );
}
