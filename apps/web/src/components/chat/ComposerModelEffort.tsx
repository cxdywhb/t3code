import {
  buildTraitsTriggerDisplay,
  speedTierLabel,
  getDescriptorStringValue,
  isReasoningControl,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import { msg, T, useGT, useMessages } from "gt-react";
import { CheckIcon, ChevronRightIcon, WorkflowIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { m, type MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import {
  COMPOSER_SEGMENT_CLASS,
  ComposerSegmentIndicator,
  type ComposerControlSize,
} from "./ComposerControl";
import { ComposerEffortSlider } from "./ComposerEffortSlider";
import { ComposerPermissionsSection, type RuntimeModeOption } from "./ComposerFooterControls";
import { composerFloatingLayerProps } from "./composerEventScope";
import { EffortGlyph, FastBolt, resolveEffortGlyph } from "./EffortGlyph";
import {
  getTraitsSectionVisibility,
  type TraitsSelectionInput,
  ULTRATHINK_IN_BODY_NOTE,
  useTraitsSelection,
} from "./TraitsPicker";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

/** Service tiers, Claude's Fast mode, and Ultracode sit in the footer, not the column. */
function splitSpeed(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const speedSelect = selects.find((descriptor) => descriptor.id === "serviceTier") ?? null;
  const fastToggle = toggles.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const ultracodeToggle = toggles.find((descriptor) => descriptor.id === "ultracode") ?? null;
  return {
    speedSelect,
    fastToggle,
    ultracodeToggle,
    columnSelects: selects.filter((descriptor) => descriptor !== speedSelect),
    columnToggles: toggles.filter(
      (descriptor) => descriptor !== fastToggle && descriptor !== ultracodeToggle,
    ),
  };
}

type ColumnControl =
  | { kind: "select"; descriptor: SelectDescriptor }
  | { kind: "boolean"; descriptor: BooleanDescriptor };

/**
 * The column lists the model's reasoning levels under the header that names it. Other options,
 * such as an agent's session mode, sit below as one row each.
 */
function columnControls(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const { columnSelects, columnToggles, speedSelect, fastToggle } = splitSpeed(selects, toggles);
  const controls: ReadonlyArray<ColumnControl> = [
    ...columnSelects.map((descriptor) => ({ kind: "select" as const, descriptor })),
    ...columnToggles.map((descriptor) => ({ kind: "boolean" as const, descriptor })),
  ];
  const effort = controls.find((control) => isReasoningControl(control.descriptor)) ?? null;
  return {
    effort,
    others: controls.filter((control) => control !== effort),
    speedSelect,
    fastToggle,
  };
}

/**
 * What the model trigger shows after the model name: the effort word (or bars, per the
 * Appearance setting), a bolt for Fast, a workflow icon for Ultracode, and other traits such as a
 * context window.
 */
export function describeComposerEffort(
  traits: TraitsSelectionInput | null,
  effortDisplay: EffortDisplay,
  size: ComposerControlSize,
  resolve: MessageResolver = m,
): { suffix: ReactNode; detail: string | null } {
  if (!traits) return { suffix: null, detail: null };
  const visibility = getTraitsSectionVisibility({ ...traits, resolve });
  if (!visibility.hasAnyControls) return { suffix: null, detail: null };
  const modelSelection =
    traits.instanceId && traits.model
      ? { instanceId: traits.instanceId, model: traits.model, options: visibility.selections ?? [] }
      : null;
  const primary = visibility.primarySelectDescriptor;
  const display = buildTraitsTriggerDisplay(
    {
      descriptors: visibility.descriptors,
      primarySelectDescriptorId: primary?.id ?? null,
      ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
      modelSelection,
      reportedModelSelection: traits.reportedModelSelection,
    },
    resolve,
  );
  // The same reasoning control the column lists, wherever the agent put it among its options.
  const reasoning =
    columnControls(visibility.selectDescriptors, visibility.booleanDescriptors).effort
      ?.descriptor ?? null;
  const ultrathink = visibility.ultrathinkPromptControlled && reasoning === primary;
  const glyph =
    reasoning?.type === "select"
      ? resolveEffortGlyph(
          reasoning,
          ultrathink
            ? "ultrathink"
            : getDescriptorStringValue(reasoning, modelSelection, traits.reportedModelSelection),
        )
      : null;
  // Workflow levels such as Ultracode always show their name; the setting names every level.
  const word = glyph
    ? (glyph.special ?? (effortDisplay === "label" ? glyph.label : null))
    : !reasoning
      ? null
      : reasoning.type === "boolean"
        ? reasoning.currentValue === true
          ? resolve(msg("{option} On", { option: reasoning.label }))
          : resolve(msg("{option} Off", { option: reasoning.label }))
        : ultrathink
          ? "Ultrathink"
          : (getProviderOptionCurrentLabel(
              reasoning,
              modelSelection,
              traits.reportedModelSelection,
            ) ?? (reasoning.id === "thinking" ? reasoning.label : null));
  const fast = display.speedLabel === "Fast" || display.speedLabel === "Ultrafast";
  // Agent options such as modes live in the picker; the trigger adds only the context window.
  const contextWindow =
    visibility.contextWindowDescriptor &&
    getProviderOptionCurrentLabel(
      visibility.contextWindowDescriptor,
      modelSelection,
      traits.reportedModelSelection,
    );
  if (!word && !glyph && !fast && !display.ultracode && !contextWindow)
    return { suffix: null, detail: display.label };
  return {
    detail: display.label,
    suffix: (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-muted-foreground group-hover/model-trigger:text-foreground group-data-pressed/model-trigger:text-foreground group-data-popup-open/model-trigger:text-foreground",
          // A word space after the model name: the regular trigger's gap is wider than one.
          size === "sm" && "-ms-0.5",
        )}
      >
        {word ? (
          <span data-composer-control-label className="max-w-24 truncate">
            {word}
          </span>
        ) : glyph ? (
          <EffortGlyph count={glyph.count} filled={glyph.filled} size={size} />
        ) : null}
        {fast ? <FastBolt ultra={display.speedLabel === "Ultrafast"} /> : null}
        {display.ultracode ? (
          <WorkflowIcon aria-hidden="true" data-composer-control-icon className="size-3" />
        ) : null}
        {contextWindow ? (
          <span
            // A label, so icon-only footers drop it; compacted rows drop it before the model.
            data-composer-control-label
            data-composer-secondary-trait
            className="max-w-24 truncate text-xs"
          >
            {contextWindow}
          </span>
        ) : null}
      </span>
    ),
  };
}

const COLUMN_ROW =
  "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-64";
const COLUMN_LABEL = "px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs";

function ColumnRow(props: {
  label: string;
  /** Shown on hover; the column is too narrow to print it under the label. */
  description?: string | undefined;
  selected: boolean;
  /** The column's one tab stop: the selected level, else the first when none shows as selected. */
  tabStop: boolean;
  isDefault?: boolean | undefined;
  disabled?: boolean;
  onPick: () => void;
}) {
  const gt = useGT();
  const rowProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.selected,
    disabled: props.disabled,
    "data-effort-row": true,
    // Focus lands on a level after a model pick, and a typed letter finds one by its label.
    "data-effort-level": props.label,
    // Up and Down move between rows.
    tabIndex: props.tabStop ? 0 : -1,
    className: COLUMN_ROW,
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.selected ? (
        <>
          {props.isDefault ? (
            <span className="sr-only">
              {gt("Default", { $context: "marks the default option" })}
            </span>
          ) : null}
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </>
      ) : props.isDefault ? (
        <span className="text-muted-foreground/70 text-xs">
          {gt("Default", { $context: "marks the default option" })}
        </span>
      ) : null}
    </>
  );
  if (!props.description) return <button {...rowProps}>{content}</button>;
  return (
    <SharedTooltipTrigger
      render={<button {...rowProps} />}
      label={props.description}
      side="right"
      className="max-w-56"
    >
      {content}
    </SharedTooltipTrigger>
  );
}

