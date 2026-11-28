import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  isIssueAutomationFeishuWebhook,
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
  type IssueAutomationStartConnectorAuthResult,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { T, useGT, Var } from "gt-react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  OfficialModelPicker,
  useOfficialModelCatalog,
} from "~/components/chat/OfficialModelPicker";
import {
  FolderPickerDialog,
  useEnvironmentFolderPicker,
} from "~/components/repositories/FolderPickerDialog";
import { SecretInput } from "~/components/settings/SecretInput";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn, newProjectId } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { waitForProject } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { issueAutomationEnvironment } from "~/state/issueAutomation";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentScope, usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly platforms: ReadonlyArray<IssueAutomationPlatformDescriptor>;
  readonly initial: IssueAutomationConnector | null;
  readonly onSaved?: ((connector: IssueAutomationConnector) => void) | undefined;
}) {
  const gt = useGT();
  const callbackBaseUrl = Option.getOrUndefined(usePreparedConnection(environmentId))?.httpBaseUrl;
  const canAuthorize = useAtomValue(
    issueAutomationEnvironment.startConnectorAuth.permissionAtom(environmentId),
  );
  const startAuthorization = useAtomCommand(issueAutomationEnvironment.startConnectorAuth, {
    reportFailure: false,
  });
  const finishAuthorization = useAtomCommand(issueAutomationEnvironment.finishConnectorAuth, {
    reportFailure: false,
  });

  const implementedPlatforms = platforms.filter((p) => p.implemented);
  const defaultPlatform =
    initial?.platform ??
    implementedPlatforms[0]?.platform ??
    IssueAutomationPlatformKind.make("zentao");

  const [platform, setPlatform] = useState<string>(defaultPlatform);
  const [name, setName] = useState(initial?.name ?? "");
  const [mcpUrl, setMcpUrl] = useState(initial?.mcpUrl ?? "");
  const [authorization, setAuthorization] =
    useState<IssueAutomationStartConnectorAuthResult | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const pendingCallback = useRef<AbortController | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel the pending authorization RPC when the dialog unmounts.
  useEffect(() => () => pendingCallback.current?.abort(), []);

  const selectedPlatformDesc = platforms.find((p) => p.platform === platform) ?? platforms[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !canAuthorize ||
      busy ||
      (authorization
        ? authorization.automatic || !callbackUrl.trim()
        : !mcpUrl.trim() || !name.trim())
    )
      return;
    setBusy(true);
    setErrorText(null);
    if (authorization) {
      const result = await finishAuthorization({
        environmentId,
        input: {
          attemptId: authorization.attemptId,
          callbackUrl: Redacted.make(callbackUrl.trim()),
        },
      });
      setBusy(false);
      if (result._tag === "Success") {
        onSaved?.(result.value);
        onOpenChange(false);
      } else {
        const error = squashAtomCommandFailure(result);
        setErrorText(
          error instanceof Error ? error.message : gt("Connection verification failed."),
        );
      }
      return;
    }

    const result = await startAuthorization({
      environmentId,
      input: {
        ...(initial ? { id: initial.id } : {}),
        platform: IssueAutomationPlatformKind.make(platform),
        name: name.trim(),
        mcpUrl: mcpUrl.trim(),
        baseUrl: initial?.baseUrl ?? "",
        ...(callbackBaseUrl === undefined ? {} : { callbackBaseUrl }),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setErrorText(error instanceof Error ? error.message : gt("Connection verification failed."));
      return;
    }
    setAuthorization(result.value);
    if (!result.value.automatic) return;

    const controller = new AbortController();
    pendingCallback.current = controller;
    const completed = await finishAuthorization(
      { environmentId, input: { attemptId: result.value.attemptId } },
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    pendingCallback.current = null;
    if (completed._tag === "Success") {
      onSaved?.(completed.value);
      void window.desktopBridge?.revealWindow?.().catch(() => undefined);
      onOpenChange(false);
    } else {
      setAuthorization(null);
      const error = squashAtomCommandFailure(completed);
      setErrorText(error instanceof Error ? error.message : gt("Connection verification failed."));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) pendingCallback.current?.abort();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-lg" style={MODAL_POPUP_STYLE}>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {initial ? <T>Edit platform connection</T> : <T>Connect issue platform</T>}
          </DialogTitle>
          <DialogDescription>
            {authorization?.automatic ? (
              <T>T3 Code completes the connection after you approve access in your browser.</T>
            ) : authorization ? (
              <T>
                Approve access in your browser. It then opens a page that may not load: copy that
                page's address and paste it here.
              </T>
            ) : initial?.mcpUrl === null ? (
              <T>Connect the same ZenTao instance through MCP to restore its existing rules.</T>
            ) : (
              <T>Enter your ZenTao MCP service URL, then authorize in your browser.</T>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <form
            id="issue-automation-connector-form"
            className="min-w-0 space-y-4"
            onSubmit={(e) => void handleSubmit(e)}
          >
            {authorization ? (
              <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-3.5">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void ensureLocalApi().shell.openExternal(authorization.authorizationUrl)
                  }
                >
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                  <T>Open sign-in page</T>
                </Button>
                {!authorization.automatic ? (
                  <label className="grid gap-1.5 text-xs font-medium text-foreground">
                    <T>Address of the page your browser opened</T>
                    <Input
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={16_384}
                      disabled={busy}
                      required
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <fieldset
                disabled={busy}
                className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-3.5 min-w-0"
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
                  <Label htmlFor="connector-mcp-url">
                    <T>MCP service URL</T>
                  </Label>
                  <Input
                    id="connector-mcp-url"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    placeholder="https://mcp.example.com/zentao/mcp"
                    type="url"
                    spellCheck={false}
                    required
                  />
                </div>
              </fieldset>
            )}

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
            onClick={() => {
              pendingCallback.current?.abort();
              onOpenChange(false);
            }}
          >
            <T>Cancel</T>
          </Button>
          {authorization ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                pendingCallback.current?.abort();
                setAuthorization(null);
                setCallbackUrl("");
                setErrorText(null);
              }}
            >
              <T>Start over</T>
            </Button>
          ) : null}
          {!authorization?.automatic ? (
            <DialogAction
              form="issue-automation-connector-form"
              type="submit"
              disabled={busy || !canAuthorize}
            >
              {busy ? (
                <T>Verifying…</T>
              ) : authorization ? (
                <T>Verify & save</T>
              ) : (
                <T>Authorize MCP</T>
              )}
            </DialogAction>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RuleSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details
      className="group/rule-section min-w-0 rounded-xl border border-border/70 bg-card/40 transition-colors mb-3.5 overflow-hidden"
      open
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden transition-colors">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground in-[details[open]>summary]:rotate-90 transition-transform duration-150"
        />
        <span className="font-semibold text-foreground tracking-normal text-sm">{title}</span>
        {summary && (
          <span className="ms-auto min-w-0 truncate text-right text-xs font-normal text-muted-foreground/80 font-mono">
            {summary}
          </span>
        )}
      </summary>
      <div className="min-w-0 space-y-3.5 px-4 pb-4 pt-1 border-t border-border/40">{children}</div>
    </details>
  );
}

function RuleField({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground">{title}</span>
      {children}
    </div>
  );
}

function focusRuleField(container: HTMLDivElement | null) {
  if (!container) return;
  const section = container.closest("details");
  if (section) section.open = true;
  (
    container.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)") ??
    section?.querySelector("summary")
  )?.focus();
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
  const serverConfig = useEnvironment(environmentId)?.serverConfig;
  const projectBaseDirectory = serverConfig?.settings.addProjectBaseDirectory;
  const supportsFeishuNotifications =
    serverConfig?.environment.capabilities.issueAutomationFeishuNotifications === true ||
    initial?.feishuNotification !== undefined;
  const folderPicker = useEnvironmentFolderPicker(environmentId);
  const [actionMode, setActionMode] = useState<IssueAutomationActionMode>(
    initial?.policy.actionMode ?? "fix_worktree_review",
  );
  const diagnosisOnly = actionMode === "diagnose_only";
  const catalog = useOfficialModelCatalog(environmentId, diagnosisOnly);

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
  const resolvedPrimaryModel =
    diagnosisOnly && !catalog.isSelectionAvailable(primaryModel)
      ? catalog.firstAvailableSelection
      : (primaryModel ?? catalog.firstAvailableSelection);
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

  const [autoWriteComment, setAutoWriteComment] = useState<boolean>(
    initial?.policy.autoWriteComment ?? true,
  );
  const [baseBranch, setBaseBranch] = useState<string>(initial?.policy.baseBranch ?? "");
  const [customPromptInstructions, setCustomPromptInstructions] = useState<string>(
    initial?.policy.customPromptInstructions ?? "",
  );
  const [notifyFeishu, setNotifyFeishu] = useState(initial?.feishuNotification?.enabled ?? false);
  const [feishuWebhook, setFeishuWebhook] = useState("");
  const [feishuWebhookInvalid, setFeishuWebhookInvalid] = useState(false);
  const hasFeishuWebhook = initial?.feishuNotification?.hasWebhook ?? false;

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
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        setProjectError(error instanceof Error ? error.message : gt("Failed to add project"));
      } else {
        setPrimaryProjectId(projectId);
        setDraftRuleProjectId((current) => current || projectId);
        await waitForProject(scopeProjectRef(environmentId, projectId));
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : gt("Failed to add project"));
    }
    setAddingProject(false);
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

  const modelField = useRef<HTMLDivElement>(null);
  const repoField = useRef<HTMLDivElement>(null);
  const backupField = useRef<HTMLDivElement>(null);
  const feishuWebhookField = useRef<HTMLDivElement>(null);
  const pollingSummary = enabled
    ? gt("Every {minutes} min", { minutes: pollIntervalMinutes })
    : gt("Polling off");
  const executionSummary = [
    actionMode === "diagnose_only" ? gt("Read-only diagnosis") : gt("Worktree fix"),
    !autoWriteComment
      ? gt("No write-back")
      : actionMode === "auto_resolve"
        ? gt("Comment and try to mark resolved")
        : gt("Comment only"),
  ].join(" · ");
  const primaryModelName =
    catalog.instanceEntries
      .find((entry) => entry.instanceId === resolvedPrimaryModel?.instanceId)
      ?.models.find((model) => model.slug === resolvedPrimaryModel?.model)?.name ??
    resolvedPrimaryModel?.model;
  const modelSummary = [
    primaryModelName ?? gt("Select a model…"),
    highSeverityModel && gt("S1/S2"),
    reviewModel && actionMode !== "diagnose_only" && gt("Cross-review model"),
    retryWithBackup && gt("Retry once with a backup model"),
  ]
    .filter(Boolean)
    .join(" · ");
  const repoSummary = [
    primaryProject?.title ?? gt("Select repository"),
    linkedProjectIds.length > 0 && gt("Linked: {count}", { count: linkedProjectIds.length }),
    moduleMappings.length > 0 && gt("Routes: {count}", { count: moduleMappings.length }),
  ]
    .filter(Boolean)
    .join(" · ");
  const filterSummary = [
    browseFilterLabel(browseType),
    assignedToAccount.trim(),
    onlyUnconfirmed && gt("Unconfirmed bugs only"),
    pollingSummary,
  ]
    .filter(Boolean)
    .join(" · ");

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
    if (!activeConnector || !scopeId || !primaryProject || !resolvedPrimaryModel) {
      if (!primaryProject) focusRuleField(repoField.current);
      else if (!resolvedPrimaryModel) focusRuleField(modelField.current);
      setErrorText(gt("Please select a product, local repository, and primary model."));
      return;
    }

    if (
      retryWithBackup &&
      (!fallbackModel || (diagnosisOnly && !catalog.isSelectionAvailable(fallbackModel)))
    ) {
      focusRuleField(backupField.current);
      setErrorText(gt("Choose a backup model to retry the task."));
      return;
    }

    const webhook = notifyFeishu ? feishuWebhook.trim() : "";
    if (
      supportsFeishuNotifications &&
      notifyFeishu &&
      (webhook ? !isIssueAutomationFeishuWebhook(webhook) : !hasFeishuWebhook)
    ) {
      setFeishuWebhookInvalid(true);
      focusRuleField(feishuWebhookField.current);
      return;
    }

    const scopeObj = activeConnector.scopes.find((s) => s.id === scopeId);
    const scopeName = scopeObj?.name ?? scopeId;
    const notification = supportsFeishuNotifications
      ? { enabled: notifyFeishu, ...(webhook ? { webhook: Redacted.make(webhook) } : {}) }
      : undefined;
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
          highSeverityModel:
            diagnosisOnly && !catalog.isSelectionAvailable(highSeverityModel)
              ? null
              : highSeverityModel,
          triageModel: initial?.models.triageModel ?? null,
          reviewModel,
          fallbackModel: retryWithBackup ? fallbackModel : null,
        },
        filter: {
          browseType,
          onlyUnconfirmed,
          assignedToAccount: assignedToAccount.trim() || null,
          maxSeverity: initial?.filter.maxSeverity ?? null,
          keyword: initial?.filter.keyword ?? null,
          pollIntervalMinutes: Math.max(1, Math.min(1440, pollIntervalMinutes)),
          maxConcurrency: Math.max(1, Math.min(8, maxConcurrency)),
        },
        policy: {
          actionMode,
          autoWriteComment,
          baseBranch: baseBranch.trim() || null,
          customPromptInstructions: customPromptInstructions.trim() || null,
        },
        ...(notification ? { feishuNotification: notification } : {}),
      },
    });
    setBusy(false);
    if (res._tag === "Failure") {
      const err = squashAtomCommandFailure(res);
      setErrorText(err instanceof Error ? err.message : gt("Failed to save automation profile."));
      return;
    }
    const savedNotification = res.value.feishuNotification;
    if (
      notification &&
      (savedNotification?.enabled !== notification.enabled ||
        (notification.enabled && !savedNotification?.hasWebhook))
    ) {
      setErrorText(gt("The server did not confirm saving the Feishu notification settings."));
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
            {initial ? <T>Edit unattended rule</T> : <T>New unattended rule</T>}
          </DialogTitle>
          <DialogDescription className="sr-only">
            <T>
              Configure product scope, multi-codebase routing, multi-model orchestration, and ZenTao
              write-back policy.
            </T>
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <form
            id="issue-automation-profile-form"
            className="min-w-0"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <section className="min-w-0 rounded-xl border border-border/70 bg-card/40 p-4 space-y-3.5 mb-3.5">
              <h3 className="text-sm font-semibold text-foreground">
                <T>Monitoring target</T>
              </h3>
              <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
                <RuleField title={gt("Platform connection")}>
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
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </RuleField>
                <RuleField title={gt("ZenTao product")}>
                  <SearchableScopeMenu
                    scopes={activeConnector?.scopes ?? []}
                    value={scopeId}
                    onChange={(next) => {
                      if (next !== scopeId)
                        selectProduct(activeSortedScopes.find((s) => s.id === next));
                    }}
                    ariaLabel={gt("Select ZenTao product")}
                    className="w-full min-w-0"
                  />
                </RuleField>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="issue-rule-name">{gt("Rule name")}</Label>
                <Input
                  size="sm"
                  id="issue-rule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={gt("Auto-diagnosis rule")}
                />
              </div>
            </section>
            <RuleSection title={gt("Filters and schedule")} summary={filterSummary}>
              <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
                <RuleField title={gt("Fetch scope")}>
                  <Select
                    value={browseType}
                    onValueChange={(next) => {
                      if (next) setBrowseType(next as IssueAutomationBrowseFilter);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={gt("Scope")}>
                      <SelectValue>{browseFilterLabel(browseType)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="unresolved">{browseFilterLabel("unresolved")}</SelectItem>
                      <SelectItem value="unclosed">{browseFilterLabel("unclosed")}</SelectItem>
                      <SelectItem value="assigntome">{browseFilterLabel("assigntome")}</SelectItem>
                      <SelectItem value="openedbyme">{browseFilterLabel("openedbyme")}</SelectItem>
                      <SelectItem value="all">{browseFilterLabel("all")}</SelectItem>
                    </SelectPopup>
                  </Select>
                </RuleField>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="issue-rule-account">{gt("Further filter by assignee")}</Label>
                  <Input
                    id="issue-rule-account"
                    size="sm"
                    placeholder={gt("Account (optional)")}
                    value={assignedToAccount}
                    onChange={(e) => setAssignedToAccount(e.target.value)}
                  />
                </div>
              </div>
              <Label>
                <Checkbox checked={onlyUnconfirmed} onCheckedChange={setOnlyUnconfirmed} />
                {gt("Unconfirmed bugs only")}
              </Label>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="issue-rule-poll">{gt("Enable background polling")}</Label>
                <Switch
                  id="issue-rule-poll"
                  size="sm"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label={gt("Enable background polling")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-muted/50 p-3">
                <label className="flex items-center gap-2 text-sm has-disabled:text-muted-foreground">
                  {gt("Check every")}
                  <Input
                    size="sm"
                    type="number"
                    className="w-16"
                    min={1}
                    max={1440}
                    disabled={!enabled}
                    aria-label={gt("Poll interval minutes")}
                    value={String(pollIntervalMinutes)}
                    onChange={(e) => setPollIntervalMinutes(Number(e.target.value) || 5)}
                  />
                  {gt("minutes")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {gt("Run up to")}
                  <Input
                    size="sm"
                    type="number"
                    className="w-16"
                    min={1}
                    max={8}
                    aria-label={gt("Max concurrency")}
                    value={String(maxConcurrency)}
                    onChange={(e) => setMaxConcurrency(Number(e.target.value) || 2)}
                  />
                  {gt("bugs at once")}
                </label>
              </div>
            </RuleSection>
            <RuleSection title={gt("Code repositories")} summary={repoSummary}>
              <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div ref={repoField}>
                  <RuleField title={gt("Primary local codebase")}>
                    {projects.length === 0 || addingProject ? (
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
                    )}
                  </RuleField>
                </div>
                <RuleField title={gt("Linked sibling codebases")}>
                  <SearchableMultiProjectMenu
                    projects={projects.filter((project) => project.id !== primaryProjectId)}
                    selectedIds={linkedProjectIds}
                    onChange={setLinkedProjectIds}
                    ariaLabel={gt("Linked sibling codebases")}
                  />
                </RuleField>
              </div>
              {!projects.length && (
                <p className="text-xs text-muted-foreground">
                  {gt("Add a project before saving this rule.")}
                </p>
              )}
              {projectError && (
                <p role="alert" className="text-xs text-destructive">
                  {projectError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {gt(
                  "First match module or keyword rules, then look for a repository name in the issue. If nothing matches, use the default repository.",
                )}
              </p>
              <RuleSection title={gt("Module & keyword routing")}>
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
              </RuleSection>
            </RuleSection>
            <RuleSection title={gt("Models")} summary={modelSummary}>
              <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div ref={modelField}>
                  <RuleField title={gt("Primary diagnosis & fix model")}>
                    <OfficialModelPicker
                      environmentId={environmentId}
                      value={resolvedPrimaryModel}
                      diagnosisOnly={diagnosisOnly}
                      onChange={setPrimaryModel}
                      ariaLabel={gt("Primary model")}
                    />
                  </RuleField>
                </div>
                <RuleField title={gt("S1/S2 high-severity escalation model")}>
                  <OfficialModelPicker
                    environmentId={environmentId}
                    value={highSeverityModel}
                    diagnosisOnly={diagnosisOnly}
                    onChange={setHighSeverityModel}
                    ariaLabel={gt("High-severity model")}
                    emptyOptionLabel={gt("Same as primary")}
                  />
                </RuleField>
                <RuleField title={gt("Cross-review model")}>
                  <OfficialModelPicker
                    environmentId={environmentId}
                    value={reviewModel}
                    disabled={actionMode === "diagnose_only"}
                    onChange={setReviewModel}
                    ariaLabel={gt("Cross-review model")}
                    emptyOptionLabel={gt("Disabled")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {gt(
                      "Only in fix modes. A second model reviews changes and test results before writing back to ZenTao.",
                    )}
                  </p>
                </RuleField>
                <RuleField title={gt("If the primary model fails")}>
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
                </RuleField>
                {retryWithBackup && (
                  <div ref={backupField}>
                    <RuleField title={gt("Backup model")}>
                      <OfficialModelPicker
                        environmentId={environmentId}
                        value={fallbackModel}
                        diagnosisOnly={diagnosisOnly}
                        onChange={setFallbackModel}
                        ariaLabel={gt("Backup model")}
                        emptyOptionLabel={fallbackModel ? undefined : gt("Select a model…")}
                      />
                    </RuleField>
                  </div>
                )}
              </div>
            </RuleSection>
            <RuleSection title={gt("Execution and write-back")} summary={executionSummary}>
              <RuleField title={gt("Execution mode")}>
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
                    <SelectItem value="auto_resolve">{actionModeLabel("auto_resolve")}</SelectItem>
                  </SelectPopup>
                </Select>
              </RuleField>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="issue-rule-write">{gt("Automatically write back to ZenTao")}</Label>
                <Switch
                  id="issue-rule-write"
                  size="sm"
                  checked={autoWriteComment}
                  onCheckedChange={setAutoWriteComment}
                  aria-label={gt("Automatically write back to ZenTao")}
                  aria-describedby="issue-rule-write-back-description"
                />
              </div>
              <p id="issue-rule-write-back-description" className="text-xs text-muted-foreground">
                {writeBackDescription()}
              </p>
              <RuleSection title={gt("More execution settings")}>
                <RuleField title={gt("Worktree base branch")}>
                  <Input
                    size="sm"
                    aria-label={gt("Worktree base branch")}
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder={gt("Default HEAD")}
                  />
                </RuleField>
                <RuleField title={gt("Custom team prompt instructions")}>
                  <Textarea
                    rows={2}
                    aria-label={gt("Custom team prompt instructions")}
                    value={customPromptInstructions}
                    onChange={(e) => setCustomPromptInstructions(e.target.value)}
                    placeholder={gt(
                      "e.g. Run unit tests before finishing and list affected API routes.",
                    )}
                  />
                </RuleField>
              </RuleSection>
            </RuleSection>
            <RuleSection
              title={gt("Feishu notifications")}
              summary={
                supportsFeishuNotifications
                  ? notifyFeishu
                    ? gt("Enabled")
                    : gt("Disabled")
                  : gt("Unavailable")
              }
            >
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="issue-rule-notify-feishu" id="issue-rule-notify-feishu-label">
                  {gt("Notify Feishu when a task ends")}
                </Label>
                <Switch
                  id="issue-rule-notify-feishu"
                  size="sm"
                  aria-labelledby="issue-rule-notify-feishu-label"
                  aria-describedby={
                    supportsFeishuNotifications ? undefined : "issue-rule-feishu-unavailable"
                  }
                  disabled={!supportsFeishuNotifications}
                  checked={notifyFeishu}
                  onCheckedChange={(checked) => {
                    setNotifyFeishu(checked);
                    setFeishuWebhookInvalid(false);
                  }}
                />
              </div>
              {!supportsFeishuNotifications && (
                <p id="issue-rule-feishu-unavailable" className="text-xs text-muted-foreground">
                  {gt("Update the server to configure Feishu notifications.")}
                </p>
              )}
              {supportsFeishuNotifications && notifyFeishu && (
                <div ref={feishuWebhookField} className="space-y-1.5">
                  <Label htmlFor="issue-rule-feishu-webhook">{gt("Group bot webhook")}</Label>
                  <SecretInput
                    id="issue-rule-feishu-webhook"
                    size="sm"
                    configured={hasFeishuWebhook}
                    value={feishuWebhook}
                    onChange={(event) => {
                      setFeishuWebhook(event.target.value);
                      setFeishuWebhookInvalid(false);
                    }}
                    placeholder={gt("Paste the Feishu group bot webhook")}
                    aria-required={!hasFeishuWebhook}
                    aria-invalid={feishuWebhookInvalid}
                    aria-describedby={
                      feishuWebhookInvalid ? "issue-rule-feishu-webhook-error" : undefined
                    }
                  />
                  {feishuWebhookInvalid && (
                    <p
                      role="alert"
                      id="issue-rule-feishu-webhook-error"
                      className="text-xs text-destructive"
                    >
                      {gt("Enter a valid Feishu group bot webhook.")}
                    </p>
                  )}
                </div>
              )}
            </RuleSection>
          </form>
        </DialogPanel>

        <DialogFooter className="shrink-0">
          <div className="flex w-full flex-col gap-2">
            {errorText ? (
              <Alert variant="error">
                <AlertTitle>{gt("Could not save rule")}</AlertTitle>
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p
                aria-live="polite"
                className="me-auto min-w-0 basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-auto"
              >
                {pollingSummary} · {executionSummary}
              </p>
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
                disabled={busy || addingProject}
              >
                {busy ? <T>Saving…</T> : <T>Save rule</T>}
              </DialogAction>
            </div>
          </div>
        </DialogFooter>
      </DialogPopup>
      {folderPicker.dialogProps ? <FolderPickerDialog {...folderPicker.dialogProps} /> : null}
    </Dialog>
  );
}
