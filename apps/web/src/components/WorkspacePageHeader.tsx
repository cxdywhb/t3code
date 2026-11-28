import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "./WorkspaceBreadcrumb";

export function WorkspacePageHeader({
  electron = false,
  reserveNativeControls = electron,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
  readonly reserveNativeControls?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)]! min-h-[var(--workspace-topbar-height)]! max-h-[var(--workspace-topbar-height)]! shrink-0 items-center gap-3 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left,padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        electron && "drag-region",
        reserveNativeControls && "wco:pr-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export function WorkspacePageTitle({
  ariaLabel,
  children,
}: {
  readonly ariaLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceBreadcrumb ariaLabel={ariaLabel}>
      <WorkspaceBreadcrumbItem current>
        <h1 className="truncate">{children}</h1>
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

export const WORKSPACE_TAB_PANEL_CLASS =
  "transition-[opacity,translate] duration-180 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none";

export const WORKSPACE_BAR_ENTER_CLASS =
  "transition-[opacity,translate] duration-180 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none";

export function WorkspacePageToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-background py-2 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)">
      {children}
    </div>
  );
}
