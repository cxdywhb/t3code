import { projectCloneProgressSummary } from "@t3tools/client-runtime/contract-labels";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { readHostCredentialSettings } from "@t3tools/client-runtime/source-control-clients";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FILESYSTEM_METADATA_BATCH_LIMIT,
  PositiveInt,
  SourceControlProviderKind,
  type EnvironmentId,
  type ProjectId,
  type SourceControlCloneProtocol,
  type SourceControlNamespaceKind,
  type SourceControlRepositorySummary,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison, resolvePastedPath } from "@t3tools/shared/path";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import {
  AlertCircleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useState, type CSSProperties } from "react";

import { GhostBar, PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import { PullRequestSearchInput } from "~/components/pullRequest/PullRequestListFilters";
import { RelativeTime } from "~/components/RelativeTime";
import {
  WORKSPACE_BAR_ENTER_CLASS,
  WORKSPACE_TAB_PANEL_CLASS,
  WorkspacePageHeader,
  WorkspacePageTitle,
  WorkspacePageToolbar,
} from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { m } from "~/i18n/messages";
import { observeResize } from "~/lib/observeResize";
import { cn, newProjectId } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { useProjects, waitForProject } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentProjectClones } from "~/state/projectClones";
import { projectEnvironment } from "~/state/projects";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { shellEnvironment } from "~/state/shell";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Label } from "../ui/label";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CloneProgressDialog } from "./CloneProgressDialog";
import { CloneRepositoriesDialog } from "./CloneRepositoriesDialog";
import { FolderPickerDialog, useEnvironmentFolderPicker } from "./FolderPickerDialog";
import {
  buildNamespaceTree,
  collectExpandableGroupIds,
  computeRepoDestinationPath,
  extractConfiguredGitLabHosts,
  filterNamespaceTree,
  indexLocalRepositories,
  normalizeDestinationKey,
  resolveEffectiveCloneRoot,
  summarizeCloneBatch,
  type ClonePathLayout,
  type NamespaceTreeNode,
  type RepositoryLocalStatusFilter,
  type TrackedCloneBatchItem,
} from "./repositoriesPage.logic";

const GITLAB_KIND = SourceControlProviderKind.make("gitlab");
const REPOSITORIES_PER_PAGE = PositiveInt.make(50);
const EMPTY_CLONES: ReturnType<typeof useEnvironmentProjectClones> = [];
const GROUP_SKELETON_KEYS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;

type SelectedNamespace =
  | { readonly mode: "all" }
  | {
      readonly mode: "namespace";
      readonly id: string;
      readonly kind: SourceControlNamespaceKind;
      readonly label: string;
      readonly path: string;
    };

