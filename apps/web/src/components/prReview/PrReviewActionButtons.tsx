import type { PrReviewMode } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ShieldCheckIcon, ZapIcon } from "lucide-react";

import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

export function PrReviewActionButtons({ onLaunch }: { onLaunch: (mode: PrReviewMode) => void }) {
  const gt = useGT();
  const agent = gt("Agent Review");
  const fusion = gt("Fusion Review");
  return (
    <div className="flex shrink-0 items-center gap-1">
      <SharedTooltipTrigger
        label={agent}
        render={
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={agent}
            onClick={() => onLaunch("direct_agent")}
          >
            <ZapIcon aria-hidden />
          </Button>
        }
      />
      <SharedTooltipTrigger
        label={fusion}
        render={
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={fusion}
            onClick={() => onLaunch("multi_model_fusion")}
          >
            <ShieldCheckIcon aria-hidden />
          </Button>
        }
      />
    </div>
  );
}
