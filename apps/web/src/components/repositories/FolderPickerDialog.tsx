import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import { normalizeProjectPathForDispatch } from "@t3tools/shared/path";
import { T, useGT, Var } from "gt-react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

import { getEnvironmentBrowsePlatform } from "~/components/CommandPalette.logic";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildFolderBreadcrumbs } from "./repositoriesPage.logic";

const MAX_VISIBLE_FOLDERS = 250;

export interface FolderPickerRequest {
  readonly initialPath?: string;
  readonly title?: string;
  readonly description?: string;
  readonly onSelect: (pickedPath: string) => void;
}

/**
 * Unified folder picker for an environment:
 * - In Desktop (Electron) targeting a local environment, invokes the native OS folder dialog.
 * - In Web browsers or remote environments, opens the visual `FolderPickerDialog` powered by
 *   `filesystem.browse` so users never have to type paths manually.
 */
export function useEnvironmentFolderPicker(environmentId: EnvironmentId | null) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const browseAccess = useFilesystemReadAccess(environmentId);
  const [dialogRequest, setDialogRequest] = useState<FolderPickerRequest | null>(null);
  const [dialogSession, setDialogSession] = useState(0);

  const environment = environments.find((item) => item.environmentId === environmentId) ?? null;
  const isDesktopLocal =
    environment !== null && isDesktopLocalConnectionTarget(environment.entry.target);
  const canUseNativePicker =
    isElectron &&
    environmentId !== null &&
    readLocalApi() !== undefined &&
    (environmentId === primaryEnvironmentId || isDesktopLocal);

  const canPickFolder =
    canUseNativePicker ||
    (environmentId !== null && (browseAccess.canReadFiles || browseAccess.isPending));

  const resolveDesktopTargetId = (): string | undefined => {
    if (!isDesktopLocal || environment === null || !environment.displayUrl) {
      return undefined;
    }
    try {
      const bootstraps = window.desktopBridge?.getLocalEnvironmentBootstraps() ?? [];
      return bootstraps.find((item) => item.httpBaseUrl === environment.displayUrl)?.id;
    } catch {
      return undefined;
    }
  };

  const openFolderPicker = async (request: FolderPickerRequest) => {
    if (canUseNativePicker) {
      const api = readLocalApi();
      if (api) {
        const targetEnvironmentId = resolveDesktopTargetId();
        const initialPath = request.initialPath?.trim();
        const options = {
          ...(initialPath ? { initialPath } : {}),
          ...(targetEnvironmentId ? { targetEnvironmentId } : {}),
        };
        const picked = await api.dialogs
          .pickFolder(Object.keys(options).length > 0 ? options : undefined)
          .catch(() => null);
        if (picked) {
          request.onSelect(picked);
        }
        return;
      }
    }

    if (environmentId === null) return;
    setDialogSession((current) => current + 1);
    setDialogRequest(request);
  };

  const closeDialog = () => setDialogRequest(null);

  return {
    canPickFolder,
    canUseNativePicker,
    openFolderPicker,
    dialogProps:
      dialogRequest && environmentId
        ? {
            key: dialogSession,
            environmentId,
            platform: getEnvironmentBrowsePlatform(
              environment?.serverConfig?.environment.platform.os,
            ),
            canBrowse: browseAccess.canReadFiles,
            accessPending: browseAccess.isPending,
            request: dialogRequest,
            onClose: closeDialog,
          }
        : null,
  };
}

