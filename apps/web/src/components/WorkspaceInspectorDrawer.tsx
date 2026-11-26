import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { usePanelAnimationSettings, usePanelPresence } from "~/panelAnimations";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function WorkspaceInspectorDrawer({
  open,
  scopeKey,
  width,
  expanded = false,
  expandedWidth = "min(84vw, 1320px)",
  isResizing,
  resizeLabel,
  resizeTooltip,
  onResizePointerDown,
  onResizeKeyDown,
  onResizeDoubleClick,
  children,
}: {
  readonly open: boolean;
  readonly scopeKey: string | null;
  readonly width: number;
  readonly expanded?: boolean;
  readonly expandedWidth?: string;
  readonly isResizing: boolean;
  readonly resizeLabel: string;
  readonly resizeTooltip?: ReactNode;
  readonly onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onResizeKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  readonly onResizeDoubleClick?: () => void;
  readonly children: ReactNode;
}) {
  const { active: panelAnimationsActive, durationMs } = usePanelAnimationSettings();
  const presence = usePanelPresence(open, children, panelAnimationsActive, scopeKey, durationMs);
  if (!presence.present) return null;

  const targetWidth = expanded ? expandedWidth : `${String(width)}px`;
  const handle = (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={resizeLabel}
      onPointerDown={onResizePointerDown}
      onKeyDown={onResizeKeyDown}
      onDoubleClick={onResizeDoubleClick}
      className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none select-none focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150",
          isResizing
            ? "bg-primary"
            : "bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary",
        )}
      />
    </div>
  );

  return (
    <aside
      inert={!open}
      className={cn(
        "relative hidden h-full min-h-0 shrink-0 border-l border-border/60 bg-background lg:flex [[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:ease-out",
        open ? "[[data-panel-animations=true]_&]:starting:w-0!" : "pointer-events-none",
      )}
      style={{
        width: !open ? "0px" : targetWidth,
        transitionDuration: isResizing ? "0ms" : undefined,
      }}
    >
      {resizeTooltip ? (
        <Tooltip>
          <TooltipTrigger render={handle} />
          <TooltipPopup side="left">{resizeTooltip}</TooltipPopup>
        </Tooltip>
      ) : (
        handle
      )}
      <div className="flex h-full min-h-0 w-full justify-end overflow-clip">
        <div
          className="flex h-full min-h-0 min-w-0 shrink-0 flex-col"
          style={{ width: targetWidth }}
        >
          {presence.value}
        </div>
      </div>
    </aside>
  );
}
