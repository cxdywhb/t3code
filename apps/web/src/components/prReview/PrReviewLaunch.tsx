import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  PrReviewMode,
  PrReviewTargetItem,
  PrReviewTask,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useFavoriteReviewSkills, usePrReviewLiveState } from "~/state/prReview";
import { buildThreadRouteParams } from "~/threadRoutes";
import { LaunchPrReviewDialog } from "./PrReviewLaunchModal";

export function PrReviewLaunch({
  environmentId,
  mode,
  targets,
  onClose,
  onFusionStarted,
}: {
  environmentId: EnvironmentId;
  mode: PrReviewMode;
  targets: ReadonlyArray<PrReviewTargetItem>;
  onClose: () => void;
  onFusionStarted: (tasks: ReadonlyArray<PrReviewTask>) => void;
}) {
  const navigate = useNavigate();
  const [favoriteSkills] = useFavoriteReviewSkills(environmentId);
  const { snapshot } = usePrReviewLiveState(environmentId);
  return (
    <LaunchPrReviewDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      environmentId={environmentId}
      targets={targets}
      presets={snapshot.presets}
      availableSkills={favoriteSkills}
      defaultMode={mode}
      onLaunched={({ jumpThreadId, mode, tasks }) => {
        if (mode === "direct_agent" && jumpThreadId) {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(environmentId, jumpThreadId as ThreadId)),
          });
        } else {
          onFusionStarted(tasks);
        }
      }}
    />
  );
}