export function FolderPickerDialog({
  environmentId,
  platform,
  canBrowse,
  accessPending,
  request,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly platform: string;
  readonly canBrowse: boolean;
  readonly accessPending: boolean;
  readonly request: FolderPickerRequest;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const [currentDir, setCurrentDir] = useState<string>(() => {
    const trimmed = request.initialPath?.trim() ?? "";
    return trimmed.length > 0 ? ensureBrowseDirectoryPath(trimmed) : "~/";
  });
  const [hasNavigated, setHasNavigated] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const primaryBrowse = getFilesystemBrowsePath(currentDir, platform, canBrowse);
  const primaryQuery = useEnvironmentQuery(
    primaryBrowse.isBrowsing && primaryBrowse.directoryPath.length > 0
      ? filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: primaryBrowse.directoryPath },
        })
      : null,
  );

  // If the initial target folder does not exist yet on disk (for example before first clone),
  // automatically walk up to its parent directory or home so the picker opens directly into
  // real folders without showing a dead-end error.
  const parentFallbackDir =
    !hasNavigated && primaryQuery.error !== null ? (getBrowseParentPath(currentDir) ?? "~/") : null;
  const parentFallbackQuery = useEnvironmentQuery(
    canBrowse && parentFallbackDir !== null && parentFallbackDir !== currentDir
      ? filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: ensureBrowseDirectoryPath(parentFallbackDir) },
        })
      : null,
  );

  const homeFallbackActive =
    !hasNavigated &&
    parentFallbackDir !== null &&
    parentFallbackDir !== "~/" &&
    parentFallbackQuery.error !== null;
  const homeFallbackQuery = useEnvironmentQuery(
    canBrowse && homeFallbackActive
      ? filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: "~/" },
        })
      : null,
  );

  const activeData =
    primaryQuery.data ?? parentFallbackQuery.data ?? homeFallbackQuery.data ?? null;
  const activeError =
    activeData !== null
      ? null
      : homeFallbackActive
        ? homeFallbackQuery.error
        : parentFallbackDir !== null
          ? parentFallbackQuery.error
          : primaryQuery.error;
  const isLoading =
    accessPending ||
    (activeData === null &&
      (primaryQuery.isPending || parentFallbackQuery.isPending || homeFallbackQuery.isPending));

  const resolvedCurrentPath = activeData?.parentPath
    ? ensureBrowseDirectoryPath(activeData.parentPath)
    : currentDir;
  const parentPath = getBrowseParentPath(resolvedCurrentPath);
  const breadcrumbs = buildFolderBreadcrumbs(resolvedCurrentPath);

  const rawEntries = activeData?.entries ?? [];
  const entriesWithVisibility = showHidden
    ? rawEntries
    : rawEntries.filter((entry) => !entry.name.startsWith("."));
  const { visibleEntries } = filterFilesystemBrowseEntries(
    entriesWithVisibility,
    filterText.trim(),
  );
  const displayedEntries = visibleEntries.slice(0, MAX_VISIBLE_FOLDERS);
  const hiddenOverflowCount = Math.max(0, visibleEntries.length - displayedEntries.length);

  const navigateTo = (nextDirectory: string) => {
    setHasNavigated(true);
    setCurrentDir(ensureBrowseDirectoryPath(nextDirectory));
    setFilterText("");
  };

  const enterSubfolder = (entryName: string, fullPath: string) => {
    const target = fullPath.trim()
      ? ensureBrowseDirectoryPath(fullPath)
      : appendBrowsePathSegment(resolvedCurrentPath, entryName);
    navigateTo(target);
  };

  const chosenPath = normalizeProjectPathForDispatch(resolvedCurrentPath);

  const handleConfirm = () => {
    if (!chosenPath) return;
    request.onSelect(chosenPath);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{request.title ?? gt("Choose folder")}</DialogTitle>
          <DialogDescription>
            {request.description ??
              gt("Click a subfolder to open it, then confirm the current directory below.")}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="flex w-full min-w-0 flex-col gap-3">
            {/* Navigation controls + wrapping clickable breadcrumbs (zero horizontal overflow) */}
            <div className="flex w-full min-w-0 items-start gap-1.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={gt("Go to home folder")}
                      onClick={() => navigateTo("~/")}
                    >
                      <HomeIcon className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  <T>Home folder (~)</T>
                </TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      disabled={parentPath === null}
                      aria-label={gt("Go to parent folder")}
                      onClick={() => {
                        if (parentPath) navigateTo(parentPath);
                      }}
                    >
                      <ArrowUpIcon className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  <T>Parent folder</T>
                </TooltipPopup>
              </Tooltip>

              <div className="flex min-h-8 w-0 min-w-0 flex-1 flex-wrap items-center gap-0.5 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs">
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <div key={crumb.path} className="flex max-w-full min-w-0 items-center gap-0.5">
                      {idx > 0 ? (
                        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => navigateTo(crumb.path)}
                        className={cn(
                          "max-w-full cursor-pointer truncate rounded px-1 py-0.5 transition-colors hover:bg-accent/70",
                          isLast ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {crumb.label}
                      </button>
                    </div>
                  );
                })}
              </div>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant={showHidden ? "secondary" : "outline"}
                      aria-label={showHidden ? gt("Hide dot folders") : gt("Show hidden folders")}
                      onClick={() => setShowHidden((prev) => !prev)}
                    >
                      {showHidden ? (
                        <EyeIcon className="size-3.5" />
                      ) : (
                        <EyeOffIcon className="size-3.5" />
                      )}
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  {showHidden ? <T>Hide dot folders</T> : <T>Show hidden folders</T>}
                </TooltipPopup>
              </Tooltip>
            </div>

            {/* Filter within current folder */}
            <div className="w-full min-w-0">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon className="size-3.5 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  size="sm"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder={gt("Filter folders in this directory…")}
                />
              </InputGroup>
            </div>

            {/* Folder list: single-click immediately opens subfolders */}
            <div className="max-h-72 min-h-60 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background/60 p-1.5">
              {!canBrowse && !accessPending ? (
                <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  <T>This connection does not have permission to browse folders.</T>
                </div>
              ) : isLoading ? (
                <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <T>Loading folders…</T>
                </div>
              ) : activeError ? (
                <div className="flex h-56 flex-col items-center justify-center gap-3 px-4 text-center">
                  <p className="text-sm wrap-anywhere text-muted-foreground">{activeError}</p>
                  <div className="flex items-center gap-2">
                    {parentPath ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => navigateTo(parentPath)}
                      >
                        <ArrowUpIcon className="size-3.5" />
                        <T>Parent folder</T>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => navigateTo("~/")}
                    >
                      <HomeIcon className="size-3.5" />
                      <T>Go to home (~)</T>
                    </Button>
                  </div>
                </div>
              ) : displayedEntries.length === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center gap-1.5 px-4 text-center text-sm text-muted-foreground">
                  <FolderOpenIcon className="size-5 opacity-60" />
                  {filterText.trim() ? (
                    <T>No matching subfolders.</T>
                  ) : (
                    <T>No subfolders here. Click below to select this directory.</T>
                  )}
                </div>
              ) : (
                <ul className="flex w-full min-w-0 flex-col gap-0.5">
                  {displayedEntries.map((entry) => (
                    <li key={entry.fullPath} className="min-w-0 shrink-0">
                      <button
                        type="button"
                        onClick={() => enterSubfolder(entry.name, entry.fullPath)}
                        className="group flex min-h-9 w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                        <span className="w-0 min-w-0 flex-1 truncate">{entry.name}</span>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {hiddenOverflowCount > 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  <T>
                    <Var>{hiddenOverflowCount}</Var> more folders. Use the filter above to narrow
                    the list.
                  </T>
                </p>
              ) : null}
            </div>

            {/* Current directory summary */}
            <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs">
              <span className="shrink-0 text-muted-foreground">
                <T>Current folder:</T>
              </span>
              <span className="flex w-0 min-w-0 flex-1 font-mono text-foreground">
                <MiddleTruncate showTitle={false} value={chosenPath} />
              </span>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button type="button" disabled={!chosenPath} onClick={handleConfirm}>
            <CheckIcon className="size-3.5" />
            <T>Select this directory</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
