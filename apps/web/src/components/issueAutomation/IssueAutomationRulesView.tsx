import type {
  EnvironmentId,
  IssueAutomationConnector,
  IssueAutomationPlatformDescriptor,
  IssueAutomationProfile,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  FolderGit2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import type { SelectableProjectOption } from "./IssueAutomationConfigModals";
import { useActionModeLabel } from "./issueAutomationPresentation";

export function IssueAutomationRulesView({
  environmentId,
  canConfigureConnector,
  platforms,
  connectors,
  profiles,
  projects,
  onAddConnector,
  onEditConnector,
  onRefreshScopes,
  onDeleteConnector,
  onAddProfile,
  onEditProfile,
  onToggleProfile,
  onScanProfile,
  scanningProfileId,
  onDeleteProfile,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly canConfigureConnector: boolean;
  readonly platforms: ReadonlyArray<IssueAutomationPlatformDescriptor>;
  readonly connectors: ReadonlyArray<IssueAutomationConnector>;
  readonly profiles: ReadonlyArray<IssueAutomationProfile>;
  readonly projects: ReadonlyArray<SelectableProjectOption>;
  readonly onAddConnector: () => void;
  readonly onEditConnector: (connector: IssueAutomationConnector) => void;
  readonly onRefreshScopes: (connectorId: IssueAutomationConnector["id"]) => void;
  readonly onDeleteConnector: (connectorId: IssueAutomationConnector["id"]) => void;
  readonly onAddProfile: () => void;
  readonly onEditProfile: (profile: IssueAutomationProfile) => void;
  readonly onToggleProfile: (profileId: IssueAutomationProfile["id"], enabled: boolean) => void;
  readonly onScanProfile: (profile: IssueAutomationProfile) => void;
  readonly scanningProfileId: IssueAutomationProfile["id"] | null;
  readonly onDeleteProfile: (profileId: IssueAutomationProfile["id"]) => void;
}) {
  const gt = useGT();
  const actionModeLabel = useActionModeLabel();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-16">
      <SettingsSection
        title={gt("Platform connections")}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={!canConfigureConnector}
            onClick={onAddConnector}
          >
            <PlusIcon className="size-3.5" />
            <T>Add connection</T>
          </Button>
        }
      >
        {connectors.map((conn) => {
          const healthy = conn.status === "connected";
          return (
            <SettingsRow
              key={conn.id}
              title={
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      healthy ? "bg-primary" : "bg-warning",
                    )}
                  />
                  <span>{conn.name}</span>
                  <Badge variant="outline" size="sm">
                    {conn.platform}
                    {conn.serverVersion ? ` v${conn.serverVersion}` : ""}
                  </Badge>
                </span>
              }
              description={
                <span>
                  <span className="font-mono">{conn.mcpUrl ?? conn.baseUrl}</span> ·{" "}
                  {conn.status === "disconnected" ? (
                    <T>Authorization required</T>
                  ) : (
                    <>
                      {conn.scopes.length} <T>products synced</T>
                    </>
                  )}
                  {conn.statusDetail ? <span className="block">{conn.statusDetail}</span> : null}
                </span>
              }
              control={
                <div className="flex items-center gap-1.5">
                  {environmentId && conn.status !== "disconnected" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canConfigureConnector}
                      onClick={() => onRefreshScopes(conn.id)}
                    >
                      <RefreshIcon size="sm" />
                      <T>Sync products</T>
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!canConfigureConnector}
                    onClick={() => onEditConnector(conn)}
                  >
                    <PencilIcon className="size-3.5" />
                    {conn.status === "disconnected" ? <T>Authorize MCP</T> : <T>Edit</T>}
                  </Button>
                  {environmentId && canConfigureConnector ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={gt("More connector actions")}
                          />
                        }
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => onEditConnector(conn)}>
                          <PencilIcon />
                          <T>Edit connection</T>
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem variant="destructive" onClick={() => onDeleteConnector(conn.id)}>
                          <Trash2Icon />
                          <T>Remove connection</T>
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </div>
              }
            />
          );
        })}

        <SettingsRow
          title={gt("Extensible platform plugin registry")}
          description={gt(
            "Issue auto-analysis runs on a pluggable adapter interface so Jira and future enterprise trackers share the same multi-repo & multi-model engine.",
          )}
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              {platforms.map((item) => (
                <Badge
                  key={item.platform}
                  variant={item.implemented ? "secondary" : "outline"}
                  size="sm"
                >
                  {item.displayName} · {item.implemented ? gt("Ready") : gt("Plugin slot")}
                </Badge>
              ))}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        title={gt("Unattended automation rules")}
        headerAction={
          <Button size="xs" onClick={onAddProfile}>
            <PlusIcon className="size-3.5" />
            <T>New unattended rule</T>
          </Button>
        }
      >
        {profiles.length === 0 ? (
          <Empty size="compact">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2Icon />
              </EmptyMedia>
              <EmptyTitle>
                <T>No unattended rules yet</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>
                  Bind a ZenTao product to one or more local codebases and assign local AI models
                  for background polling, Worktree fixing, and automatic comment write-back.
                </T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={onAddProfile}>
                <PlusIcon className="size-4" />
                <T>Create unattended rule</T>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          profiles.map((prof) => {
            const primaryRepo =
              projects.find((p) => p.id === prof.repositories.primaryProjectId)?.title ??
              prof.repositories.primaryProjectId;
            const siblingCount = Math.max(0, prof.repositories.linkedProjectIds.length - 1);
            return (
              <SettingsRow
                key={prof.id}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{prof.name}</span>
                    <Badge variant="secondary" size="sm">
                      #{prof.scopeId} · {prof.scopeName}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {actionModeLabel(prof.policy.actionMode)}
                    </Badge>
                  </span>
                }
                description={
                  <span className="flex flex-col gap-1">
                    <span>
                      <T>Codebases</T>:{" "}
                      <strong className="font-medium text-foreground">{primaryRepo}</strong>
                      {siblingCount > 0 ? (
                        <span>
                          {" "}
                          (+{siblingCount} <T>linked repos</T>)
                        </span>
                      ) : null}
                      {prof.repositories.moduleMappings.length > 0 ? (
                        <span>
                          {" "}
                          · {prof.repositories.moduleMappings.length} <T>module routing rules</T>
                        </span>
                      ) : null}{" "}
                      · <T>Every</T> {prof.filter.pollIntervalMinutes}m
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Badge variant="outline" size="sm">
                        {prof.models.primaryModel.instanceId}:{prof.models.primaryModel.model}
                      </Badge>
                      {prof.models.highSeverityModel ? (
                        <Badge variant="outline" size="sm">
                          <T>S1/S2</T>: {prof.models.highSeverityModel.model}
                        </Badge>
                      ) : null}
                      {prof.models.reviewModel ? (
                        <Badge variant="outline" size="sm">
                          <T>Review</T>: {prof.models.reviewModel.model}
                        </Badge>
                      ) : null}
                      {prof.lastPollError ? (
                        <span className="text-destructive">{prof.lastPollError}</span>
                      ) : null}
                    </span>
                  </span>
                }
                control={
                  <div className="flex items-center gap-2">
                    {environmentId ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={scanningProfileId !== null}
                        onClick={() => onScanProfile(prof)}
                      >
                        <SearchIcon className="size-3" />
                        {scanningProfileId === prof.id ? <T>Scanning issues…</T> : <T>Scan now</T>}
                      </Button>
                    ) : null}
                    <Button size="xs" variant="ghost" onClick={() => onEditProfile(prof)}>
                      <PencilIcon className="size-3.5" />
                      <T>Edit</T>
                    </Button>
                    {environmentId ? (
                      <Switch
                        size="sm"
                        checked={prof.enabled}
                        aria-label={gt("Toggle unattended polling for {name}", {
                          name: prof.name,
                        })}
                        onCheckedChange={(checked) => onToggleProfile(prof.id, checked)}
                      />
                    ) : null}
                    {environmentId ? (
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost-muted"
                              aria-label={gt("More rule actions")}
                            />
                          }
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </MenuTrigger>
                        <MenuPopup align="end">
                          <MenuItem variant="destructive" onClick={() => onDeleteProfile(prof.id)}>
                            <Trash2Icon />
                            <T>Delete rule</T>
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    ) : null}
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
    </div>
  );
}