function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  if (event.target instanceof Element && event.target.closest("[data-effort-slider]")) return;
  const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (
    !arrow &&
    (event.key.length !== 1 ||
      event.key.trim() === "" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing)
  )
    return;
  // An option's side menu is a React child here, but it moves through its own items.
  if (!event.currentTarget.contains(event.target as Node)) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-effort-row]:not(:disabled), [data-effort-slider] input:enabled",
    ),
  );
  const index = rows.findIndex((row) => row === document.activeElement);
  const next = arrow
    ? rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]
    : [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((row) =>
        row.dataset.effortLevel?.toLowerCase().startsWith(event.key.toLowerCase()),
      );
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function EffortLevels(props: { traits: TraitsSelectionInput; moveCyberAccess?: boolean }) {
  const gt = useGT();
  const traits = useTraitsSelection(props.traits);
  const {
    effort,
    others: allOthers,
    speedSelect,
    fastToggle,
  } = columnControls(traits.selectDescriptors, traits.booleanDescriptors);
  const others = props.moveCyberAccess
    ? allOthers.filter((control) => control.descriptor.id !== "cyberAccessProgram")
    : allOthers;
  const speed = speedSelect
    ? traits.currentLabel(speedSelect)
    : fastToggle && (fastToggle.currentValue === true ? "Fast" : "Standard");
  const label =
    effort?.descriptor.label ??
    (others.length
      ? gt("Options", { $context: "heading for model options" })
      : gt("Effort", { $context: "heading for reasoning effort levels" }));
  if (traits.modelIsUnavailable) {
    return (
      <EffortColumnLayout label={label}>
        {traits.descriptors.map((descriptor) => {
          const value = traits.currentLabel(descriptor);
          return value ? (
            <div key={descriptor.id}>
              <div className={COLUMN_LABEL}>{descriptor.label}</div>
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{value}</div>
            </div>
          ) : null;
        })}
      </EffortColumnLayout>
    );
  }
  // Ultrathink in the prompt locks the levels; the first option then holds the tab stop.
  const locked =
    effort?.descriptor.id === traits.primarySelectDescriptor?.id && traits.ultrathinkInBodyText;
  const select = effort?.kind === "select" ? effort.descriptor : null;
  const choices = select ? selectableProviderOptionChoices(select) : [];
  const value = select ? traits.selectValue(select) : "";
  const index = choices.findIndex((option) => option.id === value);
  const showSlider = select !== null && choices.length > 1 && index >= 0 && !locked;
  return (
    <EffortColumnLayout label={showSlider ? null : label}>
      {showSlider ? (
        <ComposerEffortSlider
          key={JSON.stringify([props.traits.instanceId, props.traits.model, select.id])}
          label={select.label}
          choices={choices}
          index={index}
          playbackRate={
            speed === "Fast" || speed === "Ultrafast" ? 1.2 : speed === "Standard" ? 0.85 : 1
          }
          onPick={(id) => traits.changeSelect(select, id)}
        />
      ) : effort ? (
        <EffortRows
          control={effort}
          traits={traits}
          locked={locked}
          choices={choices}
          index={index}
        />
      ) : null}
      {!effort && others.length === 0 ? <NoEffortRow /> : null}
      {others.length > 0 ? (
        <div
          className={cn("flex flex-col gap-0.5", effort && "mt-1 border-t border-border/70 pt-1")}
        >
          {others.map((control, index) =>
            control.kind === "boolean" ? (
              <OptionSwitchRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked || showSlider) && index === 0}
              />
            ) : (
              <OptionMenuRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked || showSlider) && index === 0}
              />
            ),
          )}
        </div>
      ) : null}
    </EffortColumnLayout>
  );
}

