import { useAtomValue } from "@effect/atom-react";
import type { PrReviewMode } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { FileTextIcon } from "lucide-react";

import { latestPrReviewAtom, prReviewEnvironment, prReviewTargetKey } from "~/state/prReview";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { PrReviewActionButtons } from "./PrReviewActionButtons";
import { PrReviewStageBadge, PrReviewVerdictBadge } from "./PrReviewInspector";

export function PrReviewRowControls({
  entry,
  onLaunch,
  onOpenReport,
}: {
  entry: EnvironmentPullRequestEntry;
  onLaunch: (mode: PrReviewMode) => void;
  onOpenReport: () => void;
}) {
  const gt = useGT();
  const task = useAtomValue(
    latestPrReviewAtom(`${entry.environmentId}\n${prReviewTargetKey(entry)}`),
  );
  const canStart = useAtomValue(
    prReviewEnvironment.startReview.permissionAtom(entry.environmentId),
  );
  const reportLabel = gt("Report");
  if (!canStart && !task) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 pr-2">
      {task ? (
        <SharedTooltipTrigger
          label={
            <>
              <PrReviewStageBadge stage={task.stage} />
              <PrReviewVerdictBadge verdict={task.verdict} />
            </>
          }
          render={
            <Button size="icon-xs" variant="ghost" aria-label={reportLabel} onClick={onOpenReport}>
              <FileTextIcon aria-hidden />
            </Button>
          }
        />
      ) : null}
      {canStart ? <PrReviewActionButtons onLaunch={onLaunch} /> : null}
    </div>
  );
}
