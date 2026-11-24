import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  IssueAutomationPlatformKind,
  type EnvironmentId,
  type IssueAutomationActionMode,
  type IssueAutomationBrowseFilter,
  type IssueAutomationConnector,
  type IssueAutomationConnectorId,
  type IssueAutomationModuleRepoMapping,
  type IssueAutomationPlatformDescriptor,
  type IssueAutomationProfile,
  type IssueAutomationRemoteScope,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT, Var } from "gt-react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  OfficialModelPicker,
  useOfficialModelCatalog,
} from "~/components/chat/OfficialModelPicker";
import {
  FolderPickerDialog,
  useEnvironmentFolderPicker,
} from "~/components/repositories/FolderPickerDialog";
import { SecretInput } from "~/components/settings/SecretInput";
import { SettingsGroup } from "~/components/settings/SettingsGroup";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn, newProjectId } from "~/lib/utils";
import { waitForProject } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { issueAutomationEnvironment } from "~/state/issueAutomation";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogAction,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearchInput,
  MenuTrigger,
} from "../ui/menu";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { sortScopesByIdDesc } from "./issueAutomationAnalytics.logic";
import { useActionModeLabel } from "./issueAutomationPresentation";
import { formatCompactParentPath, groupProjectsByParentFolder } from "./projectMenuGrouping.logic";

/**
 * Caps the visible height of long selector popups to 20 rows (20 * 1.75rem = 35rem)
 * while keeping every matching option scrollable and respecting viewport boundaries.
 */
export const SELECTOR_SCROLL_LIST_STYLE = {
  maxHeight: "min(35rem, calc(var(--available-height, 80dvh) - 3.5rem))",
} as const;

const MODAL_POPUP_STYLE = { maxHeight: "calc(100dvh - 2.5rem)" } as const;

