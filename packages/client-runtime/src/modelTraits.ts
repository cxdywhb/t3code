import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  isClaudeUltrathinkPrompt,
  isReasoningSelect,
} from "@t3tools/shared/model";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export { isReasoningControl, isReasoningSelect } from "@t3tools/shared/model";

export function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string | boolean | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId
      ? descriptor
      : descriptor.type === "boolean"
        ? {
            ...descriptor,
            ...(typeof currentValue === "boolean" ? { currentValue } : {}),
          }
        : {
            ...descriptor,
            ...(typeof currentValue === "string" ? { currentValue } : {}),
          },
  );
}

export function getDescriptorStringValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> | null,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | null {
  if (!descriptor) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor, selection, reportedSelection);
  return typeof value === "string" ? value : null;
}

// Prompt-injected levels such as Ultrathink still work when typed, but pickers do not offer them.
export function selectableProviderOptionChoices(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
) {
  return descriptor.options.filter(
    (option) => !descriptor.promptInjectedValues?.includes(option.id),
  );
}

export function getPromptControlledTraits(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  prompt: string,
  allowPromptInjectedEffort = true,
) {
  const primarySelectDescriptor =
    descriptors.find((descriptor) => descriptor.type === "select") ?? null;
  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ""));
  return { primarySelectDescriptor, ultrathinkPromptControlled, ultrathinkInBodyText };
}

export function getTraitSelectChange(
  selected: ReturnType<typeof getPromptControlledTraits> & {
    descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  },
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  prompt: string,
  value: string,
) {
  if (!value || descriptor.promptInjectedValues?.includes(value)) return null;
  const isPrimary = descriptor.id === selected.primarySelectDescriptor?.id;
  if (isPrimary && selected.ultrathinkInBodyText) return null;
  return {
    prompt:
      isPrimary && selected.ultrathinkPromptControlled
        ? prompt.replace(/^Ultrathink:\s*/i, "")
        : prompt,
    modelOptions: buildProviderOptionSelectionsFromDescriptors(
      replaceDescriptorCurrentValue(selected.descriptors, descriptor.id, value),
    ),
  };
}

const speedMessages = new Map([
  ["Standard", msg("Standard", { $context: "model speed tier" })],
  ["Fast", msg("Fast", { $context: "model speed tier" })],
  ["Ultrafast", msg("Ultrafast", { $context: "model speed tier" })],
]);

export function speedTierLabel(label: string, resolve: MFunctionType) {
  const message = speedMessages.get(label);
  return message ? resolve(message) : label;
}

export function buildTraitsTriggerDisplay(
  input: {
    descriptors: ReadonlyArray<ProviderOptionDescriptor>;
    primarySelectDescriptorId: string | null;
    ultrathinkPromptControlled: boolean;
    modelSelection?: ModelSelection | null;
    reportedModelSelection?: ModelSelection | null | undefined;
  },
  resolve: MFunctionType = mFallback,
): {
  label: string;
  /** "Fast" or "Ultrafast" when a speed option is on. */
  speedLabel: string | null;
  ultracode: boolean;
} {
  let fastModeFallbackLabel: string | null = null;
  let speedLabel: string | null = null;
  let reasoningLabelIndex = -1;
  let ultracodeLabelIndex = -1;
  const labels: Array<string> = [];
  for (const descriptor of input.descriptors) {
    if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
      speedLabel = descriptor.currentValue === true ? "Fast" : null;
      fastModeFallbackLabel =
        speedLabel ?? resolve(msg("Normal", { $context: "model speed tier" }));
      continue;
    }
    if (descriptor.id === "ultracode" && descriptor.type === "boolean") {
      if (descriptor.currentValue === true) {
        ultracodeLabelIndex = labels.length;
        labels.push(descriptor.label);
      }
      continue;
    }
    if (descriptor.id === "serviceTier" && descriptor.type === "select") {
      const currentValue = getProviderOptionCurrentValue(descriptor);
      const fastTier = descriptor.options.find(({ label }) => label === "Fast");
      const ultrafastTier = descriptor.options.find(({ label }) => label === "Ultrafast");
      if (
        ((fastTier || ultrafastTier) && currentValue === "default") ||
        (fastTier && currentValue === fastTier.id) ||
        (ultrafastTier && currentValue === ultrafastTier.id)
      ) {
        speedLabel =
          ultrafastTier && currentValue === ultrafastTier.id
            ? "Ultrafast"
            : fastTier && currentValue === fastTier.id
              ? "Fast"
              : null;
        fastModeFallbackLabel =
          descriptor.options.find(({ id }) => id === currentValue)?.label ??
          resolve(msg("Normal", { $context: "model speed tier" }));
        continue;
      }
    }
    const label =
      input.ultrathinkPromptControlled && descriptor.id === input.primarySelectDescriptorId
        ? "Ultrathink"
        : descriptor.type === "boolean"
          ? descriptor.currentValue === true
            ? resolve(msg("{label} On", { label: descriptor.label }))
            : resolve(msg("{label} Off", { label: descriptor.label }))
          : (getProviderOptionCurrentLabel(
              descriptor,
              input.modelSelection,
              input.reportedModelSelection,
            ) ?? (descriptor.id === "thinking" ? descriptor.label : null));
    if (typeof label === "string" && label.length > 0) {
      if (reasoningLabelIndex === -1 && isReasoningSelect(descriptor)) {
        reasoningLabelIndex = labels.length;
      }
      labels.push(label);
    }
  }

  const ultracode = ultracodeLabelIndex >= 0;
  if (labels.length === 0 && fastModeFallbackLabel !== null) {
    return { label: speedTierLabel(fastModeFallbackLabel, resolve), speedLabel, ultracode };
  }
  if (speedLabel) {
    const label = speedTierLabel(speedLabel, resolve);
    if (reasoningLabelIndex >= 0) {
      labels[reasoningLabelIndex] = `${labels[reasoningLabelIndex]} ${label}`;
    } else {
      labels.push(label);
    }
  }
  return { label: labels.join(" · "), speedLabel, ultracode };
}
