import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react";
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { mergeEnvironmentSettings, useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { Button } from "../ui/button";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import type { ComposerControlSize } from "./ComposerControl";
import { ComposerEffortColumn, describeComposerEffort } from "./ComposerModelEffort";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { TraitsSelectionInput } from "./TraitsPicker";

const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

export interface OfficialModelCatalog {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly pickableEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly firstAvailableSelection: ModelSelection | null;
  readonly isSelectionAvailable: (selection: ModelSelection | null | undefined) => boolean;
}

export function useOfficialModelCatalog(
  environmentId: EnvironmentId | null,
  driverKind?: string,
): OfficialModelCatalog {
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const serverSettings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const settings = useClientSettings((clientSettings) =>
    mergeEnvironmentSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, clientSettings),
  );
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const instanceEntries = driverKind
    ? entries.filter((entry) => entry.driverKind === driverKind)
    : entries;
  const pickableEntries = instanceEntries.filter(
    (entry) => isProviderInstancePickerVisible(entry) && entry.models.length > 0,
  );

  const readyEntry =
    pickableEntries.find((entry) => isProviderInstancePickerReady(entry)) ??
    pickableEntries[0] ??
    null;
  const readyModel = readyEntry?.models.find((m) => m.isDefault) ?? readyEntry?.models[0] ?? null;
  const firstAvailableSelection =
    readyEntry && readyModel ? createModelSelection(readyEntry.instanceId, readyModel.slug) : null;

  const isSelectionAvailable = (selection: ModelSelection | null | undefined): boolean => {
    if (!selection) return false;
    const entry = pickableEntries.find((e) => e.instanceId === selection.instanceId);
    if (!entry) return false;
    return entry.models.some((m) => m.slug === selection.model);
  };

  return {
    instanceEntries,
    pickableEntries,
    providers,
    firstAvailableSelection,
    isSelectionAvailable,
  };
}

export function OfficialModelPicker({
  environmentId,
  value,
  onChange,
  ariaLabel,
  emptyOptionLabel,
  size = "sm",
  popupAlign = "start",
  popupSide = "bottom",
  triggerClassName,
  disabled = false,
  workspaceCwd = null,
  driverKind,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ModelSelection | null;
  readonly onChange: (next: ModelSelection | null) => void;
  readonly ariaLabel: string;
  readonly emptyOptionLabel?: string | undefined;
  readonly size?: ComposerControlSize;
  readonly popupAlign?: "start" | "end";
  readonly popupSide?: "top" | "bottom";
  readonly triggerClassName?: string;
  readonly disabled?: boolean;
  readonly workspaceCwd?: string | null;
  readonly driverKind?: string | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const providersByEnvironment = useEnvironmentProviders();
  const providers = providersByEnvironment.get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const settings = useClientSettings((clientSettings) =>
    mergeEnvironmentSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, clientSettings),
  );
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const instanceEntries = driverKind
    ? entries.filter((entry) => entry.driverKind === driverKind)
    : entries;
  const pickableEntries = instanceEntries.filter(
    (entry) => isProviderInstancePickerVisible(entry) && entry.models.length > 0,
  );
  const fallbackEntry =
    pickableEntries.find((entry) => isProviderInstancePickerReady(entry)) ??
    pickableEntries[0] ??
    null;
  const fallbackModel =
    fallbackEntry?.models.find((m) => m.isDefault) ?? fallbackEntry?.models[0] ?? null;
  const fallbackSelection =
    fallbackEntry && fallbackModel
      ? createModelSelection(fallbackEntry.instanceId, fallbackModel.slug)
      : null;

  const selected =
    driverKind && !pickableEntries.some((entry) => entry.instanceId === value?.instanceId)
      ? null
      : value;
  const effectiveSelection = selected ?? fallbackSelection;
  if (!effectiveSelection) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          SETTINGS_PICKER_TRIGGER_CLASSNAME,
          "inline-flex h-8 w-full items-center justify-between rounded-md border border-border/70 px-2.5 text-sm text-muted-foreground opacity-60",
          triggerClassName,
        )}
      >
        <span className="truncate">{emptyOptionLabel ?? gt("No providers available")}</span>
      </button>
    );
  }

  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    effectiveSelection.instanceId,
    effectiveSelection.model,
  );
  const activeEntry =
    instanceEntries.find((entry) => entry.instanceId === effectiveSelection.instanceId) ?? null;

  const traitsInput: TraitsSelectionInput | null =
    selected !== null && value !== null && activeEntry !== null
      ? {
          provider: activeEntry.driverKind,
          instanceId: value.instanceId,
          models: activeEntry.models,
          model: value.model,
          modelOptions: value.options ?? [],
          allowPromptInjectedEffort: false,
          onModelOptionsChange: (nextOptions) => {
            onChange(createModelSelection(value.instanceId, value.model, nextOptions));
          },
        }
      : null;

  const effort = describeComposerEffort(traitsInput, settings.effortDisplay, size, messages);

  return (
    <ProviderModelPicker
      open={open}
      onOpenChange={setOpen}
      environmentId={environmentId}
      workspaceCwd={workspaceCwd}
      activeInstanceId={effectiveSelection.instanceId}
      model={effectiveSelection.model}
      lockedProvider={null}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      size={size}
      disabled={disabled}
      isComposerOwned={false}
      popupAlign={popupAlign}
      popupSide={popupSide}
      triggerAriaLabel={ariaLabel}
      triggerClassName={cn(
        SETTINGS_PICKER_TRIGGER_CLASSNAME,
        "w-full justify-between",
        triggerClassName,
      )}
      {...(value === null && emptyOptionLabel !== undefined
        ? { triggerLabel: emptyOptionLabel }
        : {})}
      {...(value !== null && effort.suffix ? { triggerSuffix: effort.suffix } : {})}
      triggerDetail={value !== null ? effort.detail : null}
      effortColumn={<ComposerEffortColumn traits={traitsInput} />}
      {...(emptyOptionLabel !== undefined && value !== null
        ? {
            footer: (
              <div className="flex items-center justify-between border-t border-border/70 bg-muted/40 px-2.5 py-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  className="w-full justify-start"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <RotateCcwIcon className="size-3" />
                  <span className="truncate">{emptyOptionLabel}</span>
                </Button>
              </div>
            ),
          }
        : {})}
      onInstanceModelChange={(instanceId, model) => {
        onChange(pickModelSelection(value, instanceId, model));
      }}
      onOpenProviderSetup={(instanceId) => {
        void navigate({
          to: "/settings/providers",
          search: { environmentId, instanceId },
        });
      }}
    />
  );
}
