import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthSourceControlWriteScope } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ModelSelection,
  PrReviewMode,
  PrReviewModelSlot,
  PrReviewPreset,
  PrReviewRole,
  PrReviewSkillDescriptor,
  PrReviewTargetItem,
  PrReviewTask,
  PrReviewWriteBackMode,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  BotIcon,
  CheckIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";

import {
  OfficialModelPicker,
  useOfficialModelCatalog,
} from "~/components/chat/OfficialModelPicker";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "~/providerInstances";
import {
  PR_REVIEW_LAUNCH_PREFS_STORAGE_PREFIX,
  PrReviewLaunchPrefsSchema,
  resolveInitialPrReviewLaunchConfig,
  type PrReviewLaunchPrefs,
} from "./prReviewAnalytics.logic";
import { prReviewEnvironment } from "~/state/prReview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

export function usePrReviewRoleLabel() {
  const gt = useGT();
  return (role: PrReviewRole): string => {
    switch (role) {
      case "comprehensive":
        return gt("Comprehensive review");
      case "correctness":
        return gt("Logic & concurrency");
      case "security":
        return gt("Security & permissions");
      case "performance":
        return gt("Performance & memory");
      case "architecture":
        return gt("Architecture & contracts");
    }
  };
}

export function usePrReviewWriteBackLabel() {
  const gt = useGT();
  return (mode: PrReviewWriteBackMode): string => {
    switch (mode) {
      case "manual":
        return gt("Manual review before write-back");
      case "auto_comment":
        return gt("Auto-post fusion summary comment");
      case "auto_review":
        return gt("Auto-submit formal review & inline notes");
    }
  };
}

const ROLE_OPTIONS: ReadonlyArray<PrReviewRole> = [
  "comprehensive",
  "correctness",
  "security",
  "performance",
  "architecture",
];

const WRITE_BACK_OPTIONS: ReadonlyArray<PrReviewWriteBackMode> = [
  "manual",
  "auto_comment",
  "auto_review",
];

function pickNextReviewerSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  existingSlots: ReadonlyArray<PrReviewModelSlot>,
): ModelSelection | null {
  const candidates: ModelSelection[] = [];
  for (const entry of entries) {
    for (const model of entry.models) {
      candidates.push({ instanceId: entry.instanceId, model: model.slug });
    }
  }
  if (candidates.length === 0) return null;
  const usedInstances = new Set(existingSlots.map((slot) => slot.modelSelection.instanceId));
  const diffInstanceCandidate = candidates.find((c) => !usedInstances.has(c.instanceId));
  if (diffInstanceCandidate) return diffInstanceCandidate;
  const usedKeys = new Set(
    existingSlots.map((slot) => `${slot.modelSelection.instanceId}::${slot.modelSelection.model}`),
  );
  const unusedCandidate = candidates.find((c) => !usedKeys.has(`${c.instanceId}::${c.model}`));
  if (unusedCandidate) return unusedCandidate;
  return candidates[existingSlots.length % candidates.length] ?? null;
}

function makeInitialSlotsFromEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): PrReviewModelSlot[] {
  const first = pickNextReviewerSelection(entries, []);
  if (!first) return [];
  const slot1: PrReviewModelSlot = {
    id: "slot-1",
    modelSelection: first,
    role: "correctness",
    enabled: true,
  };
  const second = pickNextReviewerSelection(entries, [slot1]);
  if (!second || (second.instanceId === first.instanceId && second.model === first.model)) {
    return [
      {
        ...slot1,
        role: "comprehensive",
      },
    ];
  }
  return [
    slot1,
    {
      id: "slot-2",
      modelSelection: second,
      role: "security",
      enabled: true,
    },
  ];
}