export interface SelectableProjectOption {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

const COLLAPSED_PROJECT_FOLDERS_STORAGE_KEY =
  "t3code:issue-automation:collapsed-project-folders:v1";
const CollapsedProjectFoldersSchema = Schema.Array(Schema.String);

export function SearchableScopeMenu({
  scopes,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  readonly scopes: ReadonlyArray<IssueAutomationRemoteScope>;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const sortedScopes = sortScopesByIdDesc(scopes);
  const current = sortedScopes.find((s) => s.id === value) ?? sortedScopes[0] ?? null;
  const needle = query.trim().toLowerCase();
  const filtered = sortedScopes.filter(
    (s) =>
      needle.length === 0 ||
      s.name.toLowerCase().includes(needle) ||
      s.id.toLowerCase().includes(needle),
  );

  return (
    <Menu>
      <MenuTrigger
        aria-label={ariaLabel}
        render={<Button variant="outline" className={cn("justify-between", className)} />}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current ? `#${current.id} · ${current.name}` : gt("Select product")}
        </span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start">
        {sortedScopes.length > 6 ? (
          <MenuSearchInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Search products…")}
            aria-label={gt("Search products")}
          />
        ) : null}
        <div className="overflow-y-auto overscroll-contain" style={SELECTOR_SCROLL_LIST_STYLE}>
          <MenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next) onChange(next);
            }}
          >
            {filtered.length === 0 ? (
              <MenuItem disabled>
                <T>No matching products</T>
              </MenuItem>
            ) : (
              filtered.map((scope) => (
                <MenuRadioItem key={scope.id} value={scope.id} closeOnClick>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-9 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      #{scope.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{scope.name}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))
            )}
          </MenuRadioGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function useProjectFolderGroups(projects: ReadonlyArray<SelectableProjectOption>, query: string) {
  const gt = useGT();
  const [collapsedKeys, setCollapsedKeys] = useLocalStorage(
    COLLAPSED_PROJECT_FOLDERS_STORAGE_KEY,
    [],
    CollapsedProjectFoldersSchema,
  );
  const needle = query.trim();
  const groups = groupProjectsByParentFolder(projects, {
    search: needle,
    ungroupedLabel: gt("Other"),
  });
  const collapsedSet = new Set(collapsedKeys);
  const isSearching = needle.length > 0;
  const hasMultipleGroups = groups.length > 1;
  const anyExpanded = groups.some((group) => !collapsedSet.has(group.key));

  const toggleGroup = (key: string) => {
    setCollapsedKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  const toggleAllGroups = () => {
    if (anyExpanded) {
      setCollapsedKeys(groups.map((group) => group.key));
      return;
    }
    setCollapsedKeys([]);
  };

  return {
    groups,
    collapsedSet,
    isSearching,
    hasMultipleGroups,
    anyExpanded,
    toggleGroup,
    toggleAllGroups,
  };
}

function ProjectFolderGroupHeader({
  label,
  parentDir,
  count,
  collapsed,
  hasActiveSelection,
  onToggle,
}: {
  readonly label: string;
  readonly parentDir: string;
  readonly count: number;
  readonly collapsed: boolean;
  readonly hasActiveSelection: boolean;
  readonly onToggle: () => void;
}) {
  const compactPath = parentDir ? formatCompactParentPath(parentDir) : "";
  const headerButton = (
    <button
      type="button"
      aria-expanded={!collapsed}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs font-medium transition-colors hover:bg-accent/60 hover:text-foreground",
        hasActiveSelection ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {collapsed ? (
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-75" />
      ) : (
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-75" />
      )}
      {collapsed ? (
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FolderOpenIcon className="size-3.5 shrink-0 text-primary/80" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasActiveSelection ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
      <span className="shrink-0 rounded bg-muted/70 px-1.5 py-px font-mono text-3xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  );

  if (!compactPath) {
    return headerButton;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={headerButton} />
      <TooltipPopup side="right">{compactPath}</TooltipPopup>
    </Tooltip>
  );
}

export function SearchableProjectMenu({
  projects,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  triggerVariant = "select",
  leadingIcon,
  className,
}: {
  readonly projects: ReadonlyArray<SelectableProjectOption>;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly ariaLabel: string;
  readonly size?: "compact" | "sm" | "default";
  readonly triggerVariant?: "select" | "outline";
  readonly leadingIcon?: ReactNode;
  readonly className?: string;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const current = projects.find((p) => p.id === value) ?? projects[0] ?? null;
  const {
    groups,
    collapsedSet,
    isSearching,
    hasMultipleGroups,
    anyExpanded,
    toggleGroup,
    toggleAllGroups,
  } = useProjectFolderGroups(projects, query);

  return (
    <Menu>
      {triggerVariant === "outline" ? (
        <MenuTrigger
          aria-label={ariaLabel}
          render={<Button variant="outline" className={cn("justify-between", className)} />}
        >
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {leadingIcon}
            <span className="truncate">{current?.title ?? gt("Select repository")}</span>
          </span>
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
        </MenuTrigger>
      ) : (
        <MenuTrigger
          aria-label={ariaLabel}
          render={<SelectButton size={size} className={className} />}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {leadingIcon}
            <span className="truncate">{current?.title ?? gt("Select repository")}</span>
          </span>
        </MenuTrigger>
      )}
      <MenuPopup align="start" className="min-w-72 max-w-96">
        {projects.length > 8 ? (
          <MenuSearchInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Search repositories…")}
            aria-label={gt("Search repositories")}
          />
        ) : null}
        {hasMultipleGroups && !isSearching ? (
          <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1 text-2xs text-muted-foreground">
            <span>
              <Var>{groups.length}</Var> <T>folders</T>
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleAllGroups();
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {anyExpanded ? (
                <>
                  <ChevronsDownUpIcon className="size-3" />
                  <T>Collapse all</T>
                </>
              ) : (
                <>
                  <ChevronsUpDownIcon className="size-3" />
                  <T>Expand all</T>
                </>
              )}
            </button>
          </div>
        ) : null}
        <div className="overflow-y-auto overscroll-contain p-1" style={SELECTOR_SCROLL_LIST_STYLE}>
          <MenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next) onChange(next);
            }}
          >
            {groups.length === 0 ? (
              <MenuItem disabled>
                <T>No matching repositories</T>
              </MenuItem>
            ) : (
              groups.map((group) => {
                const isCollapsed = !isSearching && collapsedSet.has(group.key);
                const hasActiveSelection = group.projects.some((proj) => proj.id === value);
                return (
                  <div key={group.key} className="not-first:mt-1">
                    <ProjectFolderGroupHeader
                      label={group.label}
                      parentDir={group.parentDir}
                      count={group.projects.length}
                      collapsed={isCollapsed}
                      hasActiveSelection={hasActiveSelection}
                      onToggle={() => toggleGroup(group.key)}
                    />
                    {!isCollapsed ? (
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
                        {group.projects.map((proj) => (
                          <MenuRadioItem key={proj.id} value={proj.id} closeOnClick>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 flex-1 truncate">{proj.title}</span>
                              <MenuRadioItemIndicator />
                            </span>
                          </MenuRadioItem>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </MenuRadioGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function SearchableMultiProjectMenu({
  projects,
  selectedIds,
  onChange,
  ariaLabel,
}: {
  readonly projects: ReadonlyArray<SelectableProjectOption>;
  readonly selectedIds: ReadonlyArray<ProjectId>;
  readonly onChange: (next: ReadonlyArray<ProjectId>) => void;
  readonly ariaLabel: string;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const {
    groups,
    collapsedSet,
    isSearching,
    hasMultipleGroups,
    anyExpanded,
    toggleGroup,
    toggleAllGroups,
  } = useProjectFolderGroups(projects, query);
  const selectedSet = new Set(selectedIds);
  const summary =
    projects.length === 0 || selectedIds.length === 0
      ? gt("Not linked")
      : selectedIds.map((id) => projects.find((p) => p.id === id)?.title ?? id).join(", ");

  return (
    <Menu>
      <MenuTrigger
        aria-label={ariaLabel}
        disabled={projects.length === 0}
        render={<SelectButton size="sm" />}
      >
        {summary}
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-72 max-w-96">
        {projects.length > 8 ? (
          <MenuSearchInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Search repositories…")}
            aria-label={gt("Search repositories")}
          />
        ) : null}
        {hasMultipleGroups && !isSearching ? (
          <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1 text-2xs text-muted-foreground">
            <span>
              <Var>{groups.length}</Var> <T>folders</T>
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleAllGroups();
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {anyExpanded ? (
                <>
                  <ChevronsDownUpIcon className="size-3" />
                  <T>Collapse all</T>
                </>
              ) : (
                <>
                  <ChevronsUpDownIcon className="size-3" />
                  <T>Expand all</T>
                </>
              )}
            </button>
          </div>
        ) : null}
        <div className="overflow-y-auto overscroll-contain p-1" style={SELECTOR_SCROLL_LIST_STYLE}>
          {groups.length === 0 ? (
            <MenuItem disabled>
              <T>No matching repositories</T>
            </MenuItem>
          ) : (
            groups.map((group) => {
              const isCollapsed = !isSearching && collapsedSet.has(group.key);
              const hasActiveSelection = group.projects.some((proj) => selectedSet.has(proj.id));
              return (
                <div key={group.key} className="not-first:mt-1">
                  <ProjectFolderGroupHeader
                    label={group.label}
                    parentDir={group.parentDir}
                    count={group.projects.length}
                    collapsed={isCollapsed}
                    hasActiveSelection={hasActiveSelection}
                    onToggle={() => toggleGroup(group.key)}
                  />
                  {!isCollapsed ? (
                    <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
                      {group.projects.map((proj) => {
                        const checked = selectedSet.has(proj.id);
                        return (
                          <MenuCheckboxItem
                            key={proj.id}
                            checked={checked}
                            onCheckedChange={(next) => {
                              if (next) {
                                onChange(checked ? selectedIds : [...selectedIds, proj.id]);
                              } else {
                                onChange(selectedIds.filter((id) => id !== proj.id));
                              }
                            }}
                          >
                            <span className="truncate">{proj.title}</span>
                          </MenuCheckboxItem>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
}

export function ConnectorModal({
  open,
  onOpenChange,
  environmentId,
  platforms,
  initial,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly platforms: ReadonlyArray<IssueAutomationPlatformDescriptor>;
  readonly initial: IssueAutomationConnector | null;
}) {
  const gt = useGT();
  const saveConnector = useAtomCommand(issueAutomationEnvironment.saveConnector, {
    reportFailure: false,
  });

  const implementedPlatforms = platforms.filter((p) => p.implemented);
  const defaultPlatform =
    initial?.platform ??
    implementedPlatforms[0]?.platform ??
    IssueAutomationPlatformKind.make("zentao");

  const [platform, setPlatform] = useState<string>(defaultPlatform);
  const [name, setName] = useState(initial?.name ?? "内部禅道");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [account, setAccount] = useState(initial?.account ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const selectedPlatformDesc = platforms.find((p) => p.platform === platform) ?? platforms[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim() || !account.trim()) return;
    setBusy(true);
    setErrorText(null);
    const res = await saveConnector({
      environmentId,
      input: {
        ...(initial ? { id: initial.id } : {}),
        platform: IssueAutomationPlatformKind.make(platform),
        name: name.trim() || "内部禅道",
        baseUrl: baseUrl.trim(),
        account: account.trim(),
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      },
    });
    setBusy(false);
    if (res._tag === "Failure") {
      const err = squashAtomCommandFailure(res);
      setErrorText(err instanceof Error ? err.message : gt("Connection verification failed."));
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg" style={MODAL_POPUP_STYLE}>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {initial ? <T>Edit platform connection</T> : <T>Connect issue platform</T>}
          </DialogTitle>
          <DialogDescription>
            <T>
              Credentials are encrypted on the local T3 server and verified immediately against your
              tracker.
            </T>
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <form
            id="issue-automation-connector-form"
            className="min-w-0 space-y-4"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <div className="space-y-1.5">
              <Label>
                <T>Platform adapter</T>
              </Label>
              <Select
                value={platform}
                onValueChange={(next) => {
                  if (next) setPlatform(next);
                }}
              >
                <SelectTrigger aria-label={gt("Platform adapter")}>
                  <SelectValue>{selectedPlatformDesc?.displayName ?? platform}</SelectValue>
                </SelectTrigger>
                <SelectPopup style={SELECTOR_SCROLL_LIST_STYLE}>
                  {platforms.map((item) => (
                    <SelectItem
                      key={item.platform}
                      value={item.platform}
                      disabled={!item.implemented}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{item.displayName}</span>
                        {!item.implemented ? (
                          <Badge variant="outline" size="sm">
                            <T>Plugin slot</T>
                          </Badge>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connector-name">
                <T>Display name</T>
              </Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={gt("e.g. Internal ZenTao")}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connector-url">
                <T>Server URL</T>
              </Label>
              <Input
                id="connector-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={gt("https://zentao.example.com/zentao")}
                required
              />
              <p className="text-xs text-muted-foreground">
                <T>Paste the root address or any bug-browse page URL.</T>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="connector-account">
                  <T>Account</T>
                </Label>
                <Input
                  id="connector-account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder={gt("Username")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connector-secret">
                  <T>Password or token</T>
                </Label>
                <SecretInput
                  id="connector-secret"
                  configured={initial?.hasSecret === true}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={gt("Password")}
                  required={!initial?.hasSecret}
                />
              </div>
            </div>

            {errorText ? (
              <Alert variant="error">
                <AlertTitle>{gt("Verification failed")}</AlertTitle>
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </DialogPanel>

        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            <T>Cancel</T>
          </Button>
          <DialogAction form="issue-automation-connector-form" type="submit" disabled={busy}>
            {busy ? <T>Verifying…</T> : <T>Verify & save</T>}
          </DialogAction>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ProfileModal({
  open,
  onOpenChange,
  environmentId,
  connectors,
  projects,
  initial,
  defaultConnectorId,
  defaultScopeId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly connectors: ReadonlyArray<IssueAutomationConnector>;
  readonly projects: ReadonlyArray<SelectableProjectOption>;
  readonly initial: IssueAutomationProfile | null;
  readonly defaultConnectorId?: IssueAutomationConnectorId | undefined;
  readonly defaultScopeId?: string | undefined;
}) {
  const gt = useGT();
  const actionModeLabel = useActionModeLabel();
  const pressedWithPickerOpen = useRef(false);
  const saveProfile = useAtomCommand(issueAutomationEnvironment.saveProfile, {
    reportFailure: false,
  });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const canCreateProject = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const projectBaseDirectory =
    useEnvironment(environmentId)?.serverConfig?.settings.addProjectBaseDirectory;
  const folderPicker = useEnvironmentFolderPicker(environmentId);
  const catalog = useOfficialModelCatalog(environmentId);

  const firstConnector =
    connectors.find((c) => c.id === (initial?.connectorId ?? defaultConnectorId)) ?? connectors[0];
  const [connectorId, setConnectorId] = useState<string>(firstConnector?.id ?? "");
  const activeConnector = connectors.find((c) => c.id === connectorId) ?? firstConnector;

  const activeSortedScopes = activeConnector ? sortScopesByIdDesc(activeConnector.scopes) : [];
  const initialScope = initial?.scopeId ?? defaultScopeId ?? activeSortedScopes[0]?.id ?? "";
  const [scopeId, setScopeId] = useState<string>(initialScope);
  const [name, setName] = useState(
    initial?.name ?? activeSortedScopes.find((s) => s.id === initialScope)?.name ?? "",
  );
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);

  const [primaryProjectId, setPrimaryProjectId] = useState<string>(
    initial?.repositories.primaryProjectId ?? projects[0]?.id ?? "",
  );
  const primaryProject = projects.find((project) => project.id === primaryProjectId);
  const [linkedProjectIds, setLinkedProjectIds] = useState<ReadonlyArray<ProjectId>>(
    () =>
      initial?.repositories.linkedProjectIds.filter(
        (id) => id !== initial.repositories.primaryProjectId,
      ) ?? [],
  );
  const [moduleMappings, setModuleMappings] = useState<
    ReadonlyArray<IssueAutomationModuleRepoMapping>
  >(initial?.repositories.moduleMappings ?? []);
  const [draftPattern, setDraftPattern] = useState("");
  const [draftRuleProjectId, setDraftRuleProjectId] = useState<string>(projects[0]?.id ?? "");

  const [primaryModel, setPrimaryModel] = useState<ModelSelection | null>(
    initial?.models.primaryModel ?? catalog.firstAvailableSelection,
  );
  if (primaryModel === null && catalog.firstAvailableSelection) {
    setPrimaryModel(catalog.firstAvailableSelection);
  }
  const [highSeverityModel, setHighSeverityModel] = useState<ModelSelection | null>(
    initial?.models.highSeverityModel ?? null,
  );
  const [reviewModel, setReviewModel] = useState<ModelSelection | null>(
    initial?.models.reviewModel ?? null,
  );
  const [retryWithBackup, setRetryWithBackup] = useState(initial?.models.fallbackModel != null);
  const [fallbackModel, setFallbackModel] = useState<ModelSelection | null>(
    initial?.models.fallbackModel ?? null,
  );

  const [browseType, setBrowseType] = useState<IssueAutomationBrowseFilter>(
    initial?.filter.browseType ?? "unresolved",
  );
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState<boolean>(
    initial?.filter.onlyUnconfirmed ?? false,
  );
  const [assignedToAccount, setAssignedToAccount] = useState<string>(
    initial?.filter.assignedToAccount ?? "",
  );
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState<number>(
    initial?.filter.pollIntervalMinutes ?? 5,
  );
  const [maxConcurrency, setMaxConcurrency] = useState<number>(initial?.filter.maxConcurrency ?? 2);

  const [actionMode, setActionMode] = useState<IssueAutomationActionMode>(
    initial?.policy.actionMode ?? "fix_worktree_review",
  );
  const [autoWriteComment, setAutoWriteComment] = useState<boolean>(
    initial?.policy.autoWriteComment ?? true,
  );
  const [baseBranch, setBaseBranch] = useState<string>(initial?.policy.baseBranch ?? "");
  const [customPromptInstructions, setCustomPromptInstructions] = useState<string>(
    initial?.policy.customPromptInstructions ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const addProject = async (workspaceRoot: string) => {
    setAddingProject(true);
    setProjectError(null);
    try {
      const projectId = newProjectId();
      const result = await createProject({
        environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(workspaceRoot),
          workspaceRoot,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPrimaryProjectId(projectId);
      setDraftRuleProjectId((current) => current || projectId);
      await waitForProject(scopeProjectRef(environmentId, projectId));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : gt("Failed to add project"));
    } finally {
      setAddingProject(false);
    }
  };

  function writeBackDescription(): string {
    switch (actionMode) {
      case "fix_worktree_review":
        return autoWriteComment
          ? gt("Post the diagnosis and repair report as a bug comment.")
          : gt("The fix stays in the worktree. The ZenTao bug stays unchanged.");
      case "diagnose_only":
        return autoWriteComment
          ? gt("Post the root cause report as a bug comment.")
          : gt("The report stays in T3 Code. The ZenTao bug stays unchanged.");
      case "auto_resolve":
        return autoWriteComment
          ? gt("Post the repair report as a bug comment and try to mark the bug as resolved.")
          : gt(
              "The fix still runs in the worktree. No comment is posted and the bug is not marked as resolved.",
            );
    }
  }

  const browseFilterLabel = (val: IssueAutomationBrowseFilter): string => {
    switch (val) {
      case "unresolved":
        return gt("Unresolved bugs");
      case "unclosed":
        return gt("Unclosed bugs");
      case "assigntome":
        return gt("Assigned to me");
      case "openedbyme":
        return gt("Opened by me");
      case "all":
        return gt("All bugs");
    }
  };

  const selectProduct = (product: IssueAutomationRemoteScope | undefined) => {
    setScopeId(product?.id ?? "");
    setName(product?.name ?? "");
  };

  const addMappingRule = () => {
    if (!draftPattern.trim() || !draftRuleProjectId) return;
    setModuleMappings((prev) => [
      ...prev,
      { pattern: draftPattern.trim(), projectId: draftRuleProjectId as ProjectId },
    ]);
    setDraftPattern("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedPrimaryModel = primaryModel ?? catalog.firstAvailableSelection;
    if (!activeConnector || !scopeId || !primaryProject || !resolvedPrimaryModel) {
      setErrorText(gt("Please select a product, local repository, and primary model."));
      return;
    }

    if (retryWithBackup && !fallbackModel) {
      setErrorText(gt("Choose a backup model to retry the task."));
      return;
    }

    const scopeObj = activeConnector.scopes.find((s) => s.id === scopeId);
    const scopeName = scopeObj?.name ?? scopeId;
    setBusy(true);
    setErrorText(null);
    const res = await saveProfile({
      environmentId,
      input: {
        ...(initial ? { id: initial.id } : {}),
        connectorId: activeConnector.id,
        name: name.trim() || `${scopeName} 自动诊断规则`,
        enabled,
        scopeId,
        scopeName,
        repositories: {
          primaryProjectId: primaryProject.id,
          linkedProjectIds: [primaryProject.id, ...linkedProjectIds],
          moduleMappings: [...moduleMappings],
        },
        models: {
          primaryModel: resolvedPrimaryModel,
          highSeverityModel,
          triageModel: initial?.models.triageModel ?? null,
          reviewModel,
          fallbackModel: retryWithBackup ? fallbackModel : null,
        },
        filter: {
          browseType,
          onlyUnconfirmed,
          assignedToAccount: assignedToAccount.trim() || null,
          maxSeverity: null,
          keyword: null,
          pollIntervalMinutes: Math.max(1, pollIntervalMinutes),
          maxConcurrency: Math.max(1, Math.min(8, maxConcurrency)),
        },
        policy: {
          actionMode,
          autoWriteComment,
          baseBranch: baseBranch.trim() || null,
          customPromptInstructions: customPromptInstructions.trim() || null,
        },
      },
    });
    setBusy(false);
    if (res._tag === "Failure") {
      const err = squashAtomCommandFailure(res);
      setErrorText(err instanceof Error ? err.message : gt("Failed to save automation profile."));
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (details.reason === "outside-press" && pressedWithPickerOpen.current) {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogPopup
        className="max-w-2xl"
        style={MODAL_POPUP_STYLE}
        onViewportPointerDownCapture={(event) => {
          // Pickers can dismiss on pointerdown before the dialog handles the same click.
          pressedWithPickerOpen.current = !!event.currentTarget.querySelector(
            '[aria-haspopup][aria-expanded="true"]',
          );
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {initial ? <T>Edit unattended rule</T> : <T>New unattended automation rule</T>}
          </DialogTitle>
          <DialogDescription>
            <T>
              Configure product scope, multi-codebase routing, multi-model orchestration, and ZenTao
              write-back policy.
            </T>
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <form
            id="issue-automation-profile-form"
            className="min-w-0 space-y-5"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <SettingsGroup>
              <SettingsRow
                title={gt("Platform connection")}
                control={
                  <Select
                    value={connectorId}
                    onValueChange={(next) => {
                      if (!next || next === connectorId) return;
                      setConnectorId(next);
                      const nextConn = connectors.find((c) => c.id === next);
                      const nextSorted = nextConn ? sortScopesByIdDesc(nextConn.scopes) : [];
                      selectProduct(nextSorted[0]);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={gt("Platform connection")}>
                      <SelectValue>{activeConnector?.name ?? gt("Select")}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup style={SELECTOR_SCROLL_LIST_STYLE}>
                      {connectors.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.account})
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title={gt("ZenTao product")}
                description={gt("Choose which product's bug list this rule monitors.")}
                control={
                  <SearchableScopeMenu
                    scopes={activeConnector?.scopes ?? []}
                    value={scopeId}
                    onChange={(next) => {
                      if (next !== scopeId)
                        selectProduct(activeSortedScopes.find((s) => s.id === next));
                    }}
                    ariaLabel={gt("Select ZenTao product")}
                    className="max-w-60"
                  />
                }
              />

              <SettingsRow
                title={gt("Rule name")}
                control={
                  <Input
                    size="sm"
                    className="w-56"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={gt("Auto-diagnosis rule")}
                  />
                }
              />

              <SettingsRow
                title={gt("Enable background polling")}
                description={gt("Unattended daemon polls ZenTao on schedule and skips seen bugs.")}
                control={
                  <Switch
                    size="sm"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    aria-label={gt("Enable background polling")}
                  />
                }
              />

              <SettingsRow
                title={gt("Filter & schedule")}
                description={gt("Scope filter, interval in minutes, and max parallel runs.")}
                control={
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={browseType}
                      onValueChange={(next) => {
                        if (next) setBrowseType(next as IssueAutomationBrowseFilter);
                      }}
                    >
                      <SelectTrigger size="sm" className="min-w-32" aria-label={gt("Scope")}>
                        <SelectValue>{browseFilterLabel(browseType)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="unresolved">
                          {browseFilterLabel("unresolved")}
                        </SelectItem>
                        <SelectItem value="unclosed">{browseFilterLabel("unclosed")}</SelectItem>
                        <SelectItem value="assigntome">
                          {browseFilterLabel("assigntome")}
                        </SelectItem>
                        <SelectItem value="openedbyme">
                          {browseFilterLabel("openedbyme")}
                        </SelectItem>
                        <SelectItem value="all">{browseFilterLabel("all")}</SelectItem>
                      </SelectPopup>
                    </Select>
                    <Input
                      size="sm"
                      type="number"
                      min={1}
                      max={1440}
                      className="w-20"
                      aria-label={gt("Poll interval minutes")}
                      value={String(pollIntervalMinutes)}
                      onChange={(e) => setPollIntervalMinutes(Number(e.target.value) || 5)}
                    />
                    <Input
                      size="sm"
                      type="number"
                      min={1}
                      max={8}
                      className="w-16"
                      aria-label={gt("Max concurrency")}
                      value={String(maxConcurrency)}
                      onChange={(e) => setMaxConcurrency(Number(e.target.value) || 2)}
                    />
                  </div>
                }
              />

              <SettingsRow
                title={gt("Assignee filter & unconfirmed only")}
                description={gt("Optional account filter or restrict to unconfirmed bugs.")}
                control={
                  <div className="flex items-center gap-3">
                    <Input
                      size="sm"
                      className="w-40"
                      value={assignedToAccount}
                      onChange={(e) => setAssignedToAccount(e.target.value)}
                      placeholder={gt("Any assignee")}
                    />
                    <Switch
                      size="sm"
                      checked={onlyUnconfirmed}
                      onCheckedChange={setOnlyUnconfirmed}
                      aria-label={gt("Unconfirmed bugs only")}
                    />
                  </div>
                }
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsRow
                title={gt("Primary local codebase")}
                description={
                  projects.length === 0
                    ? gt("Add a project before saving this rule.")
                    : gt("Default repository where isolated Worktrees launch.")
                }
                control={
                  projects.length === 0 || addingProject ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={addingProject || !canCreateProject || !folderPicker.canPickFolder}
                      onClick={() =>
                        void folderPicker.openFolderPicker({
                          ...(projectBaseDirectory ? { initialPath: projectBaseDirectory } : {}),
                          onSelect: (workspaceRoot) => void addProject(workspaceRoot),
                        })
                      }
                    >
                      <PlusIcon />
                      {addingProject ? gt("Adding…") : gt("Add project")}
                    </Button>
                  ) : (
                    <SearchableProjectMenu
                      projects={projects}
                      value={primaryProjectId}
                      onChange={(next) => {
                        setPrimaryProjectId(next);
                        setLinkedProjectIds((ids) => ids.filter((id) => id !== next));
                      }}
                      ariaLabel={gt("Primary local codebase")}
                      leadingIcon={<FolderGit2Icon className="size-3.5 shrink-0 opacity-70" />}
                    />
                  )
                }
              >
                {projectError ? (
                  <p role="alert" className="pt-2 text-xs text-destructive">
                    {projectError}
                  </p>
                ) : null}
              </SettingsRow>

              <SettingsRow
                title={gt("Linked sibling codebases")}
                description={gt(
                  "Associate multiple local repos so cross-service context is mounted together.",
                )}
                control={
                  <SearchableMultiProjectMenu
                    projects={projects.filter((project) => project.id !== primaryProjectId)}
                    selectedIds={linkedProjectIds}
                    onChange={setLinkedProjectIds}
                    ariaLabel={gt("Linked sibling codebases")}
                  />
                }
              />

              <SettingsRow
                title={gt("Module & keyword routing")}
                description={gt(
                  "Route matching ZenTao modules or title keywords to a specific repo.",
                )}
              >
                <div className="mt-2 space-y-2 pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      size="sm"
                      className="min-w-44 flex-1"
                      value={draftPattern}
                      onChange={(e) => setDraftPattern(e.target.value)}
                      placeholder={gt("Keyword, e.g. Android / iOS / API")}
                    />
                    <SearchableProjectMenu
                      projects={projects}
                      value={draftRuleProjectId}
                      onChange={setDraftRuleProjectId}
                      ariaLabel={gt("Target repo")}
                      className="w-44 min-w-0"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addMappingRule}>
                      <PlusIcon className="size-3.5" />
                      <T>Add</T>
                    </Button>
                  </div>
                  {moduleMappings.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {moduleMappings.map((m, idx) => {
                        const projName =
                          projects.find((p) => p.id === m.projectId)?.title ?? m.projectId;
                        return (
                          <Badge key={`${m.pattern}-${String(idx)}`} variant="secondary">
                            <span className="font-mono">{m.pattern}</span> → {projName}
                            <button
                              type="button"
                              aria-label={gt("Remove mapping rule")}
                              onClick={() =>
                                setModuleMappings((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="ml-1 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2Icon className="size-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </SettingsRow>
            </SettingsGroup>

            <SettingsGroup>
              <SettingsRow
                title={gt("Primary diagnosis & fix model")}
                control={
                  <OfficialModelPicker
                    environmentId={environmentId}
                    value={primaryModel}
                    onChange={setPrimaryModel}
                    ariaLabel={gt("Primary model")}
                  />
                }
              />

              <SettingsRow
                title={gt("S1/S2 high-severity escalation model")}
                description={gt("Automatically upgrade model for critical bugs.")}
                control={
                  <OfficialModelPicker
                    environmentId={environmentId}
                    value={highSeverityModel}
                    onChange={setHighSeverityModel}
                    ariaLabel={gt("High-severity model")}
                    emptyOptionLabel={gt("Same as primary")}
                  />
                }
              />

              <SettingsRow
                title={gt("Heterogeneous cross-review model")}
                description={gt(
                  "Only in fix modes. A second model reviews changes and test results before writing back to ZenTao.",
                )}
                control={
                  <OfficialModelPicker
                    environmentId={environmentId}
                    value={reviewModel}
                    onChange={setReviewModel}
                    ariaLabel={gt("Cross-review model")}
                    emptyOptionLabel={gt("Disabled")}
                  />
                }
              />

              <SettingsRow
                title={gt("Repository selection")}
                description={gt(
                  "First match module or keyword rules, then look for a repository name in the issue. If nothing matches, use the default repository.",
                )}
              />

              <SettingsRow
                title={gt("If the primary model fails")}
                control={
                  <Select
                    value={retryWithBackup ? "retry" : "stop"}
                    onValueChange={(next) => {
                      if (next) setRetryWithBackup(next === "retry");
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={gt("If the primary model fails")}>
                      <SelectValue>
                        {retryWithBackup
                          ? gt("Retry once with a backup model")
                          : gt("End the task")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="stop">{gt("End the task")}</SelectItem>
                      <SelectItem value="retry">{gt("Retry once with a backup model")}</SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
              {retryWithBackup && (
                <SettingsRow
                  title={gt("Backup model")}
                  control={
                    <OfficialModelPicker
                      environmentId={environmentId}
                      value={fallbackModel}
                      onChange={setFallbackModel}
                      ariaLabel={gt("Backup model")}
                      emptyOptionLabel={fallbackModel ? undefined : gt("Select a model…")}
                    />
                  }
                />
              )}
            </SettingsGroup>

            <SettingsGroup>
              <SettingsRow
                title={gt("Execution mode")}
                control={
                  <Select
                    value={actionMode}
                    onValueChange={(next) => {
                      if (next) setActionMode(next as IssueAutomationActionMode);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={gt("Execution mode")}>
                      <SelectValue>{actionModeLabel(actionMode)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="fix_worktree_review">
                        {actionModeLabel("fix_worktree_review")}
                      </SelectItem>
                      <SelectItem value="diagnose_only">
                        {actionModeLabel("diagnose_only")}
                      </SelectItem>
                      <SelectItem value="auto_resolve">
                        {actionModeLabel("auto_resolve")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title={gt("Automatically write back to ZenTao")}
                description={
                  <span id="issue-rule-write-back-description" aria-live="polite">
                    {writeBackDescription()}
                  </span>
                }
                control={
                  <Switch
                    size="sm"
                    checked={autoWriteComment}
                    onCheckedChange={setAutoWriteComment}
                    aria-label={gt("Automatically write back to ZenTao")}
                    aria-describedby="issue-rule-write-back-description"
                  />
                }
              />

              <SettingsRow
                title={gt("Worktree base branch")}
                control={
                  <Input
                    size="sm"
                    className="w-48"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder={gt("Default HEAD")}
                  />
                }
              />

              <SettingsRow title={gt("Custom team prompt instructions")}>
                <div className="mt-2 pb-2">
                  <Textarea
                    rows={2}
                    value={customPromptInstructions}
                    onChange={(e) => setCustomPromptInstructions(e.target.value)}
                    placeholder={gt(
                      "e.g. Run unit tests before finishing and list affected API routes.",
                    )}
                  />
                </div>
              </SettingsRow>
            </SettingsGroup>

            {errorText ? (
              <Alert variant="error">
                <AlertTitle>{gt("Could not save rule")}</AlertTitle>
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </DialogPanel>

        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            <T>Cancel</T>
          </Button>
          <DialogAction
            form="issue-automation-profile-form"
            type="submit"
            disabled={busy || addingProject || !primaryProject}
          >
            {busy ? <T>Saving…</T> : <T>Save rule</T>}
          </DialogAction>
        </DialogFooter>
      </DialogPopup>
      {folderPicker.dialogProps ? <FolderPickerDialog {...folderPicker.dialogProps} /> : null}
    </Dialog>
  );
}
