import type { PullRequestInvolvement, PullRequestListState } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { Plug2Icon, SearchIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { RefreshIcon } from "../ui/refresh-icon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader, WorkspacePageTitle } from "../WorkspacePageHeader";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { PullRequestCompactFilterMenu } from "./PullRequestCompactFilterMenu";
import type { PullRequestFilterOption } from "./PullRequestListFilters";
import { INVOLVEMENT_TABS, resolveFilterOptions, STATE_TABS } from "./pullRequestListOptions";

function ExpandableSearch({
  searchInput,
  searchValue,
  open,
  onOpenChange,
}: {
  searchInput: ReactNode;
  searchValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const expanded = open || searchValue.length > 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the search input DOM node when the topbar search opens
  useEffect(() => {
    const container = containerRef.current;
    if (open && container && !container.contains(document.activeElement)) {
      container.querySelector("input")?.focus();
    }
  }, [open]);
  return (
    <div
      className={cn(
        "relative flex min-w-0 shrink items-center transition-[width] duration-180 ease-out motion-reduce:transition-none",
        expanded ? "w-64" : "w-8 sm:w-7",
      )}
    >
      <div
        ref={containerRef}
        inert={!expanded}
        className={cn(
          "min-w-0 flex-1 overflow-hidden transition-opacity duration-150 ease-out motion-reduce:transition-none",
          expanded ? "opacity-100" : "opacity-0",
        )}
        onFocus={() => onOpenChange(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
        }}
      >
        {searchInput}
      </div>
      <div
        inert={expanded}
        className={cn(
          "absolute end-0 flex transition-opacity duration-150 ease-out motion-reduce:transition-none",
          expanded ? "opacity-0" : "opacity-100",
        )}
      >
        <SharedTooltipTrigger
          label={gt("Search pull requests")}
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={gt("Search pull requests")}
              onClick={() => onOpenChange(true)}
            >
              <SearchIcon aria-hidden />
            </Button>
          }
        />
      </div>
    </div>
  );
}

export function PullRequestsColumn({
  refreshing,
  onRefresh,
  searchValue,
  involvement,
  state,
  host,
  hostMenuOptions,
  onInvolvement,
  onState,
  onHost,
  searchInput,
  sortMenu,
  filtersMenu,
  savedViewsMenu,
  reviewControls,
  rightPanelControl,
  titlebarControls,
  rightPanelOpen,
  maximizedAway,
  listBody,
  scrollRef,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  searchValue: string;
  involvement: PullRequestInvolvement;
  state: PullRequestListState;
  host: string | undefined;
  hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  onState: (state: PullRequestListState) => void;
  onHost: (host: string | undefined) => void;
  searchInput: ReactNode;
  sortMenu: ReactNode;
  filtersMenu: ReactNode;
  savedViewsMenu: ReactNode;
  reviewControls?: ReactNode;
  rightPanelControl: ReactNode;
  titlebarControls: ReactNode;
  rightPanelOpen: boolean;
  maximizedAway: boolean;
  listBody: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const contentArea = workspaceAreaProps("pull-requests", 1, gt("Pull requests"));
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- IntersectionObserver on the scroll marker condenses the topbar
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry ? !entry.isIntersecting : false),
      { root: scrollRef.current },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [scrollRef]);
  const [searchOpen, setSearchOpen] = useState(false);
  const topbarSearchRef = useRef<HTMLDivElement | null>(null);
  const searchExpanded = searchOpen || searchValue.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener focuses the visible search input on Cmd/Ctrl+F
  useEffect(() => {
    if (maximizedAway) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      setSearchOpen(true);
      const input = topbarSearchRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximizedAway]);

  return (
    <div
      {...contentArea}
      inert={maximizedAway}
      className={cn(
        "@container/pr-list flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-background",
        maximizedAway ? "w-0 flex-none" : "flex-1",
      )}
    >
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={!rightPanelOpen}
        className="relative bg-background"
      >
        {condensed ? (
          <WorkspaceBreadcrumb
            ariaLabel={gt("Pull request scope")}
            className={cn(
              "overflow-hidden transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
              searchExpanded && "@max-sm/pr-list:sr-only",
            )}
          >
            <WorkspaceBreadcrumbItem current className={cn(searchExpanded && "sr-only")}>
              <h1 className="truncate">
                <T>Pull requests</T>
              </h1>
            </WorkspaceBreadcrumbItem>
            {searchExpanded ? null : <WorkspaceBreadcrumbSeparator />}
            <WorkspaceBreadcrumbItem className="shrink gap-1.5">
              <PullRequestCompactFilterMenu
                label={gt("Filter by state")}
                value={state}
                options={resolveFilterOptions(STATE_TABS, resolve)}
                onChange={onState}
                className="shrink-0"
              />
              <PullRequestCompactFilterMenu
                label={gt("Filter by involvement")}
                value={involvement}
                options={resolveFilterOptions(INVOLVEMENT_TABS, resolve)}
                onChange={onInvolvement}
              />
              {hostMenuOptions.length > 2 ? (
                <PullRequestCompactFilterMenu
                  label={gt("Filter by host")}
                  value={host ?? ""}
                  options={hostMenuOptions}
                  onChange={(next) => onHost(next === "" ? undefined : next)}
                />
              ) : null}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        ) : (
          <div className={cn("min-w-0", searchExpanded && "@max-sm/pr-list:sr-only")}>
            <WorkspacePageTitle ariaLabel={gt("Pull requests breadcrumb")}>
              <T>Pull requests</T>
            </WorkspacePageTitle>
          </div>
        )}
        <div className="min-w-0 flex-1" />
        <div
          ref={topbarSearchRef}
          className="flex min-w-0 shrink items-center gap-1.5 [-webkit-app-region:no-drag]"
        >
          <ExpandableSearch
            searchInput={searchInput}
            searchValue={searchValue}
            open={searchOpen}
            onOpenChange={setSearchOpen}
          />
          {condensed ? (
            <PullRequestRefreshControl compact refreshing={refreshing} onRefresh={onRefresh} />
          ) : null}
        </div>
        {titlebarControls}
        {rightPanelControl}
      </WorkspacePageHeader>

      <div
        ref={scrollRef}
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      >
        <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <PullRequestCompactFilterMenu
                label={gt("Filter by provider")}
                outlined
                iconOnly={host !== undefined}
                triggerIcon={<Plug2Icon aria-hidden className="size-4" />}
                triggerLabel={gt("Source")}
                value={host ?? ""}
                options={hostMenuOptions}
                onChange={(next) => onHost(next === "" ? undefined : next)}
              />
              <PullRequestCompactFilterMenu
                label={gt("Filter by involvement")}
                outlined
                triggerIcon={<UserRoundIcon aria-hidden className="size-4" />}
                value={involvement}
                options={resolveFilterOptions(INVOLVEMENT_TABS, resolve)}
                onChange={onInvolvement}
              />
              {sortMenu}
              {filtersMenu}
              {savedViewsMenu}
              {reviewControls}
              {!condensed ? (
                <PullRequestRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              ) : null}
            </div>
            <div ref={markerRef} aria-hidden className="-mt-3 h-px w-full" />
          </div>

          {listBody}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

function PullRequestRefreshControl({
  compact = false,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const gt = useGT();
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label={gt("Refresh pull requests")}
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
}