type TraitsSelection = ReturnType<typeof useTraitsSelection>;

function EffortRows(props: {
  control: ColumnControl;
  traits: TraitsSelection;
  locked: boolean;
  choices: SelectDescriptor["options"];
  index: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { control, traits } = props;
  const { descriptor } = control;
  if (control.kind === "boolean") {
    return (
      <div role="radiogroup" aria-label={descriptor.label} className="flex flex-col gap-0.5">
        {([true, false] as const).map((value) => (
          <ColumnRow
            key={String(value)}
            label={
              value
                ? gt("On", { $context: "option state" })
                : gt("Off", { $context: "option state" })
            }
            selected={(control.descriptor.currentValue === true) === value}
            tabStop={(control.descriptor.currentValue === true) === value}
            onPick={() => traits.changeBoolean(descriptor.id, value)}
          />
        ))}
      </div>
    );
  }
  const { choices, index, locked } = props;
  return (
    <div role="radiogroup" aria-label={descriptor.label} className="flex flex-col gap-0.5">
      {locked ? (
        <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
          {messages(ULTRATHINK_IN_BODY_NOTE)}
        </div>
      ) : null}
      {choices.map((option, optionIndex) => (
        <ColumnRow
          key={option.id}
          label={option.label}
          selected={optionIndex === index}
          tabStop={optionIndex === Math.max(0, index)}
          description={option.description}
          isDefault={option.isDefault}
          disabled={locked}
          onPick={() => {
            const group = document.activeElement?.closest("[data-model-picker-effort]");
            traits.changeSelect(control.descriptor, option.id);
            if (group && index < 0 && choices.length > 1) {
              requestAnimationFrame(() => {
                group.querySelector<HTMLElement>("[data-effort-slider] input:enabled")?.focus();
              });
            }
          }}
        />
      ))}
    </div>
  );
}

const OPTION_ROW = cn(COLUMN_ROW, "h-auto py-1");

/** An option's name over its current value. */
function OptionRowText(props: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-muted-foreground text-xs">{props.label}</span>
      <span className="truncate">{props.value}</span>
    </span>
  );
}