function VisibilityIcon({
  visibility,
}: {
  readonly visibility: SourceControlRepositorySummary["visibility"];
}) {
  switch (visibility) {
    case "public":
      return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "internal":
      return <ShieldIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "private":
    default:
      return <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function NamespaceTreeBranch({
  nodes,
  depth,
  selected,
  expandedIds,
  forceExpand,
  onToggleExpand,
  onSelect,
}: {
  readonly nodes: ReadonlyArray<NamespaceTreeNode>;
  readonly depth: number;
  readonly selected: SelectedNamespace;
  readonly expandedIds: ReadonlySet<string>;
  readonly forceExpand: boolean;
  readonly onToggleExpand: (id: string) => void;
  readonly onSelect: (node: NamespaceTreeNode) => void;
}) {
  const gt = useGT();
  return (
    <ul className={cn("grid gap-1", depth > 0 && "mt-1 ml-4 border-l border-border/60 pl-2")}>
      {nodes.map((node) => {
        const { namespace, children, isOrphanSubgroup } = node;
        const hasChildren = children.length > 0;
        const isExpanded = forceExpand || expandedIds.has(namespace.id);
        const isSelected = selected.mode === "namespace" && selected.id === namespace.id;
        return (
          <li key={namespace.id}>
            <div
              onDoubleClick={() => {
                if (hasChildren) onToggleExpand(namespace.id);
              }}
              className={cn(
                "group flex min-h-9 select-none items-center gap-1 rounded-md px-1.5 py-1.5 text-sm transition-colors duration-150",
                isSelected
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-foreground/85 hover:bg-accent/60",
              )}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand(namespace.id);
                  }}
                  className={cn(
                    "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
                    isSelected ? "hover:bg-background/25" : "hover:bg-background/70",
                  )}
                  aria-label={
                    isExpanded
                      ? gt("Collapse {name}", { name: namespace.name })
                      : gt("Expand {name}", { name: namespace.name })
                  }
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-4 transition-transform duration-150",
                      isExpanded && "rotate-90",
                      isSelected ? "text-accent-foreground" : "text-muted-foreground",
                    )}
                  />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onSelect(node)}
                onKeyDown={(event) => {
                  if (!hasChildren) return;
                  if (event.key === "ArrowRight" && !isExpanded) {
                    event.preventDefault();
                    onToggleExpand(namespace.id);
                  } else if (event.key === "ArrowLeft" && isExpanded) {
                    event.preventDefault();
                    onToggleExpand(namespace.id);
                  }
                }}
                className="flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 pr-1 text-left outline-none"
              >
                {isExpanded && hasChildren ? (
                  <FolderOpenIcon
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "text-accent-foreground" : "text-primary/80",
                    )}
                  />
                ) : (
                  <FolderIcon
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "text-accent-foreground" : "text-muted-foreground",
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {isOrphanSubgroup ? namespace.path : namespace.name}
                </span>
                {hasChildren ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-2xs tabular-nums",
                      isSelected
                        ? "bg-background/20 text-accent-foreground"
                        : "bg-muted/80 text-muted-foreground",
                    )}
                  >
                    {children.length}
                  </span>
                ) : null}
              </button>
            </div>
            {hasChildren ? (
              <Collapsible open={isExpanded}>
                <CollapsiblePanel>
                  <NamespaceTreeBranch
                    nodes={children}
                    depth={depth + 1}
                    selected={selected}
                    expandedIds={expandedIds}
                    forceExpand={forceExpand}
                    onToggleExpand={onToggleExpand}
                    onSelect={onSelect}
                  />
                </CollapsiblePanel>
              </Collapsible>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CloneRootPopover({
  environmentId,
  customRoot,
  newProjectsRoot,
  layout,
  onLayoutChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly customRoot: string;
  readonly newProjectsRoot: string | null | undefined;
  readonly layout: ClonePathLayout;
  readonly onLayoutChange: (next: ClonePathLayout) => void;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [draftRoot, setDraftRoot] = useState(customRoot);
  const [editingManually, setEditingManually] = useState(false);
  const [saving, setSaving] = useState(false);
  const folderPicker = useEnvironmentFolderPicker(environmentId);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update clone root directory",
  });
  const effective = resolveEffectiveCloneRoot({ customRoot, newProjectsRoot });

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !folderPicker.dialogProps) {
      setDraftRoot(customRoot);
      setEditingManually(false);
    }
    setOpen(nextOpen);
  };

  const handleSaveRoot = async (nextValue: string) => {
    setSaving(true);
    const normalized = nextValue.trim();
    const result = await updateSettings({
      environmentId,
      input: { patch: { addProjectBaseDirectory: normalized } },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDraftRoot(normalized);
      setOpen(false);
      toastManager.add({
        type: "success",
        title: normalized
          ? gt("Updated default clone root")
          : gt("Switched to auto-managed clone root"),
      });
    } else {
      const err = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Failed to save root directory"),
        description: err instanceof Error ? err.message : gt("An unexpected error occurred."),
      });
    }
  };

  const handlePickFolder = () => {
    // Close the popover before opening the modal dialog on Web so the z-[130] popover
    // does not obscure the z-50 dialog; reopen with the chosen folder afterward.
    if (!folderPicker.canUseNativePicker) {
      setOpen(false);
    }
    void folderPicker.openFolderPicker({
      initialPath: draftRoot.trim() || effective.path,
      title: gt("Choose default clone root directory"),
      description: gt(
        "Repositories cloned without a custom path will be saved inside this folder.",
      ),
      onSelect: (picked) => {
        setDraftRoot(picked);
        setEditingManually(false);
        setOpen(true);
      },
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button size="sm" variant="outline" className="max-w-56">
              <FolderTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs">
                {effective.isAutoManaged ? gt("Auto-managed root") : effective.path}
              </span>
            </Button>
          }
        />
        <PopoverPopup align="end" width="lg">
          <div className="flex w-full min-w-0 flex-col gap-3.5 overflow-hidden">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium text-foreground">
                <T>Clone root directory</T>
              </p>
              <p className="text-xs text-muted-foreground">
                <T>
                  Leave empty to let T3 Code manage clones automatically. You can always override
                  any repository's path before cloning.
                </T>
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>
                <T>Default root path</T>
              </Label>
              {editingManually || !folderPicker.canPickFolder ? (
                <div className="flex w-full min-w-0 items-center gap-1.5">
                  <div className="w-0 min-w-0 flex-1">
                    <Input
                      size="sm"
                      font="mono"
                      value={draftRoot}
                      onChange={(event) =>
                        setDraftRoot((prev) => resolvePastedPath(prev, event.target.value))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setEditingManually(false);
                      }}
                      placeholder="~/projects"
                      spellCheck={false}
                    />
                  </div>
                  {folderPicker.canPickFolder ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={gt("Finish editing path")}
                      onClick={() => setEditingManually(false)}
                    >
                      <CheckIcon className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="flex w-full min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="flex min-h-8 w-0 min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded-md border border-input bg-background/70 px-2.5 py-1 text-left transition-colors hover:bg-muted/50"
                  >
                    <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex w-0 min-w-0 flex-1 font-mono text-xs text-foreground">
                      <MiddleTruncate
                        showTitle={false}
                        value={
                          draftRoot.trim() ||
                          gt("Auto: {path}", { path: newProjectsRoot ?? "~/projects" })
                        }
                      />
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="xs" variant="outline" onClick={handlePickFolder}>
                      <FolderOpenIcon className="size-3.5" />
                      <T>Choose…</T>
                    </Button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={gt("Edit path manually")}
                            onClick={() => setEditingManually(true)}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                        }
                      />
                      <TooltipPopup side="top">
                        <T>Edit path manually</T>
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </div>
              )}
              <div className="flex w-full min-w-0 font-mono text-2xs text-muted-foreground">
                <MiddleTruncate
                  showTitle={false}
                  value={
                    draftRoot.trim()
                      ? draftRoot.trim()
                      : gt("Auto: {path}", { path: newProjectsRoot ?? "~/projects" })
                  }
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>
                <T>Default folder layout</T>
              </Label>
              <div className="flex flex-wrap">
                <ToggleGroup
                  multiple={false}
                  value={[layout]}
                  onValueChange={(values) => {
                    const next = values[0] as ClonePathLayout | undefined;
                    if (next) onLayoutChange(next);
                  }}
                >
                  <Toggle value="flat">
                    <FolderIcon />
                    <T>Flat</T>
                  </Toggle>
                  <Toggle value="group">
                    <FolderTreeIcon />
                    <T>By group</T>
                  </Toggle>
                  <Toggle value="ghq">
                    <GlobeIcon />
                    <T>Host + group</T>
                  </Toggle>
                </ToggleGroup>
              </div>
            </div>

            <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={saving || customRoot.trim() === ""}
                onClick={() => void handleSaveRoot("")}
              >
                <T>Use auto-managed</T>
              </Button>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" size="xs" variant="outline" onClick={() => setOpen(false)}>
                  <T>Close</T>
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={saving}
                  onClick={() => void handleSaveRoot(draftRoot)}
                >
                  <T>Save</T>
                </Button>
              </div>
            </div>
          </div>
        </PopoverPopup>
      </Popover>

      {folderPicker.dialogProps ? <FolderPickerDialog {...folderPicker.dialogProps} /> : null}
    </>
  );
}

