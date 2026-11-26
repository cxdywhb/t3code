import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getCloneDestinationForPickedFolder,
  getCloneDirectoryName,
} from "@t3tools/client-runtime/operations/projects";
import { getBrowseParentPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FILESYSTEM_METADATA_BATCH_LIMIT,
  SourceControlProviderKind,
  type EnvironmentId,
  type SourceControlCloneProtocol,
  type SourceControlRepositorySummary,
} from "@t3tools/contracts";
import { resolvePastedPath } from "@t3tools/shared/path";
import { T, useGT, Var } from "gt-react";
import {
  AlertCircleIcon,
  CheckIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  PencilIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { cn, newProjectId } from "~/lib/utils";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { silenceProjectCloneToasts } from "~/state/projectClones";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FolderPickerDialog, useEnvironmentFolderPicker } from "./FolderPickerDialog";
import {
  computeRepoDestinationPath,
  findDuplicateDestinationPaths,
  normalizeDestinationKey,
  type ClonePathLayout,
  type TrackedCloneBatchItem,
} from "./repositoriesPage.logic";

const GITLAB_PROVIDER = SourceControlProviderKind.make("gitlab");

export function CloneRepositoriesDialog({
  open,
  onOpenChange,
  environmentId,
  host,
  repositories,
  defaultRootPath,
  isAutoManagedRoot,
  defaultProtocol,
  defaultLayout,
  onLayoutChange,
  onBatchStarted,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly host: string;
  readonly repositories: ReadonlyArray<SourceControlRepositorySummary>;
  readonly defaultRootPath: string;
  readonly isAutoManagedRoot: boolean;
  readonly defaultProtocol: SourceControlCloneProtocol;
  readonly defaultLayout: ClonePathLayout;
  readonly onLayoutChange?: (next: ClonePathLayout) => void;
  readonly onBatchStarted: (result: {
    readonly items: ReadonlyArray<TrackedCloneBatchItem>;
    readonly startedRepoIds: ReadonlyArray<string>;
  }) => void;
}) {
  const gt = useGT();
  const rootInputId = useId();
  const [protocol, setProtocol] = useState<SourceControlCloneProtocol>(defaultProtocol);
  const [layout, setLayout] = useState<ClonePathLayout>(defaultLayout);
  const [rootPath, setRootPath] = useState(defaultRootPath);
  const [editingRootManually, setEditingRootManually] = useState(false);
  const [saveAsDefaultRoot, setSaveAsDefaultRoot] = useState(false);
  const [customPaths, setCustomPaths] = useState<Readonly<Record<string, string>>>({});
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startingCount, setStartingCount] = useState(0);

  const folderPicker = useEnvironmentFolderPicker(environmentId);
  const filesystemAccess = useFilesystemReadAccess(environmentId);

  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    label: "clone gitlab repositories",
    reportFailure: false,
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save default clone root directory",
  });

  const planEntries = repositories.map((repo) => {
    const computed = computeRepoDestinationPath({
      rootDirectory: rootPath,
      repo,
      host,
      layout,
    });
    const custom = customPaths[repo.id];
    const isCustomPath = custom !== undefined;
    return {
      repo,
      computedPath: computed,
      destinationPath: custom ?? computed,
      isCustomPath,
    };
  });

  const metadataPaths = Array.from(
    new Set(
      planEntries
        .map((entry) => entry.destinationPath.trim())
        .filter((p) => p.length > 0 && p.length <= 512),
    ),
  ).slice(0, FILESYSTEM_METADATA_BATCH_LIMIT);

  const metadataQuery = useEnvironmentQuery(
    filesystemAccess.canReadFiles && metadataPaths.length > 0
      ? filesystemEnvironment.getMetadata({
          environmentId,
          input: { paths: metadataPaths },
        })
      : null,
  );

  const existingTargetPaths = new Set<string>();
  if (metadataQuery.data) {
    metadataQuery.data.entries.forEach((meta, idx) => {
      const target = metadataPaths[idx];
      if (target && meta !== null) {
        existingTargetPaths.add(normalizeDestinationKey(target));
      }
    });
  }

  const duplicateKeys = findDuplicateDestinationPaths(planEntries);
  const hasEmptyPath = planEntries.some((entry) => entry.destinationPath.trim().length === 0);
  const hasExistingOnDisk = planEntries.some((entry) =>
    existingTargetPaths.has(normalizeDestinationKey(entry.destinationPath)),
  );
  const hasConflicts = duplicateKeys.size > 0 || hasEmptyPath || hasExistingOnDisk;

  const handlePickRootFolder = () => {
    if (submitting) return;
    void folderPicker.openFolderPicker({
      initialPath: rootPath.trim() || defaultRootPath,
      title: gt("Choose target root directory"),
      description: gt("Select the folder where cloned repositories should be placed."),
      onSelect: (picked) => {
        setRootPath(picked);
        setEditingRootManually(false);
      },
    });
  };

  const handlePickRepoFolder = (repo: SourceControlRepositorySummary, currentPath: string) => {
    if (submitting) return;
    const parentInitial = getBrowseParentPath(currentPath) ?? (rootPath.trim() || defaultRootPath);
    void folderPicker.openFolderPicker({
      initialPath: parentInitial,
      title: gt("Choose parent folder for {name}", { name: repo.name }),
      description: gt("The repository will be cloned into a subfolder inside the folder you pick."),
      onSelect: (picked) => {
        const leafName = getCloneDirectoryName(repo.pathWithNamespace) || repo.name;
        const destination = getCloneDestinationForPickedFolder({
          pickedPath: picked,
          cloneDirectoryName: leafName,
          caseSensitive: false,
        });
        setCustomPaths((prev) => ({ ...prev, [repo.id]: destination }));
        setEditingRepoId(null);
      },
    });
  };

  const handleSubmit = async () => {
    if (submitting || repositories.length === 0 || hasConflicts) return;
    setSubmitting(true);
    setStartingCount(0);

    if (saveAsDefaultRoot && rootPath.trim() !== defaultRootPath.trim()) {
      await updateSettings({
        environmentId,
        input: {
          patch: {
            addProjectBaseDirectory: rootPath.trim(),
          },
        },
      });
    }

    const startedRepoIds: string[] = [];
    const batchItems: TrackedCloneBatchItem[] = [];

    for (const entry of planEntries) {
      const destinationPath = entry.destinationPath.trim();
      const remoteUrl = protocol === "https" ? entry.repo.httpUrl : entry.repo.sshUrl;
      const fallbackRemoteUrl = protocol === "auto" ? entry.repo.httpUrl : undefined;
      const projectId = newProjectId();

      // Suppress redundant per-repo progress toasts since progress is shown centrally in the modal.
      silenceProjectCloneToasts(scopeProjectRef(environmentId, projectId));

      const result = await startProjectClone({
        environmentId,
        input: {
          projectId,
          title: entry.repo.name,
          createdAt: new Date().toISOString(),
          provider: GITLAB_PROVIDER,
          remoteUrl,
          ...(fallbackRemoteUrl ? { fallbackRemoteUrl } : {}),
          destinationPath,
          protocol,
        },
      });

      setStartingCount((count) => count + 1);

      if (result._tag === "Success") {
        startedRepoIds.push(entry.repo.id);
        batchItems.push({
          key: projectId,
          repo: entry.repo,
          projectId,
          destinationPath,
          protocol,
          startError: null,
        });
      } else {
        const err = squashAtomCommandFailure(result);
        const detail =
          err instanceof Error && err.message.trim().length > 0
            ? err.message
            : gt("Clone could not be started.");
        batchItems.push({
          key: `error:${entry.repo.id}:${projectId}`,
          repo: entry.repo,
          projectId: null,
          destinationPath,
          protocol,
          startError: detail,
        });
      }
    }

    setSubmitting(false);
    setStartingCount(0);
    onBatchStarted({ items: batchItems, startedRepoIds });
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!submitting) onOpenChange(nextOpen);
        }}
      >
        <DialogPopup className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {repositories.length === 1 ? (
                <T>
                  Clone <Var>{repositories[0]!.name}</Var>
                </T>
              ) : (
                <T>
                  Clone <Var>{repositories.length}</Var> repositories
                </T>
              )}
            </DialogTitle>
            <DialogDescription>
              <T>
                Choose the clone protocol and destination folder. You can also pick a different
                folder for any repository individually.
              </T>
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="flex w-full min-w-0 flex-col gap-4">
              <div className="flex w-full min-w-0 flex-col gap-2">
                <Label>
                  <T>Clone protocol</T>
                </Label>
                <div className="flex flex-wrap">
                  <ToggleGroup
                    multiple={false}
                    value={[protocol]}
                    disabled={submitting}
                    onValueChange={(values) => {
                      const next = values[0] as SourceControlCloneProtocol | undefined;
                      if (next) setProtocol(next);
                    }}
                  >
                    <Toggle value="auto">
                      <T>Auto (SSH → HTTPS)</T>
                    </Toggle>
                    <Toggle value="ssh">
                      <T>SSH only</T>
                    </Toggle>
                    <Toggle value="https">
                      <T>HTTPS (Token)</T>
                    </Toggle>
                  </ToggleGroup>
                </div>
                <p className="text-xs text-muted-foreground">
                  {protocol === "auto"
                    ? gt(
                        "Tries SSH first and automatically falls back to HTTPS using your saved GitLab token if SSH fails.",
                      )
                    : protocol === "ssh"
                      ? gt("Clones over SSH using your local SSH keys without HTTPS fallback.")
                      : gt(
                          "Clones over HTTPS using your saved GitLab token (requires read_repository scope; token is never written to .git/config).",
                        )}
                </p>
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <Label htmlFor={rootInputId}>
                    <T>Target root directory</T>
                  </Label>
                  {isAutoManagedRoot && rootPath === defaultRootPath ? (
                    <Badge size="sm" variant="secondary">
                      <T>Auto-managed</T>
                    </Badge>
                  ) : null}
                </div>

                {editingRootManually || !folderPicker.canPickFolder ? (
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <div className="w-0 min-w-0 flex-1">
                      <Input
                        id={rootInputId}
                        size="sm"
                        font="mono"
                        disabled={submitting}
                        value={rootPath}
                        onChange={(event) =>
                          setRootPath((prev) => resolvePastedPath(prev, event.target.value))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setEditingRootManually(false);
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
                        disabled={submitting}
                        aria-label={gt("Finish editing path")}
                        onClick={() => setEditingRootManually(false)}
                      >
                        <CheckIcon className="size-3.5" />
                      </Button>
                    ) : null}
                    {folderPicker.canPickFolder ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={submitting}
                        onClick={handlePickRootFolder}
                      >
                        <FolderOpenIcon className="size-3.5" />
                        <T>Choose folder…</T>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handlePickRootFolder}
                      className={cn(
                        "flex min-h-9 w-0 min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border border-input bg-background/70 px-3 py-1.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
                      )}
                    >
                      <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex w-0 min-w-0 flex-1 font-mono text-xs text-foreground">
                        <MiddleTruncate showTitle={false} value={rootPath.trim() || "~/projects"} />
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={submitting}
                        onClick={handlePickRootFolder}
                      >
                        <FolderOpenIcon className="size-3.5" />
                        <T>Choose folder…</T>
                      </Button>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={submitting}
                              aria-label={gt("Edit path manually")}
                              onClick={() => setEditingRootManually(true)}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                          }
                        />
                        <TooltipPopup side="top">
                          <T>Edit path manually</T>
                        </TooltipPopup>
                      </Tooltip>

                      {rootPath !== defaultRootPath ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={submitting}
                                aria-label={gt("Reset root directory")}
                                onClick={() => setRootPath(defaultRootPath)}
                              >
                                <RotateCcwIcon className="size-3.5" />
                              </Button>
                            }
                          />
                          <TooltipPopup side="top">
                            <T>Reset to default root</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={saveAsDefaultRoot}
                    disabled={submitting}
                    onCheckedChange={(checked) => setSaveAsDefaultRoot(Boolean(checked))}
                  />
                  <span>
                    <T>Save this folder as the default root directory for future clones</T>
                  </span>
                </label>
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2">
                <Label>
                  <T>Folder organization</T>
                </Label>
                <div className="flex flex-wrap">
                  <ToggleGroup
                    multiple={false}
                    value={[layout]}
                    disabled={submitting}
                    onValueChange={(values) => {
                      const next = values[0] as ClonePathLayout | undefined;
                      if (next) {
                        setLayout(next);
                        onLayoutChange?.(next);
                      }
                    }}
                  >
                    <Toggle value="flat">
                      <T>Flat in target folder</T>
                    </Toggle>
                    <Toggle value="group">
                      <FolderTreeIcon className="size-3.5" />
                      <T>By remote group</T>
                    </Toggle>
                    <Toggle value="ghq">
                      <T>Host + group (ghq)</T>
                    </Toggle>
                  </ToggleGroup>
                </div>
                <p className="text-xs text-muted-foreground">
                  {layout === "flat"
                    ? gt("Places each repository directly inside the target folder (root/repo).")
                    : layout === "group"
                      ? gt(
                          "Creates nested subfolders matching the remote GitLab group path (root/group/repo).",
                        )
                      : gt(
                          "Organizes repositories under host and group subfolders (root/host/group/repo).",
                        )}
                </p>
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <Label>
                    <T>
                      Destination paths (<Var>{planEntries.length}</Var>)
                    </T>
                  </Label>
                  {Object.keys(customPaths).length > 0 ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={submitting}
                      onClick={() => setCustomPaths({})}
                    >
                      <T>Reset custom paths</T>
                    </Button>
                  ) : null}
                </div>
                <div className="max-h-72 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-muted/20 p-2.5">
                  <div className="flex w-full min-w-0 flex-col gap-2">
                    {planEntries.map((entry) => {
                      const normalizedKey = normalizeDestinationKey(entry.destinationPath);
                      const isDuplicate = duplicateKeys.has(normalizedKey);
                      const isEmpty = entry.destinationPath.trim().length === 0;
                      const alreadyExists = existingTargetPaths.has(normalizedKey);
                      const hasIssue = isDuplicate || isEmpty || alreadyExists;
                      const isEditingThis =
                        editingRepoId === entry.repo.id || !folderPicker.canPickFolder;
                      return (
                        <div
                          key={entry.repo.id}
                          className="flex w-full min-w-0 shrink-0 flex-col gap-1.5 rounded-md border border-border/70 bg-background/80 p-2.5"
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="w-0 min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
                              {entry.repo.pathWithNamespace}
                            </span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {alreadyExists ? (
                                <Badge size="sm" variant="error">
                                  <T>Already exists</T>
                                </Badge>
                              ) : null}
                              {entry.isCustomPath ? (
                                <Badge size="sm" variant="outline">
                                  <T>Custom</T>
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          {isEditingThis ? (
                            <div className="flex w-full min-w-0 items-center gap-1.5">
                              <div className="w-0 min-w-0 flex-1">
                                <Input
                                  size="sm"
                                  font="mono"
                                  disabled={submitting}
                                  aria-invalid={hasIssue}
                                  value={entry.destinationPath}
                                  onChange={(event) =>
                                    setCustomPaths((prev) => ({
                                      ...prev,
                                      [entry.repo.id]: resolvePastedPath(
                                        prev[entry.repo.id] ?? entry.destinationPath,
                                        event.target.value,
                                      ),
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") setEditingRepoId(null);
                                  }}
                                  spellCheck={false}
                                />
                              </div>
                              {folderPicker.canPickFolder ? (
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  disabled={submitting}
                                  aria-label={gt("Finish editing path")}
                                  onClick={() => setEditingRepoId(null)}
                                >
                                  <CheckIcon className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex w-full min-w-0 items-center gap-1.5">
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  handlePickRepoFolder(entry.repo, entry.destinationPath)
                                }
                                className={cn(
                                  "flex min-h-8 w-0 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
                                  hasIssue
                                    ? "border-destructive bg-destructive/5"
                                    : "border-input/80 bg-muted/20",
                                )}
                              >
                                <span className="w-0 min-w-0 flex-1 font-mono text-xs leading-snug break-all text-foreground">
                                  {entry.destinationPath}
                                </span>
                              </button>

                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  disabled={submitting}
                                  onClick={() =>
                                    handlePickRepoFolder(entry.repo, entry.destinationPath)
                                  }
                                >
                                  <FolderOpenIcon className="size-3.5" />
                                  <T>Change</T>
                                </Button>

                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        disabled={submitting}
                                        aria-label={gt("Edit path for {name}", {
                                          name: entry.repo.name,
                                        })}
                                        onClick={() => setEditingRepoId(entry.repo.id)}
                                      >
                                        <PencilIcon className="size-3.5" />
                                      </Button>
                                    }
                                  />
                                  <TooltipPopup side="top">
                                    <T>Edit path manually</T>
                                  </TooltipPopup>
                                </Tooltip>

                                {entry.isCustomPath ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button
                                          type="button"
                                          size="icon-xs"
                                          variant="ghost"
                                          disabled={submitting}
                                          aria-label={gt("Reset path for {name}", {
                                            name: entry.repo.name,
                                          })}
                                          onClick={() =>
                                            setCustomPaths((prev) => {
                                              const next = { ...prev };
                                              delete next[entry.repo.id];
                                              return next;
                                            })
                                          }
                                        >
                                          <RotateCcwIcon className="size-3.5" />
                                        </Button>
                                      }
                                    />
                                    <TooltipPopup side="top">
                                      <T>Reset to default path</T>
                                    </TooltipPopup>
                                  </Tooltip>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {hasConflicts ? (
                  <Alert variant="error">
                    <AlertCircleIcon className="size-4" />
                    <AlertDescription>
                      {hasEmptyPath
                        ? gt("Every selected repository needs a non-empty destination path.")
                        : duplicateKeys.size > 0
                          ? gt(
                              "Two or more selected repositories share the same destination path. Switch to group layout or adjust their paths.",
                            )
                          : gt(
                              "One or more destination folders already exist on disk. Choose a different folder or open the existing local repository directly.",
                            )}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              <T>Cancel</T>
            </Button>
            <Button
              type="button"
              disabled={submitting || hasConflicts || repositories.length === 0}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <>
                  <Spinner className="size-3.5" />
                  {repositories.length === 1 ? (
                    <T>Starting clone…</T>
                  ) : (
                    <T>
                      Starting clones (<Var>{startingCount}</Var>/<Var>{repositories.length}</Var>)…
                    </T>
                  )}
                </>
              ) : repositories.length === 1 ? (
                <T>Start clone</T>
              ) : (
                <T>
                  Start cloning (<Var>{repositories.length}</Var>)
                </T>
              )}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {folderPicker.dialogProps ? <FolderPickerDialog {...folderPicker.dialogProps} /> : null}
    </>
  );
}