export function SkillMultiPicker({
  availableSkills,
  selectedNames,
  onChange,
  catalog = false,
}: {
  readonly catalog?: boolean;
  readonly availableSkills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly selectedNames: ReadonlyArray<string>;
  readonly onChange: (next: ReadonlyArray<string>) => void;
}) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(30);
  const selectedSet = new Set(selectedNames);
  const needle = search.trim().toLowerCase();
  const filtered = availableSkills.filter(
    (s) =>
      needle.length === 0 ||
      s.name.toLowerCase().includes(needle) ||
      s.displayName.toLowerCase().includes(needle) ||
      s.description.toLowerCase().includes(needle),
  );

  const toggle = (name: string) => {
    if (selectedSet.has(name)) {
      onChange(selectedNames.filter((item) => item !== name));
    } else {
      onChange([...selectedNames, name]);
    }
  };

  if (!catalog && availableSkills.length === 0 && selectedNames.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <T>Add favorite skills on the Presets tab.</T>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {catalog || availableSkills.length > 5 ? (
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setLimit(30);
          }}
          placeholder={gt("Filter skills by name or description…")}
        />
      ) : null}
      <div
        className={cn(
          "grid grid-cols-1 content-start gap-1.5 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2",
          availableSkills.length > 5 ? "h-44" : "max-h-44",
        )}
      >
        {filtered.length === 0 ? (
          <p className="col-span-full py-4 text-center text-xs text-muted-foreground">
            <T>No matching skills</T>
          </p>
        ) : null}
        {selectedNames
          .filter((name) => !availableSkills.some((skill) => skill.name === name))
          .map((name) => (
            <label key={name} className="flex items-center gap-2 text-xs">
              <Checkbox checked onCheckedChange={() => toggle(name)} />
              {name}
            </label>
          ))}
        {filtered.slice(0, limit).map((skill) => {
          const checked = selectedSet.has(skill.name);
          return (
            <label
              key={skill.name}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                checked
                  ? "border-primary/50 bg-accent/60"
                  : "border-transparent hover:bg-accent/40",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(skill.name)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{skill.displayName || skill.name}</span>
                  <Badge variant="outline" size="sm" className="shrink-0">
                    {skill.source}
                  </Badge>
                </span>
                {skill.description ? (
                  <span className="line-clamp-1 text-2xs text-muted-foreground">
                    {skill.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
        {filtered.length > limit ? (
          <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 30)}>
            <T>Show more</T>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ModelSlotsEditor({
  environmentId,
  pickableEntries,
  slots,
  onChange,
  singleSlotOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly pickableEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly slots: ReadonlyArray<PrReviewModelSlot>;
  readonly onChange: (next: ReadonlyArray<PrReviewModelSlot>) => void;
  readonly singleSlotOnly?: boolean;
}) {
  const gt = useGT();
  const roleLabel = usePrReviewRoleLabel();

  const addSlot = () => {
    const fallback = pickNextReviewerSelection(pickableEntries, slots);
    if (!fallback) return;
    const role = ROLE_OPTIONS[(slots.length + 1) % ROLE_OPTIONS.length] ?? "comprehensive";
    onChange([
      ...slots,
      {
        id: `slot-${slots.length + 1}-${fallback.model}`,
        modelSelection: fallback,
        role,
        enabled: true,
      },
    ]);
  };

  const updateSlot = (index: number, patch: Partial<PrReviewModelSlot>) => {
    onChange(slots.map((s, idx) => (idx === index ? { ...s, ...patch } : s)));
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    onChange(slots.filter((_, idx) => idx !== index));
  };

  const visibleSlots = singleSlotOnly ? slots.slice(0, 1) : slots;

  return (
    <div className="flex flex-col gap-2">
      {visibleSlots.map((slot, index) => (
        <div
          key={slot.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/40 p-2"
        >
          <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">
            #{index + 1}
          </span>
          <div className="min-w-48 flex-1">
            <OfficialModelPicker
              environmentId={environmentId}
              value={slot.modelSelection}
              onChange={(next) => {
                if (next) updateSlot(index, { modelSelection: next });
              }}
              ariaLabel={gt("Select reviewer model")}
              popupSide="bottom"
            />
          </div>
          <div className="w-44 shrink-0">
            <Select
              value={slot.role}
              onValueChange={(val) => {
                if (val) updateSlot(index, { role: val as PrReviewRole });
              }}
            >
              <SelectTrigger>
                <SelectValue>{roleLabel(slot.role)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {!singleSlotOnly && slots.length > 1 ? (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={gt("Remove reviewer model")}
              onClick={() => removeSlot(index)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
      {!singleSlotOnly && slots.length < 6 ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={addSlot}
            disabled={pickableEntries.length === 0}
          >
            <PlusIcon className="size-3.5" />
            <T>Add parallel reviewer model</T>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LaunchPrReviewDialog({
  open,
  onOpenChange,
  environmentId,
  targets,
  presets,
  availableSkills,
  defaultMode,
  onLaunched,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly targets: ReadonlyArray<PrReviewTargetItem>;
  readonly presets: ReadonlyArray<PrReviewPreset>;
  readonly availableSkills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly defaultMode?: PrReviewMode | undefined;
  readonly onLaunched?: (result: {
    readonly tasks: ReadonlyArray<PrReviewTask>;
    readonly jumpThreadId: string | null;
    readonly mode: PrReviewMode;
  }) => void;
}) {
  const gt = useGT();
  const writeBackLabel = usePrReviewWriteBackLabel();
  const startReview = useAtomCommand(prReviewEnvironment.startReview, { reportFailure: false });
  const canWriteBack = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const catalog = useOfficialModelCatalog(environmentId);
  const storageKey = `${PR_REVIEW_LAUNCH_PREFS_STORAGE_PREFIX}${environmentId}`;

  const [initialConfig] = useState(() =>
    resolveInitialPrReviewLaunchConfig({
      savedPrefs: getLocalStorageItem(storageKey, PrReviewLaunchPrefsSchema),
      presets,
      targetCount: targets.length,
      ...(defaultMode !== undefined ? { defaultMode } : {}),
      ...(catalog.pickableEntries.length > 0
        ? { isSelectionAvailable: catalog.isSelectionAvailable }
        : {}),
      fallbackSelection: catalog.firstAvailableSelection,
    }),
  );

  const [mode, setMode] = useState<PrReviewMode>(initialConfig.mode);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialConfig.selectedPresetId);
  const [slots, setSlots] = useState<ReadonlyArray<PrReviewModelSlot>>(initialConfig.slots);
  const [synthesizer, setSynthesizer] = useState<ModelSelection | null>(initialConfig.synthesizer);
  const [boundSkills, setBoundSkills] = useState<ReadonlyArray<string>>(initialConfig.boundSkills);
  const [writeBackMode, setWriteBackMode] = useState<PrReviewWriteBackMode>(
    initialConfig.writeBackMode,
  );
  const [customInstructions, setCustomInstructions] = useState<string>(
    initialConfig.customInstructions,
  );
  const [submitting, setSubmitting] = useState(false);

  if (slots.length === 0 && catalog.pickableEntries.length > 0) {
    setSlots(makeInitialSlotsFromEntries(catalog.pickableEntries));
  }

  const savePrefs = (next: PrReviewLaunchPrefs) => {
    setLocalStorageItem(storageKey, next, PrReviewLaunchPrefsSchema);
  };

  const handleModeChange = (nextMode: PrReviewMode) => {
    setMode(nextMode);
    savePrefs({
      mode: nextMode,
      selectedPresetId,
      slots: [...slots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions,
    });
  };

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setSlots(found.reviewerModels);
      setSynthesizer(found.synthesizerModel);
      setBoundSkills(found.boundSkillNames);
      setWriteBackMode(found.writeBackMode);
      setCustomInstructions(found.customInstructions ?? "");
      savePrefs({
        mode,
        selectedPresetId: presetId,
        slots: [...found.reviewerModels],
        synthesizer: found.synthesizerModel,
        boundSkills: [...found.boundSkillNames],
        writeBackMode: found.writeBackMode,
        customInstructions: found.customInstructions ?? "",
      });
      return;
    }
    savePrefs({
      mode,
      selectedPresetId: presetId,
      slots: [...slots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions,
    });
  };

  const handleSlotsChange = (nextSlots: ReadonlyArray<PrReviewModelSlot>) => {
    setSelectedPresetId("__custom__");
    setSlots(nextSlots);
    savePrefs({
      mode,
      selectedPresetId: "__custom__",
      slots: [...nextSlots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions,
    });
  };

  const handleSynthesizerChange = (nextSynthesizer: ModelSelection | null) => {
    setSelectedPresetId("__custom__");
    setSynthesizer(nextSynthesizer);
    savePrefs({
      mode,
      selectedPresetId: "__custom__",
      slots: [...slots],
      synthesizer: nextSynthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions,
    });
  };

  const handleSkillsChange = (nextSkills: ReadonlyArray<string>) => {
    setSelectedPresetId("__custom__");
    setBoundSkills(nextSkills);
    savePrefs({
      mode,
      selectedPresetId: "__custom__",
      slots: [...slots],
      synthesizer,
      boundSkills: [...nextSkills],
      writeBackMode,
      customInstructions,
    });
  };

  const handleWriteBackChange = (nextWriteBack: PrReviewWriteBackMode) => {
    setSelectedPresetId("__custom__");
    setWriteBackMode(nextWriteBack);
    savePrefs({
      mode,
      selectedPresetId: "__custom__",
      slots: [...slots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode: nextWriteBack,
      customInstructions,
    });
  };

  const handleCustomInstructionsChange = (nextInstructions: string) => {
    setCustomInstructions(nextInstructions);
    savePrefs({
      mode,
      selectedPresetId,
      slots: [...slots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions: nextInstructions,
    });
  };

  const effectiveMode: PrReviewMode = targets.length > 1 ? "multi_model_fusion" : mode;
  const effectiveWriteBack =
    effectiveMode === "multi_model_fusion" && canWriteBack ? writeBackMode : "manual";

  const submit = async () => {
    if (slots.length === 0 || targets.length === 0 || submitting) return;
    savePrefs({
      mode: effectiveMode,
      selectedPresetId,
      slots: [...slots],
      synthesizer,
      boundSkills: [...boundSkills],
      writeBackMode,
      customInstructions,
    });
    setSubmitting(true);
    const activeSlots = effectiveMode === "direct_agent" ? slots.slice(0, 1) : slots;
    const outcome = await startReview({
      environmentId,
      input: {
        targets: [...targets],
        mode: effectiveMode,
        ...(selectedPresetId !== "__custom__"
          ? { presetId: selectedPresetId as PrReviewPreset["id"] }
          : {}),
        reviewerModels: activeSlots.map((s) => ({ ...s, enabled: true })),
        synthesizerModel: effectiveMode === "multi_model_fusion" ? synthesizer : null,
        boundSkillNames: [...boundSkills],
        customInstructions: customInstructions.trim() || null,
        writeBackMode: effectiveWriteBack,
      },
    });
    setSubmitting(false);
    if (outcome._tag === "Failure") {
      const failure = squashAtomCommandFailure(outcome);
      toastManager.add({
        type: "error",
        title: gt("Could not start PR review"),
        description: failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    onOpenChange(false);
    onLaunched?.({
      tasks: outcome.value.tasks,
      jumpThreadId: outcome.value.jumpThreadId,
      mode: effectiveMode,
    });
  };

  const firstTarget = targets[0];
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-primary" />
              {targets.length > 1 ? (
                <T>
                  Batch Multi-Model PR Fusion Review (<Var>{targets.length}</Var>)
                </T>
              ) : (
                <T>AI Code Review & Multi-Model Fusion</T>
              )}
            </span>
          </DialogTitle>
          <DialogDescription>
            {targets.length === 1 && firstTarget ? (
              <span className="font-mono text-xs">
                {firstTarget.repository}#{firstTarget.number}
                {firstTarget.title ? ` · ${firstTarget.title}` : ""}
              </span>
            ) : (
              <T>
                Dispatch parallel heterogeneous models with bound skills, synthesize consensus
                findings, and write reviews back to GitLab or GitHub.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[70dvh] overflow-y-auto">
          <div className="flex flex-col gap-4">
            {targets.length > 1 ? (
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {targets.map((target) => (
                  <li key={`${target.host}/${target.repository}#${target.number}`}>
                    <span className="font-mono">
                      {target.host}/{target.repository}#{target.number}
                    </span>
                    {target.title ? ` · ${target.title}` : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {targets.length === 1 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleModeChange("multi_model_fusion")}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    effectiveMode === "multi_model_fusion"
                      ? "border-primary bg-accent/60"
                      : "hover:bg-accent/30",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <WorkflowIcon className="size-4 text-primary" />
                    <T>Multi-Model Fusion Review</T>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <T>
                      Run multiple models in parallel, cross-verify via synthesizer judge, and write
                      back consensus report.
                    </T>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeChange("direct_agent")}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    effectiveMode === "direct_agent"
                      ? "border-primary bg-accent/60"
                      : "hover:bg-accent/30",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <ZapIcon className="size-4 text-warning" />
                    <T>Jump Directly to Agent Chat</T>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <T>
                      Create an interactive Agent thread preloaded with full PR diff and bound
                      skills immediately.
                    </T>
                  </span>
                </button>
              </div>
            ) : null}

            {presets.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Review Preset</T>
                </Label>
                <Select
                  value={selectedPresetId}
                  onValueChange={(val) => {
                    if (val) applyPreset(val);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {selectedPreset ? (
                        `${selectedPreset.name} (${selectedPreset.reviewerModels.length})`
                      ) : (
                        <T>Custom ad-hoc configuration</T>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="__custom__">
                      <T>Custom ad-hoc configuration</T>
                    </SelectItem>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name} ({preset.reviewerModels.length})
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>
                {effectiveMode === "direct_agent" ? (
                  <T>Reviewer Agent Model & Perspective</T>
                ) : (
                  <T>Parallel Reviewer Models</T>
                )}
              </Label>
              <ModelSlotsEditor
                environmentId={environmentId}
                pickableEntries={catalog.pickableEntries}
                slots={slots}
                onChange={handleSlotsChange}
                singleSlotOnly={effectiveMode === "direct_agent"}
              />
            </div>

            {effectiveMode === "multi_model_fusion" && slots.length >= 2 ? (
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Consensus Synthesizer / Judge Model</T>
                </Label>
                <OfficialModelPicker
                  environmentId={environmentId}
                  value={synthesizer}
                  emptyOptionLabel={gt("Auto (use Reviewer #1 as synthesizer)")}
                  onChange={handleSynthesizerChange}
                  ariaLabel={gt("Select synthesizer model")}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>
                  <T>Bind Review Skills (SKILL.md)</T>
                </Label>
                {boundSkills.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    <Var>{boundSkills.length}</Var> <T>selected</T>
                  </span>
                ) : null}
              </div>
              <SkillMultiPicker
                availableSkills={availableSkills}
                selectedNames={boundSkills}
                onChange={handleSkillsChange}
              />
            </div>

            {effectiveMode === "multi_model_fusion" ? (
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Write-Back Policy</T>
                </Label>
                <Select
                  value={effectiveWriteBack}
                  disabled={!canWriteBack}
                  onValueChange={(val) => {
                    if (val) {
                      handleWriteBackChange(val as PrReviewWriteBackMode);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{writeBackLabel(effectiveWriteBack)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {WRITE_BACK_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {writeBackLabel(opt)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Additional Review Rules (Optional)</T>
              </Label>
              <Textarea
                rows={2}
                value={customInstructions}
                onChange={(e) => handleCustomInstructionsChange(e.currentTarget.value)}
                placeholder={gt(
                  "e.g. Focus on backward compatibility, SQL performance, and mobile surface parity…",
                )}
              />
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            <T>Cancel</T>
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || slots.length === 0 || catalog.pickableEntries.length === 0}
          >
            {effectiveMode === "direct_agent" ? (
              <>
                <BotIcon className="size-4" />
                {submitting ? <T>Launching Agent…</T> : <T>Launch & Jump to Agent</T>}
              </>
            ) : (
              <>
                <ShieldCheckIcon className="size-4" />
                {submitting ? <T>Starting Fusion Review…</T> : <T>Start Fusion Review</T>}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function PresetEditorDialog({
  open,
  onOpenChange,
  environmentId,
  editingPreset,
  availableSkills,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly editingPreset: PrReviewPreset | null;
  readonly availableSkills: ReadonlyArray<PrReviewSkillDescriptor>;
}) {
  const gt = useGT();
  const writeBackLabel = usePrReviewWriteBackLabel();
  const savePreset = useAtomCommand(prReviewEnvironment.savePreset, { reportFailure: false });
  const catalog = useOfficialModelCatalog(environmentId);

  const [name, setName] = useState(editingPreset?.name ?? "");
  const [description, setDescription] = useState(editingPreset?.description ?? "");
  const [isDefault, setIsDefault] = useState(editingPreset?.isDefault ?? true);
  const [slots, setSlots] = useState<ReadonlyArray<PrReviewModelSlot>>(() =>
    editingPreset
      ? editingPreset.reviewerModels
      : makeInitialSlotsFromEntries(catalog.pickableEntries),
  );
  const [synthesizer, setSynthesizer] = useState<ModelSelection | null>(
    editingPreset?.synthesizerModel ?? null,
  );
  const [boundSkills, setBoundSkills] = useState<ReadonlyArray<string>>(
    editingPreset?.boundSkillNames ?? [],
  );
  const [writeBackMode, setWriteBackMode] = useState<PrReviewWriteBackMode>(
    editingPreset?.writeBackMode ?? "manual",
  );
  const [customInstructions, setCustomInstructions] = useState(
    editingPreset?.customInstructions ?? "",
  );
  const [saving, setSaving] = useState(false);

  if (!editingPreset && slots.length === 0 && catalog.pickableEntries.length > 0) {
    setSlots(makeInitialSlotsFromEntries(catalog.pickableEntries));
  }

  const submit = async () => {
    if (!name.trim() || slots.length === 0 || saving) return;
    setSaving(true);
    const res = await savePreset({
      environmentId,
      input: {
        ...(editingPreset ? { id: editingPreset.id } : {}),
        name: name.trim(),
        description: description.trim(),
        isDefault,
        reviewerModels: slots.map((s) => ({ ...s, enabled: true })),
        synthesizerModel: synthesizer,
        boundSkillNames: [...boundSkills],
        customInstructions: customInstructions.trim() || null,
        writeBackMode,
      },
    });
    setSaving(false);
    if (res._tag === "Failure") {
      const failure = squashAtomCommandFailure(res);
      toastManager.add({
        type: "error",
        title: gt("Failed to save preset"),
        description: failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: gt("Review preset saved"),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingPreset ? <T>Edit Fusion Review Preset</T> : <T>New Fusion Review Preset</T>}
          </DialogTitle>
          <DialogDescription>
            <T>
              Save reusable multi-model combinations, bound skills, and write-back policies for
              one-click PR reviews.
            </T>
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[70dvh] overflow-y-auto">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Preset Name</T>
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder={gt("e.g. Core Backend Dual-Model + Security Skill")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Description</T>
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                  placeholder={gt("Short description of when to use this preset")}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="flex flex-col">
                <span className="text-xs font-medium">
                  <T>Set as default preset</T>
                </span>
                <span className="text-2xs text-muted-foreground">
                  <T>Pre-selected automatically when opening PR fusion review.</T>
                </span>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Parallel Reviewer Models</T>
              </Label>
              <ModelSlotsEditor
                environmentId={environmentId}
                pickableEntries={catalog.pickableEntries}
                slots={slots}
                onChange={setSlots}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Synthesizer / Judge Model</T>
              </Label>
              <OfficialModelPicker
                environmentId={environmentId}
                value={synthesizer}
                emptyOptionLabel={gt("Auto (use Reviewer #1 as synthesizer)")}
                onChange={setSynthesizer}
                ariaLabel={gt("Select synthesizer model")}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Bound Skills</T>
              </Label>
              <SkillMultiPicker
                availableSkills={availableSkills}
                selectedNames={boundSkills}
                onChange={setBoundSkills}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Write-Back Policy</T>
              </Label>
              <Select
                value={writeBackMode}
                onValueChange={(val) => {
                  if (val) setWriteBackMode(val as PrReviewWriteBackMode);
                }}
              >
                <SelectTrigger>
                  <SelectValue>{writeBackLabel(writeBackMode)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {WRITE_BACK_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {writeBackLabel(opt)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                <T>Team Review Instructions</T>
              </Label>
              <Textarea
                rows={3}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.currentTarget.value)}
                placeholder={gt("Custom team guidelines injected into every reviewer prompt…")}
              />
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <T>Cancel</T>
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !name.trim() || slots.length === 0}
          >
            <CheckIcon className="size-4" />
            {saving ? <T>Saving…</T> : <T>Save Preset</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