export function RepositoriesPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const activeEnvironmentId =
    selectedEnvironmentId && environments.some((env) => env.environmentId === selectedEnvironmentId)
      ? selectedEnvironmentId
      : primaryEnvironmentId;
  const activeEnvironment = environments.find((env) => env.environmentId === activeEnvironmentId);

  const allProjects = useProjects();
  const environmentProjects = activeEnvironmentId
    ? allProjects.filter((project) => project.environmentId === activeEnvironmentId)
    : [];
  const environmentClones = useEnvironmentProjectClones(
    activeEnvironmentId ?? ("" as EnvironmentId),
  );
  const activeClones = activeEnvironmentId ? environmentClones : EMPTY_CLONES;

  const gitlabTokens = activeEnvironment?.serverConfig?.settings
    ? readHostCredentialSettings(activeEnvironment.serverConfig.settings, GITLAB_KIND).tokens
    : {};
  const savedTokenHosts = Object.entries(gitlabTokens)
    .filter(([, value]) =>
      typeof value === "string" ? value.trim().length > 0 : value !== undefined,
    )
    .map(([host]) => host);

  const customCloneRoot = activeEnvironment?.serverConfig?.settings.addProjectBaseDirectory ?? "";
  const newProjectsRoot = activeEnvironment?.serverConfig?.newProjectsRoot;
  const effectiveRoot = resolveEffectiveCloneRoot({
    customRoot: customCloneRoot,
    newProjectsRoot,
  });

  const discoveryQuery = useEnvironmentQuery(
    activeEnvironmentId
      ? sourceControlEnvironment.discovery({ environmentId: activeEnvironmentId, input: {} })
      : null,
  );
  const gitlabDiscovery = discoveryQuery.data?.sourceControlProviders.find(
    (item) => item.kind === GITLAB_KIND,
  );
  const configuredHosts = extractConfiguredGitLabHosts({
    discovery: gitlabDiscovery,
    savedTokenHosts,
  });

  const [selectedHost, setSelectedHost] = useState<string>("");
  const activeHost =
    selectedHost && configuredHosts.includes(selectedHost)
      ? selectedHost
      : (configuredHosts[0] ?? "");

  const [selectedNamespace, setSelectedNamespace] = useState<SelectedNamespace>({ mode: "all" });
  const [groupFilter, setGroupFilter] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const desktopGroupsResizable = useMediaQuery("(min-width: 768px)");
  const [maxGroupsWidth, setMaxGroupsWidth] = useState(560);
  const {
    width: groupsWidth,
    setWidth: setGroupsWidth,
    handlers: groupsResizeHandlers,
  } = useResizableWidth({
    storageKey: "t3code:repositories:groups-width:v1",
    defaultWidth: 304,
    minWidth: 220,
    maxWidth: maxGroupsWidth,
    edge: "right",
  });
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 250);
  const [includeSubgroups, setIncludeSubgroups] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RepositoryLocalStatusFilter>("all");
  const [page, setPage] = useState(1);

  const [protocol, setProtocol] = useState<SourceControlCloneProtocol>("auto");
  const [layout, setLayout] = useState<ClonePathLayout>("flat");
  const [selectedRepos, setSelectedRepos] = useState<
    ReadonlyMap<string, SourceControlRepositorySummary>
  >(() => new Map());
  const [cloneDialogRepos, setCloneDialogRepos] =
    useState<ReadonlyArray<SourceControlRepositorySummary> | null>(null);
  const [cloneBatchItems, setCloneBatchItems] = useState<ReadonlyArray<TrackedCloneBatchItem>>([]);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);

  const filesystemAccess = useFilesystemReadAccess(activeEnvironmentId);
  const canOpenLocalFolder =
    activeEnvironment?.serverConfig?.availableEditors.includes("file-manager") === true;

  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    label: "cancel project clone",
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    label: "retry project clone",
  });
  const createProject = useAtomCommand(projectEnvironment.create, {
    label: "import existing local repository",
    reportFailure: false,
  });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    label: "open repository folder",
    reportFailure: false,
  });

  const hasGitLabAccess =
    configuredHosts.length > 0 ||
    (gitlabDiscovery?.status === "available" && gitlabDiscovery.auth.status === "authenticated");
  const { Icon: GitLabIcon } = getSourceControlPresentationForKind(GITLAB_KIND);

  const namespacesQuery = useEnvironmentQuery(
    activeEnvironmentId && hasGitLabAccess
      ? sourceControlEnvironment.namespaces({
          environmentId: activeEnvironmentId,
          input: {
            provider: GITLAB_KIND,
            ...(activeHost ? { host: activeHost } : {}),
          },
        })
      : null,
  );

  const repositoriesQuery = useEnvironmentQuery(
    activeEnvironmentId && hasGitLabAccess
      ? sourceControlEnvironment.repositories({
          environmentId: activeEnvironmentId,
          input: {
            provider: GITLAB_KIND,
            ...(activeHost ? { host: activeHost } : {}),
            ...(selectedNamespace.mode === "namespace"
              ? {
                  namespaceId: selectedNamespace.id,
                  namespaceKind: selectedNamespace.kind,
                  includeSubgroups,
                }
              : {}),
            includeArchived,
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
            page: PositiveInt.make(page),
            perPage: REPOSITORIES_PER_PAGE,
          },
        })
      : null,
  );

  const resolvedHost = repositoriesQuery.data?.host ?? namespacesQuery.data?.host ?? activeHost;
  const namespaceTree = buildNamespaceTree(namespacesQuery.data?.namespaces ?? []);
  const filteredGroupTree = filterNamespaceTree(namespaceTree.groups, groupFilter);
  const expandableGroupIds = collectExpandableGroupIds(filteredGroupTree);
  const allGroupsExpanded =
    expandableGroupIds.length > 0 && expandableGroupIds.every((id) => expandedGroupIds.has(id));
  const localIndex = indexLocalRepositories({
    projects: environmentProjects,
    clones: activeClones,
  });
  const batchSummary = summarizeCloneBatch({
    items: cloneBatchItems,
    clones: activeClones,
    projects: environmentProjects,
  });

  const rawRepositories = repositoriesQuery.data?.repositories ?? [];
  const expectedPathByRepoId = new Map<string, string>();
  for (const repo of [...rawRepositories, ...selectedRepos.values()]) {
    if (expectedPathByRepoId.has(repo.id)) continue;
    expectedPathByRepoId.set(
      repo.id,
      computeRepoDestinationPath({
        rootDirectory: effectiveRoot.path,
        repo,
        host: resolvedHost,
        layout,
      }),
    );
  }
  const uniqueExpectedPaths = Array.from(
    new Set(
      Array.from(expectedPathByRepoId.values()).filter(
        (candidate) => candidate.length > 0 && candidate.length <= 512,
      ),
    ),
  ).slice(0, FILESYSTEM_METADATA_BATCH_LIMIT);

  const diskMetadataQuery = useEnvironmentQuery(
    activeEnvironmentId && filesystemAccess.canReadFiles && uniqueExpectedPaths.length > 0
      ? filesystemEnvironment.getMetadata({
          environmentId: activeEnvironmentId,
          input: { paths: uniqueExpectedPaths },
        })
      : null,
  );

  const existingDiskDirKeys = new Set<string>();
  if (diskMetadataQuery.data) {
    diskMetadataQuery.data.entries.forEach((meta, idx) => {
      const target = uniqueExpectedPaths[idx];
      if (target && meta?.kind === "directory") {
        existingDiskDirKeys.add(normalizeDestinationKey(target));
      }
    });
  }

  const enrichedRepositories = rawRepositories.map((repo) => {
    const expectedPath = expectedPathByRepoId.get(repo.id) ?? "";
    const existsOnDisk =
      expectedPath.length > 0 && existingDiskDirKeys.has(normalizeDestinationKey(expectedPath));
    const match = localIndex.match(repo, resolvedHost, expectedPath);
    const isCloning = match.clone?.phase === "running";
    const isImported =
      match.project !== null && !isCloning && (match.clone?.phase !== "failed" || existsOnDisk);
    const existsLocally = isImported || (existsOnDisk && !isCloning);
    const localFolderPath = match.project?.workspaceRoot ?? (existsOnDisk ? expectedPath : null);
    return { repo, match, isCloning, isImported, existsLocally, localFolderPath };
  });

  const visibleRepositories = enrichedRepositories.filter((item) => {
    if (statusFilter === "not_cloned") return !item.existsLocally;
    if (statusFilter === "imported") return item.existsLocally;
    return true;
  });

  const selectableVisible = visibleRepositories.filter(
    (item) => !item.existsLocally && !item.isCloning,
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((item) => selectedRepos.has(item.repo.id));
  const someVisibleSelected = selectableVisible.some((item) => selectedRepos.has(item.repo.id));

  const selectableSelectedRepos = Array.from(selectedRepos.values()).filter((repo) => {
    const expectedPath = expectedPathByRepoId.get(repo.id) ?? "";
    const existsOnDisk =
      expectedPath.length > 0 && existingDiskDirKeys.has(normalizeDestinationKey(expectedPath));
    const match = localIndex.match(repo, resolvedHost, expectedPath);
    const isCloning = match.clone?.phase === "running";
    const isImported =
      match.project !== null && !isCloning && (match.clone?.phase !== "failed" || existsOnDisk);
    return !isImported && !existsOnDisk && !isCloning;
  });

  const toggleExpandGroup = (id: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandAllGroups = () => {
    setExpandedGroupIds((prev) => {
      if (expandableGroupIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(expandableGroupIds);
    });
  };

  const handleCancelClone = async (projectId: ProjectId) => {
    if (!activeEnvironmentId) return;
    await cancelProjectClone({
      environmentId: activeEnvironmentId,
      input: { projectId },
    });
  };

  const handleCancelAllRunning = async () => {
    if (!activeEnvironmentId) return;
    const runningProjectIds = batchSummary.items
      .filter((entry) => entry.status === "running" && entry.item.projectId !== null)
      .map((entry) => entry.item.projectId!);
    for (const projectId of runningProjectIds) {
      await cancelProjectClone({
        environmentId: activeEnvironmentId,
        input: { projectId },
      });
    }
  };

  const handleRetryClone = async (projectId: ProjectId) => {
    if (!activeEnvironmentId) return;
    await retryProjectClone({
      environmentId: activeEnvironmentId,
      input: { projectId },
    });
  };

  const handleSelectHost = (nextHost: string) => {
    setSelectedHost(nextHost);
    setSelectedNamespace({ mode: "all" });
    setPage(1);
    setSelectedRepos(new Map());
  };

  const handleSelectNamespace = (next: SelectedNamespace) => {
    setSelectedNamespace(next);
    setPage(1);
  };

  const toggleSelectRepo = (repo: SourceControlRepositorySummary, checked: boolean) => {
    setSelectedRepos((prev) => {
      const next = new Map(prev);
      if (checked) next.set(repo.id, repo);
      else next.delete(repo.id);
      return next;
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedRepos((prev) => {
      const next = new Map(prev);
      for (const item of selectableVisible) {
        if (checked) next.set(item.repo.id, item.repo);
        else next.delete(item.repo.id);
      }
      return next;
    });
  };

  const handleRefreshAll = () => {
    discoveryQuery.refresh();
    namespacesQuery.refresh();
    repositoriesQuery.refresh();
    diskMetadataQuery.refresh();
  };

  const handleOpenProject = async (projectId: EnvironmentId | string) => {
    if (!activeEnvironmentId) return;
    const project = environmentProjects.find((item) => item.id === projectId);
    if (!project) return;
    await handleNewThread(scopeProjectRef(activeEnvironmentId, project.id));
  };

  const handleOpenExistingFolderAsProject = async (folderPath: string, fallbackTitle: string) => {
    if (!activeEnvironmentId) return;
    const normalizedTarget = normalizeProjectPathForComparison(folderPath);
    const existing = environmentProjects.find(
      (item) => normalizeProjectPathForComparison(item.workspaceRoot) === normalizedTarget,
    );
    if (existing) {
      await handleNewThread(scopeProjectRef(activeEnvironmentId, existing.id));
      return;
    }
    const projectId = newProjectId();
    const created = await createProject({
      environmentId: activeEnvironmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(folderPath) || fallbackTitle,
        workspaceRoot: folderPath,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag === "Failure") {
      const err = squashAtomCommandFailure(created);
      toastManager.add({
        type: "error",
        title: gt("Failed to open repository"),
        description: err instanceof Error ? err.message : folderPath,
      });
      return;
    }
    const ref = scopeProjectRef(activeEnvironmentId, projectId);
    await waitForProject(ref);
    await handleNewThread(ref);
  };

  const handleOpenLocalFolder = async (folderPath: string) => {
    if (!activeEnvironmentId) return;
    const result = await openInEditor({
      environmentId: activeEnvironmentId,
      input: {
        cwd: folderPath,
        editor: "file-manager",
      },
    });
    if (result._tag === "Failure") {
      const err = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not open local folder"),
        description: err instanceof Error ? err.message : folderPath,
      });
    }
  };

  return (
    <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspacePageTitle ariaLabel={gt("Repositories")}>
          <T>Repositories</T>
        </WorkspacePageTitle>
        <div className="min-w-0 flex-1" />
        <div
          className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]"
          data-workspace-titlebar-controls
        >
          {batchSummary.total > 0 ? (
            <Button
              size="sm"
              variant={batchSummary.runningCount > 0 ? "secondary" : "outline"}
              onClick={() => setProgressDialogOpen(true)}
            >
              {batchSummary.runningCount > 0 ? (
                <>
                  <Spinner className="size-3.5" />
                  <T>
                    Cloning (<Var>{batchSummary.settledCount}</Var>/<Var>{batchSummary.total}</Var>)
                  </T>
                </>
              ) : batchSummary.failedCount > 0 ? (
                <>
                  <AlertCircleIcon className="size-3.5 text-destructive" />
                  <T>
                    Clone tasks (<Var>{batchSummary.doneCount}</Var>/<Var>{batchSummary.total}</Var>
                    )
                  </T>
                </>
              ) : (
                <>
                  <CheckCircle2Icon className="size-3.5 text-success-foreground" />
                  <T>
                    Cloned (<Var>{batchSummary.doneCount}</Var>)
                  </T>
                </>
              )}
            </Button>
          ) : null}

          {activeEnvironmentId ? (
            <CloneRootPopover
              environmentId={activeEnvironmentId}
              customRoot={customCloneRoot}
              newProjectsRoot={newProjectsRoot}
              layout={layout}
              onLayoutChange={setLayout}
            />
          ) : null}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={gt("Refresh repositories")}
                  onClick={handleRefreshAll}
                  disabled={namespacesQuery.isPending || repositoriesQuery.isPending}
                >
                  <RefreshIcon
                    refreshing={namespacesQuery.isPending || repositoriesQuery.isPending}
                  />
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              <T>Refresh groups and repositories</T>
            </TooltipPopup>
          </Tooltip>

          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: "/settings/source-control" })}
          >
            <SettingsIcon className="size-3.5" />
            <T>GitLab Settings</T>
          </Button>
        </div>
      </WorkspacePageHeader>

      <WorkspacePageToolbar>
        {environments.length > 1 && activeEnvironmentId ? (
          <Select
            value={activeEnvironmentId}
            onValueChange={(value) => {
              if (!value) return;
              setSelectedEnvironmentId(value as EnvironmentId);
              setSelectedHost("");
              setSelectedNamespace({ mode: "all" });
              setPage(1);
              setSelectedRepos(new Map());
            }}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue>
                {environments.find((env) => env.environmentId === activeEnvironmentId)?.label ??
                  activeEnvironmentId}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {environments.map((env) => (
                <SelectItem key={env.environmentId} value={env.environmentId}>
                  {env.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}

        {configuredHosts.length > 0 ? (
          <Select
            value={activeHost}
            onValueChange={(value) => {
              if (typeof value === "string" && value.length > 0) handleSelectHost(value);
            }}
          >
            <SelectTrigger size="sm" className="w-52">
              <GitLabIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <SelectValue>
                <span className="font-mono text-xs">{activeHost}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {configuredHosts.map((host) => (
                <SelectItem key={host} value={host}>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                    <GitLabIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>{host}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <ToggleGroup
          value={[protocol]}
          onValueChange={(values) => {
            const next = values[0] as SourceControlCloneProtocol | undefined;
            if (next) setProtocol(next);
          }}
        >
          <Toggle value="auto">
            <ZapIcon />
            <T>Auto</T>
          </Toggle>
          <Toggle value="ssh">
            <KeyRoundIcon />
            <T>SSH</T>
          </Toggle>
          <Toggle value="https">
            <GlobeIcon />
            <T>HTTPS</T>
          </Toggle>
        </ToggleGroup>
      </WorkspacePageToolbar>

      {!activeEnvironmentId ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2Icon className="size-5" />
              </EmptyMedia>
              <EmptyTitle>
                <T>No connected environment</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>Connect a server environment to browse and clone GitLab repositories.</T>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : !hasGitLabAccess && !discoveryQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty className="max-w-lg">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2Icon className="size-5" />
              </EmptyMedia>
              <EmptyTitle>
                <T>Connect your GitLab instance</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>
                  Add your GitLab host (such as self-hosted GitLab) and a Personal Access Token in
                  Settings to browse your accessible groups and clone repositories locally without
                  installing glab.
                </T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-xs text-muted-foreground">
                  <T>
                    Recommended token scopes:{" "}
                    <code className="rounded bg-muted px-1">read_api</code> to browse groups and
                    repositories, plus{" "}
                    <code className="rounded bg-muted px-1">read_repository</code> if you also want
                    HTTPS token cloning.
                  </T>
                </p>
                <Button onClick={() => void navigate({ to: "/settings/source-control" })}>
                  <SettingsIcon className="size-4" />
                  <T>Configure GitLab in Settings</T>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Left pane: Namespace / Group tree */}
          <aside
            ref={(node) => {
              if (!desktopGroupsResizable || !node) return;
              const row = node.parentElement;
              if (!row) return;
              const measure = () => {
                const available = Math.max(220, row.clientWidth - 360);
                setMaxGroupsWidth(Math.min(560, available));
              };
              measure();
              return observeResize(row, measure);
            }}
            className={cn(
              "relative flex w-full shrink-0 flex-col border-b border-border/60 bg-background md:border-r md:border-b-0",
              !desktopGroupsResizable && "md:w-76 lg:w-80",
            )}
            style={
              desktopGroupsResizable
                ? ({
                    [RESIZABLE_WIDTH_PROPERTY]: `${groupsWidth}px`,
                    width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
                  } as CSSProperties)
                : undefined
            }
          >
            <div className="border-b border-border/60 p-3">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon className="size-3.5 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  size="sm"
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  placeholder={gt("Filter groups…")}
                />
              </InputGroup>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              <div className="grid gap-1 pb-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectNamespace({ mode: "all" })}
                  className={cn(
                    "flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150",
                    selectedNamespace.mode === "all"
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground/85 hover:bg-accent/60",
                  )}
                >
                  <LayersIcon
                    className={cn(
                      "size-4 shrink-0",
                      selectedNamespace.mode === "all"
                        ? "text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate">
                    <T>All accessible repositories</T>
                  </span>
                </button>

                {namespaceTree.personal ? (
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectNamespace({
                        mode: "namespace",
                        id: namespaceTree.personal!.id,
                        kind: "user",
                        label: namespaceTree.personal!.name,
                        path: namespaceTree.personal!.path,
                      })
                    }
                    className={cn(
                      "flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150",
                      selectedNamespace.mode === "namespace" &&
                        selectedNamespace.id === namespaceTree.personal.id
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-foreground/85 hover:bg-accent/60",
                    )}
                  >
                    <UserIcon
                      className={cn(
                        "size-4 shrink-0",
                        selectedNamespace.mode === "namespace" &&
                          selectedNamespace.id === namespaceTree.personal.id
                          ? "text-accent-foreground"
                          : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <T>Personal repositories</T>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-2xs",
                        selectedNamespace.mode === "namespace" &&
                          selectedNamespace.id === namespaceTree.personal.id
                          ? "text-accent-foreground/80"
                          : "text-muted-foreground",
                      )}
                    >
                      {namespaceTree.personal.path}
                    </span>
                  </button>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-border/60 px-2 pt-3 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                    <T>Groups</T>
                  </span>
                  {namespacesQuery.data ? (
                    <span className="rounded-full bg-muted/80 px-1.5 py-0.5 text-2xs text-muted-foreground tabular-nums">
                      {namespacesQuery.data.namespaces.filter((ns) => ns.kind === "group").length}
                    </span>
                  ) : null}
                </div>
                {expandableGroupIds.length > 0 && groupFilter.trim().length === 0 ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={
                            allGroupsExpanded ? gt("Collapse all groups") : gt("Expand all groups")
                          }
                          onClick={toggleExpandAllGroups}
                        >
                          {allGroupsExpanded ? (
                            <ChevronsDownUpIcon className="size-3.5" />
                          ) : (
                            <ChevronsUpDownIcon className="size-3.5" />
                          )}
                        </Button>
                      }
                    />
                    <TooltipPopup side="right">
                      {allGroupsExpanded ? <T>Collapse all groups</T> : <T>Expand all groups</T>}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>

              {namespacesQuery.isPending && !namespacesQuery.data ? (
                <div className="loading-shimmer grid gap-2 p-2">
                  {GROUP_SKELETON_KEYS.map((key) => (
                    <GhostBar key={key} className="h-5 w-full" />
                  ))}
                </div>
              ) : namespacesQuery.error ? (
                <div className="p-2">
                  <Alert variant="error">
                    <AlertCircleIcon className="size-4" />
                    <AlertTitle>
                      <T>Could not load groups</T>
                    </AlertTitle>
                    <AlertDescription>{namespacesQuery.error}</AlertDescription>
                  </Alert>
                </div>
              ) : filteredGroupTree.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-muted-foreground">
                  {groupFilter.trim() ? (
                    <T>No matching groups.</T>
                  ) : (
                    <T>No accessible groups found.</T>
                  )}
                </p>
              ) : (
                <NamespaceTreeBranch
                  nodes={filteredGroupTree}
                  depth={0}
                  selected={selectedNamespace}
                  expandedIds={expandedGroupIds}
                  forceExpand={groupFilter.trim().length > 0}
                  onToggleExpand={toggleExpandGroup}
                  onSelect={(node) =>
                    handleSelectNamespace({
                      mode: "namespace",
                      id: node.namespace.id,
                      kind: node.namespace.kind,
                      label: node.namespace.name,
                      path: node.namespace.path,
                    })
                  }
                />
              )}
            </div>
            {desktopGroupsResizable ? (
              <div
                role="separator"
                aria-label={gt("Resize group list")}
                aria-orientation="vertical"
                aria-valuenow={groupsWidth}
                aria-valuemin={220}
                aria-valuemax={maxGroupsWidth}
                tabIndex={0}
                onDoubleClick={() => setGroupsWidth(304)}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const step = event.shiftKey ? 48 : 16;
                  let nextWidth: number;
                  switch (event.key) {
                    case "ArrowLeft":
                      nextWidth = groupsWidth - step;
                      break;
                    case "ArrowRight":
                      nextWidth = groupsWidth + step;
                      break;
                    case "Home":
                      nextWidth = 220;
                      break;
                    case "End":
                      nextWidth = maxGroupsWidth;
                      break;
                    default:
                      return;
                  }
                  event.preventDefault();
                  setGroupsWidth(Math.max(220, Math.min(maxGroupsWidth, nextWidth)));
                }}
                className="group absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none select-none focus-visible:outline-none"
                {...groupsResizeHandlers}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary"
                />
              </div>
            ) : null}
          </aside>

          {/* Right pane: Repository list & batch clone bar */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Filter & search toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/50 px-4 py-2.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="min-w-52 flex-1 max-w-sm">
                  <PullRequestSearchInput
                    value={searchInput}
                    busy={
                      searchInput.trim() !== debouncedSearch ||
                      (debouncedSearch.length > 0 && repositoriesQuery.isPending)
                    }
                    label={gt("Search all accessible repositories…")}
                    placeholder={
                      selectedNamespace.mode === "namespace"
                        ? gt("Search in {group}…", { group: selectedNamespace.path })
                        : gt("Search all accessible repositories…")
                    }
                    onChange={(next) => {
                      setSearchInput(next);
                      setPage(1);
                    }}
                    onSubmit={(next) => {
                      setSearchInput(next);
                      setPage(1);
                    }}
                  />
                </div>

                <ToggleGroup
                  value={[statusFilter]}
                  onValueChange={(values) => {
                    const next = values[0] as RepositoryLocalStatusFilter | undefined;
                    if (next) setStatusFilter(next);
                  }}
                >
                  <Toggle value="all">
                    <LayersIcon />
                    <T>All</T>
                  </Toggle>
                  <Toggle value="not_cloned">
                    <DownloadIcon />
                    <T>Not cloned</T>
                  </Toggle>
                  <Toggle value="imported">
                    <CheckCircle2Icon />
                    <T>Imported</T>
                  </Toggle>
                </ToggleGroup>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {selectedNamespace.mode === "namespace" && selectedNamespace.kind === "group" ? (
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox
                      checked={includeSubgroups}
                      onCheckedChange={(checked) => {
                        setIncludeSubgroups(Boolean(checked));
                        setPage(1);
                      }}
                    />
                    <span>
                      <T>Include subgroups</T>
                    </span>
                  </label>
                ) : null}

                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={includeArchived}
                    onCheckedChange={(checked) => {
                      setIncludeArchived(Boolean(checked));
                      setPage(1);
                    }}
                  />
                  <span>
                    <T>Archived</T>
                  </span>
                </label>
              </div>
            </div>

            {/* Scope header + batch selection bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-background px-4 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Checkbox
                  checked={allVisibleSelected}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  disabled={selectableVisible.length === 0}
                  aria-label={gt("Select all uncloned repositories on this page")}
                  onCheckedChange={(checked) => toggleSelectAllVisible(Boolean(checked))}
                />
                <div className="min-w-0">
                  <span className="text-xs font-medium text-foreground">
                    {selectedNamespace.mode === "namespace" ? (
                      selectedNamespace.path
                    ) : (
                      <T>All accessible repositories</T>
                    )}
                  </span>
                  {repositoriesQuery.data?.totalCount !== null &&
                  repositoriesQuery.data?.totalCount !== undefined ? (
                    <span className="ml-2 text-2xs text-muted-foreground">
                      <T>
                        <Var>{repositoriesQuery.data.totalCount}</Var> total
                      </T>
                    </span>
                  ) : null}
                </div>
              </div>

              {selectableSelectedRepos.length > 0 ? (
                <div className={cn("flex items-center gap-2", WORKSPACE_BAR_ENTER_CLASS)}>
                  <Badge size="sm" variant="secondary">
                    <T>
                      <Var>{selectableSelectedRepos.length}</Var> selected
                    </T>
                  </Badge>
                  <Button size="xs" variant="ghost" onClick={() => setSelectedRepos(new Map())}>
                    <T>Clear</T>
                  </Button>
                  <Button size="xs" onClick={() => setCloneDialogRepos(selectableSelectedRepos)}>
                    <DownloadIcon className="size-3.5" />
                    <T>
                      Clone selected (<Var>{selectableSelectedRepos.length}</Var>)
                    </T>
                  </Button>
                </div>
              ) : (
                <span className="truncate font-mono text-2xs text-muted-foreground">
                  {effectiveRoot.isAutoManaged
                    ? gt("Auto target root: {path}", { path: effectiveRoot.path })
                    : gt("Target root: {path}", { path: effectiveRoot.path })}
                </span>
              )}
            </div>

            {/* Repository rows */}
            <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
              {repositoriesQuery.isPending && !repositoriesQuery.data ? (
                <div className="p-2">
                  <PullRequestListGhost rows={8} />
                </div>
              ) : repositoriesQuery.error ? (
                <div className="p-4">
                  <Alert variant="error">
                    <AlertCircleIcon className="size-4" />
                    <AlertTitle>
                      <T>Could not load repositories</T>
                    </AlertTitle>
                    <AlertDescription>{repositoriesQuery.error}</AlertDescription>
                  </Alert>
                </div>
              ) : visibleRepositories.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6">
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderGit2Icon className="size-5" />
                      </EmptyMedia>
                      <EmptyTitle>
                        <T>No repositories found</T>
                      </EmptyTitle>
                      <EmptyDescription>
                        {debouncedSearch ? (
                          <T>Try a different search keyword or switch to another group.</T>
                        ) : statusFilter !== "all" ? (
                          <T>No repositories match the current local status filter.</T>
                        ) : (
                          <T>This group has no visible repositories.</T>
                        )}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : (
                <ul
                  key={`${selectedNamespace.mode === "namespace" ? selectedNamespace.id : "all"}:${statusFilter}`}
                  className={cn("flex flex-col gap-0.5 p-2", WORKSPACE_TAB_PANEL_CLASS)}
                >
                  {visibleRepositories.map(
                    ({ repo, match, isCloning, isImported, existsLocally, localFolderPath }) => {
                      const isSelected = !existsLocally && selectedRepos.has(repo.id);
                      const clone = match.clone;
                      const updatedTime = repo.lastActivityAt ? (
                        <RelativeTime timestamp={repo.lastActivityAt} />
                      ) : null;
                      return (
                        <li
                          key={repo.id}
                          className={cn(
                            "flex flex-col gap-2 rounded-md px-3 py-2.5 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between",
                            isSelected ? "bg-accent" : "hover:bg-accent/60",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="pt-0.5">
                              <Checkbox
                                checked={isSelected}
                                disabled={existsLocally || isCloning}
                                aria-label={gt("Select {name}", { name: repo.pathWithNamespace })}
                                onCheckedChange={(checked) =>
                                  toggleSelectRepo(repo, Boolean(checked))
                                }
                              />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <VisibilityIcon visibility={repo.visibility} />
                                <span className="truncate text-sm font-medium text-foreground">
                                  {repo.name}
                                </span>
                                <span className="truncate font-mono text-xs text-muted-foreground">
                                  {repo.pathWithNamespace}
                                </span>
                                {repo.archived ? (
                                  <Badge size="sm" variant="outline">
                                    <ArchiveIcon className="size-3" />
                                    <T>Archived</T>
                                  </Badge>
                                ) : null}
                                {isImported ? (
                                  <Badge size="sm" variant="success">
                                    <CheckCircle2Icon className="size-3" />
                                    <T>Imported</T>
                                  </Badge>
                                ) : existsLocally ? (
                                  <Badge size="sm" variant="secondary">
                                    <CheckCircle2Icon className="size-3" />
                                    <T>Exists locally</T>
                                  </Badge>
                                ) : null}
                              </div>

                              {repo.description ? (
                                <p className="line-clamp-2 text-xs text-muted-foreground">
                                  {repo.description}
                                </p>
                              ) : null}

                              <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
                                {repo.defaultBranch ? (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <GitBranchIcon className="size-3" />
                                    {repo.defaultBranch}
                                  </span>
                                ) : null}
                                {updatedTime ? (
                                  <span>
                                    <T>
                                      Updated <Var>{updatedTime}</Var>
                                    </T>
                                  </span>
                                ) : null}
                                {localFolderPath ? (
                                  <span className="truncate font-mono text-muted-foreground/80">
                                    {localFolderPath}
                                  </span>
                                ) : null}
                              </div>

                              {clone && clone.phase === "running" ? (
                                <div className="mt-1.5 flex max-w-md flex-col gap-1">
                                  <div className="flex items-center justify-between text-2xs text-muted-foreground">
                                    <span>{projectCloneProgressSummary(clone, m)}</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                                      style={{ width: `${clone.percent ?? 15}%` }}
                                    />
                                  </div>
                                </div>
                              ) : null}

                              {clone &&
                              !existsLocally &&
                              (clone.phase === "failed" || clone.phase === "cancelled") ? (
                                <p className="text-xs wrap-anywhere text-destructive">
                                  {clone.error ?? gt("Clone stopped before completion.")}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5 pl-7 sm:pl-0">
                            {clone && clone.phase === "running" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  void cancelProjectClone({
                                    environmentId: activeEnvironmentId,
                                    input: { projectId: clone.projectId },
                                  })
                                }
                              >
                                <XIcon className="size-3.5" />
                                <T>Cancel</T>
                              </Button>
                            ) : existsLocally ? (
                              <>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    match.project
                                      ? void handleOpenProject(match.project.id)
                                      : localFolderPath
                                        ? void handleOpenExistingFolderAsProject(
                                            localFolderPath,
                                            repo.name,
                                          )
                                        : undefined
                                  }
                                >
                                  <T>Open</T>
                                </Button>
                                {canOpenLocalFolder && localFolderPath ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button
                                          size="xs"
                                          variant="outline"
                                          aria-label={gt("Open local folder for {name}", {
                                            name: repo.name,
                                          })}
                                          onClick={() =>
                                            void handleOpenLocalFolder(localFolderPath)
                                          }
                                        >
                                          <FolderOpenIcon className="size-3.5" />
                                          <T>Open folder</T>
                                        </Button>
                                      }
                                    />
                                    <TooltipPopup side="top">
                                      <T>Open local folder</T>
                                    </TooltipPopup>
                                  </Tooltip>
                                ) : null}
                              </>
                            ) : clone &&
                              (clone.phase === "failed" || clone.phase === "cancelled") ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  void retryProjectClone({
                                    environmentId: activeEnvironmentId,
                                    input: { projectId: clone.projectId },
                                  })
                                }
                              >
                                <RotateCcwIcon className="size-3.5" />
                                <T>Retry</T>
                              </Button>
                            ) : (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setCloneDialogRepos([repo])}
                              >
                                <DownloadIcon className="size-3.5" />
                                <T>Clone</T>
                              </Button>
                            )}

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label={gt("Open {name} in browser", { name: repo.name })}
                                    render={
                                      <a
                                        href={repo.webUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                      />
                                    }
                                  >
                                    <ExternalLinkIcon className="size-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipPopup side="top">
                                <T>Open in GitLab</T>
                              </TooltipPopup>
                            </Tooltip>
                          </div>
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </div>

            {/* Pagination bar */}
            {repositoriesQuery.data && (page > 1 || repositoriesQuery.data.nextPage !== null) ? (
              <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
                <span>
                  <T>
                    Page <Var>{page}</Var>
                  </T>
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={page <= 1 || repositoriesQuery.isPending}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                    <T>Previous</T>
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      repositoriesQuery.data.nextPage === null || repositoriesQuery.isPending
                    }
                    onClick={() =>
                      setPage((current) => repositoriesQuery.data?.nextPage ?? current + 1)
                    }
                  >
                    <T>Next</T>
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      )}

      {activeEnvironmentId && cloneDialogRepos ? (
        <CloneRepositoriesDialog
          key={cloneDialogRepos.map((repo) => repo.id).join(",")}
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setCloneDialogRepos(null);
          }}
          environmentId={activeEnvironmentId}
          host={resolvedHost}
          repositories={cloneDialogRepos}
          defaultRootPath={effectiveRoot.path}
          isAutoManagedRoot={effectiveRoot.isAutoManaged}
          defaultProtocol={protocol}
          defaultLayout={layout}
          onLayoutChange={setLayout}
          onBatchStarted={({ items, startedRepoIds }) => {
            setSelectedRepos((prev) => {
              const next = new Map(prev);
              for (const id of startedRepoIds) next.delete(id);
              return next;
            });
            setCloneDialogRepos(null);
            if (items.length > 0) {
              setCloneBatchItems((prev) => {
                const incomingRepoIds = new Set(items.map((item) => item.repo.id));
                const kept = prev.filter((item) => !incomingRepoIds.has(item.repo.id));
                return [...items, ...kept];
              });
              setProgressDialogOpen(true);
            }
          }}
        />
      ) : null}

      {activeEnvironmentId && batchSummary.total > 0 ? (
        <CloneProgressDialog
          open={progressDialogOpen}
          onOpenChange={setProgressDialogOpen}
          environmentId={activeEnvironmentId}
          summary={batchSummary}
          canOpenLocalFolder={canOpenLocalFolder}
          onCancelClone={handleCancelClone}
          onCancelAllRunning={handleCancelAllRunning}
          onRetryClone={handleRetryClone}
          onOpenProject={handleOpenProject}
          onOpenLocalFolder={handleOpenLocalFolder}
          onClearList={() => setCloneBatchItems([])}
        />
      ) : null}
    </SidebarInset>
  );
}