/**
 * One select besides reasoning, such as an agent's session mode. It names the current choice and
 * opens the rest beside the column, so any number of options leaves the levels in place.
 */
function OptionMenuRow(props: {
  descriptor: SelectDescriptor;
  traits: TraitsSelection;
  /** Holds the column's tab stop when the model has no levels. */
  tabStop: boolean;
  advanced?: boolean;
}) {
  const gt = useGT();
  const { descriptor, traits } = props;
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const choices = selectableProviderOptionChoices(descriptor);
  const value = traits.selectValue(descriptor);
  const current = choices.find((choice) => choice.id === value)?.label ?? "";
  return (
    <Menu
      open={open}
      // A modal menu would cover the picker, so the next click there would only close it.
      modal={false}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) return;
        const checked = popupRef.current?.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"]',
        );
        checked?.focus({ preventScroll: true });
        checked?.scrollIntoView({ block: "nearest" });
      }}
    >
      {/* No hover opening: an opened menu takes focus, which would steal typing from search. */}
      <MenuTrigger
        render={
          <button
            type="button"
            data-effort-row
            tabIndex={props.tabStop ? 0 : -1}
            aria-label={props.advanced ? undefined : `${descriptor.label}: ${current}`}
            aria-description={props.advanced ? `${descriptor.label}: ${current}` : undefined}
            className={cn(
              props.advanced ? [COMPOSER_SEGMENT_CLASS, "ms-auto"] : OPTION_ROW,
              "data-popup-open:bg-foreground/[0.09]",
            )}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          />
        }
      >
        {props.advanced ? (
          gt("Advanced")
        ) : (
          <OptionRowText label={descriptor.label} value={current} />
        )}
        <ChevronRightIcon
          aria-hidden="true"
          className="-me-1 size-3.5 shrink-0 text-muted-foreground"
        />
      </MenuTrigger>
      <MenuPopup
        ref={popupRef}
        side="right"
        align="start"
        sideOffset={6}
        // A full-width column on phones leaves no room beside it, so fall below or above.
        collisionAvoidance={{ fallbackAxisSide: "end" }}
        className="max-w-72"
        data-model-picker-option-menu
        {...composerFloatingLayerProps}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <MenuRadioGroup
          aria-label={descriptor.label}
          value={value}
          onValueChange={(next: string) => {
            if (next !== value) traits.changeSelect(descriptor, next);
          }}
        >
          {choices.map((choice) => (
            <MenuRadioItem key={choice.id} value={choice.id} closeOnClick>
              <span className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{choice.label}</span>
                  {choice.description ? (
                    <span className="line-clamp-2 text-muted-foreground text-xs">
                      {choice.description}
                    </span>
                  ) : null}
                </span>
                {choice.isDefault ? (
                  <span className="text-muted-foreground/70 text-xs">
                    {gt("Default", { $context: "marks the default option" })}
                  </span>
                ) : null}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** A two-state option toggles in place; a menu would add a click for nothing. */
function OptionSwitchRow(props: {
  descriptor: BooleanDescriptor;
  traits: TraitsSelection;
  tabStop: boolean;
}) {
  const gt = useGT();
  const { descriptor, traits } = props;
  const checked = descriptor.currentValue === true;
  return (
    <label className={cn(OPTION_ROW, "has-focus-visible:bg-foreground/[0.09]")}>
      <OptionRowText
        label={descriptor.label}
        value={
          checked ? gt("On", { $context: "option state" }) : gt("Off", { $context: "option state" })
        }
      />
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={(next) => traits.changeBoolean(descriptor.id, next)}
        aria-label={descriptor.label}
        data-effort-row
        tabIndex={props.tabStop ? 0 : -1}
      />
    </label>
  );
}

function NoEffortRow() {
  return (
    <div className="flex h-8 items-center px-2 text-muted-foreground text-sm">
      <T>No effort levels</T>
    </div>
  );
}

function EffortColumnLayout(props: { label: string | null; children: ReactNode }) {
  return (
    <>
      {props.label ? (
        <div className="px-3 pt-2 text-xs font-medium text-muted-foreground">{props.label}</div>
      ) : null}
      <div
        className="flex flex-col gap-0.5 p-2"
        // Capture, so Up and Down on an option row move rows instead of opening its menu.
        onKeyDownCapture={moveBetweenRows}
      >
        {props.children}
      </div>
    </>
  );
}

/** The model picker's effort column: the selected model's levels and its other options. */
export function ComposerEffortColumn(props: {
  traits: TraitsSelectionInput | null;
  moveCyberAccess?: boolean;
}) {
  const gt = useGT();
  return props.traits ? (
    <EffortLevels traits={props.traits} moveCyberAccess={props.moveCyberAccess === true} />
  ) : (
    <EffortColumnLayout label={gt("Effort", { $context: "heading for reasoning effort levels" })}>
      <NoEffortRow />
    </EffortColumnLayout>
  );
}

function SpeedSegment(props: {
  checked: boolean;
  label: string;
  /** The untranslated speed name that picks the bolt, when `label` is translated. */
  speed?: string;
  description?: string | undefined;
  onPick: () => void;
}) {
  const speed = props.speed ?? props.label;
  const buttonProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.checked,
    "data-checked": props.checked || undefined,
    className: cn(COMPOSER_SEGMENT_CLASS, "relative"),
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      {speed === "Fast" || speed === "Ultrafast" ? (
        <FastBolt ultra={speed === "Ultrafast"} />
      ) : null}
      {props.label}
    </>
  );
  if (!props.description) return <button {...buttonProps}>{content}</button>;
  return (
    <SharedTooltipTrigger render={<button {...buttonProps} />} label={props.description}>
      {content}
    </SharedTooltipTrigger>
  );
}

function SpeedControl(props: { traits: TraitsSelectionInput }) {
  const gt = useGT();
  const resolve = useMessages();
  const traits = useTraitsSelection(props.traits);
  const { speedSelect, fastToggle } = splitSpeed(
    traits.selectDescriptors,
    traits.booleanDescriptors,
  );
  if (traits.modelIsUnavailable || (!speedSelect && !fastToggle)) return null;
  const choices = speedSelect ? selectableProviderOptionChoices(speedSelect) : [];
  const selected = speedSelect ? traits.selectValue(speedSelect) : null;
  const count = speedSelect ? choices.length : 2;
  const index = speedSelect
    ? choices.findIndex((choice) => choice.id === selected)
    : Number(fastToggle?.currentValue === true);
  return (
    <div
      role="radiogroup"
      aria-label={
        speedSelect?.label === "Service Tier"
          ? gt("Speed", { $context: "model option name" })
          : (speedSelect?.label ?? fastToggle?.label)
      }
      className="rounded-lg bg-input/40 p-0.5"
    >
      <div className="relative grid auto-cols-fr grid-flow-col">
        <ComposerSegmentIndicator index={index} count={count} />
        {speedSelect
          ? choices.map((option) => (
              <SpeedSegment
                key={option.id}
                checked={option.id === selected}
                speed={option.label}
                label={speedTierLabel(option.label, resolve)}
                description={
                  option.description === "Even faster, more expensive"
                    ? gt("Even faster, more expensive")
                    : option.description
                }
                onPick={() => traits.changeSelect(speedSelect, option.id)}
              />
            ))
          : fastToggle
            ? ([false, true] as const).map((value) => (
                <SpeedSegment
                  key={String(value)}
                  checked={(fastToggle.currentValue === true) === value}
                  speed={value ? "Fast" : "Standard"}
                  label={
                    value
                      ? gt("Fast", { $context: "response speed" })
                      : gt("Standard", { $context: "response speed" })
                  }
                  onPick={() => traits.changeBoolean(fastToggle.id, value)}
                />
              ))
            : null}
      </div>
    </div>
  );
}

function UltracodeControl(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const { ultracodeToggle } = splitSpeed(traits.selectDescriptors, traits.booleanDescriptors);
  if (traits.modelIsUnavailable || !ultracodeToggle) return null;
  const on = ultracodeToggle.currentValue === true;
  return (
    <div className="flex rounded-lg bg-input/40 p-0.5">
      <button
        type="button"
        aria-pressed={on}
        data-checked={on || undefined}
        className={cn(COMPOSER_SEGMENT_CLASS, "data-checked:bg-input/72")}
        onClick={() => traits.changeBoolean(ultracodeToggle.id, !on)}
      >
        <WorkflowIcon aria-hidden="true" className="size-3" />
        {ultracodeToggle.label}
      </button>
    </div>
  );
}

function CyberAccessControl(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const descriptor = traits.selectDescriptors.find((option) => option.id === "cyberAccessProgram");
  if (
    traits.modelIsUnavailable ||
    !descriptor ||
    selectableProviderOptionChoices(descriptor).length < 2
  ) {
    return null;
  }
  return <OptionMenuRow descriptor={descriptor} traits={traits} tabStop advanced />;
}

export function ComposerPickerFooter(props: {
  traits: TraitsSelectionInput | null;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div className="border-t border-border/70">
      <div className="px-2 pt-1">
        <ComposerPermissionsSection
          inline
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.runtimeModeOptions}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </div>
      {props.traits ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/40 px-3 py-2 empty:hidden">
          <SpeedControl traits={props.traits} />
          <UltracodeControl traits={props.traits} />
          <CyberAccessControl traits={props.traits} />
        </div>
      ) : null}
    </div>
  );
}
