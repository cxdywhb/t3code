import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  ChartNoAxesColumnIcon,
  FolderGit2Icon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { useIssueAutomationSupported } from "../../state/issueAutomation";
import { usePrReviewSupported } from "../../state/prReview";
import { APP_BASE_NAME } from "../../branding";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { GlobalTerminalButton } from "../terminal/GlobalTerminal";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const gt = useGT();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative grid h-[var(--workspace-topbar-height)] shrink-0 grid-cols-[1fr_auto_1fr] items-center",
        isElectron &&
          "drag-region md:grid-cols-[minmax(0,1fr)_auto] md:pr-9 md:pl-(--workspace-controls-left)",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 col-start-1 row-start-1 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant="ghost"
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      <div
        className={cn(
          "relative z-10 col-start-2 row-start-1 flex flex-col items-center justify-center",
          isElectron && "md:col-start-1",
        )}
      >
        <SidebarBrand />
        {pillLabel ? (
          <Badge data-environment-identification="pill" size="sm" variant="secondary">
            {pillLabel}
          </Badge>
        ) : null}
      </div>
      {isElectron ? (
        <div className="relative z-10 col-start-2 row-start-1 hidden items-center md:flex">
          <HistoryNavigationButton direction="back" onBackdrop={Boolean(backdropVariant)} />
          <HistoryNavigationButton direction="forward" onBackdrop={Boolean(backdropVariant)} />
        </div>
      ) : null}
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
  isElectron,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none invisible fixed top-0 left-0 w-max border-r border-transparent px-(--workspace-titlebar-content-left)",
        isElectron && "md:pl-(--workspace-controls-left) md:pr-27",
      )}
      ref={observeWidth}
    >
      <SidebarBrandMark />
    </div>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <SharedTooltipTrigger
      render={
        <Button
          aria-label={label}
          className={cn(
            "[-webkit-app-region:no-drag]",
            onBackdrop && "relative top-auto translate-y-0",
          )}
          disabled={!enabled}
          onClick={() => navigateHistory(direction)}
          size="icon-sm"
          variant={onBackdrop ? "media-navigation" : "ghost"}
        />
      }
      label={
        <>
          {label}
          {shortcutLabel ? ` (${shortcutLabel})` : ""}
        </>
      }
      side="bottom"
    >
      <Icon className="size-3.5" />
    </SharedTooltipTrigger>
  );
}

function SidebarBrand() {
  return (
    <Link
      aria-label={APP_BASE_NAME}
      className="flex h-6 w-fit items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset [-webkit-app-region:no-drag]"
      to="/"
    >
      <SidebarBrandMark />
    </Link>
  );
}

function SidebarBrandMark() {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
      <span aria-hidden className="shrink-0 font-black italic">
        {"X"}
      </span>
      <span className="truncate text-muted-foreground [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1">
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        {"Code"}
      </span>
    </span>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <SharedTooltipTrigger
        render={
          <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
            {icon}
          </SidebarMenuButton>
        }
        label={label}
      />
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const prReviewSupported = usePrReviewSupported();
  const issueAutomationSupported = useIssueAutomationSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handlePrReviewClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/pr-review" });
  };
  const handleIssueAutomationClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issue-automation" });
  };
  const handleRepositoriesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/repositories" });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      <SidebarMenuItem className="shrink-0">
        <GlobalTerminalButton />
      </SidebarMenuItem>
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>
              <T>Back</T>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label={gt("Settings")}
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label={gt("Pull requests")}
              onClick={handlePullRequestsClick}
            />
          ) : null}
          {prReviewSupported ? (
            <SidebarUtilityItem
              icon={<ShieldCheckIcon />}
              label={gt("PR Cross Review")}
              onClick={handlePrReviewClick}
            />
          ) : null}
          {issueAutomationSupported ? (
            <SidebarUtilityItem
              icon={<BotIcon />}
              label={gt("ZenTao Issue Auto-Analysis")}
              onClick={handleIssueAutomationClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<FolderGit2Icon />}
            label={gt("Repositories")}
            onClick={handleRepositoriesClick}
          />
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label={gt("Usage")}
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
