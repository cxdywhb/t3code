import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo, type Dispatch, type SetStateAction, useState } from "react";
import { msg, T, useMessages } from "gt-react";
import { StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { MessageResolver } from "../../i18n/messages";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function describeUnavailableInstance(
  entry: ProviderInstanceEntry,
  resolve: MessageResolver,
): string {
  const label = entry.displayName;
  // An unavailable instance (a driver this build lacks or the policy leaves out) says why instead.
  if ((!entry.enabled && entry.isAvailable) || entry.status === "disabled") {
    return resolve(msg("{label}: Disabled in settings.", { label }));
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const message = entry.snapshot.message?.trim();
  if (message) {
    return resolve(
      entry.status === "error"
        ? msg("{label}: Unavailable. {message}", { label, message })
        : entry.status === "warning"
          ? msg("{label}: Limited. {message}", { label, message })
          : msg("{label}: Not ready. {message}", { label, message }),
    );
  }
  return resolve(
    entry.status === "error"
      ? msg("{label}: Unavailable.", { label })
      : entry.status === "warning"
        ? msg("{label}: Limited.", { label })
        : msg("{label}: Not ready.", { label }),
  );
}

const PICKER_TOOLTIP_SIDE = "bottom" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 8;
const PROVIDER_BUTTON_CLASS =
  "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:ring-1 aria-pressed:ring-primary/35 aria-pressed:ring-inset";

const ModelPickerProviderBarItem = memo(function ModelPickerProviderBarItem(props: {
  entry: ProviderInstanceEntry;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  selected: boolean;
  hovered: boolean;
  disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  getDisabledInstanceTooltip: ((entry: ProviderInstanceEntry) => string) | undefined;
  messageResolver: MessageResolver;
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  setHoveredInstanceId: Dispatch<SetStateAction<ProviderInstanceId | null>>;
}) {
  const isUnavailable = !isProviderInstancePickerReady(props.entry);
  const isContextDisabled = props.disabledInstanceIds?.has(props.entry.instanceId) ?? false;
  const unavailableSelectionIsReachable =
    props.selectableUnavailableInstanceIds?.has(props.entry.instanceId) ?? false;
  const isDisabled = (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
  const showInstanceBadge = shouldShowInstanceBadge(props.entry, props.instanceEntries);
  const tooltip = isUnavailable
    ? describeUnavailableInstance(props.entry, props.messageResolver)
    : isContextDisabled
      ? (props.getDisabledInstanceTooltip?.(props.entry) ?? props.entry.displayName)
      : props.entry.displayName;

  const button = (
    <Toolbar.Button
      className={cn(
        PROVIDER_BUTTON_CLASS,
        isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
      )}
      data-provider-accent-color={props.entry.accentColor}
      onClick={() => !isDisabled && props.onSelectInstance(props.entry.instanceId)}
      onMouseEnter={() => props.setHoveredInstanceId(props.entry.instanceId)}
      onMouseLeave={() =>
        props.setHoveredInstanceId((current) =>
          current === props.entry.instanceId ? null : current,
        )
      }
      onFocus={() => props.setHoveredInstanceId(props.entry.instanceId)}
      onBlur={() =>
        props.setHoveredInstanceId((current) =>
          current === props.entry.instanceId ? null : current,
        )
      }
      disabled={isDisabled}
      focusableWhenDisabled={!isDisabled}
      aria-pressed={props.selected}
      type="button"
      aria-label={isUnavailable || isContextDisabled ? tooltip : props.entry.displayName}
    >
      <ProviderInstanceIcon
        driverKind={props.entry.driverKind}
        displayName={props.entry.displayName}
        accentColor={props.entry.accentColor}
        acpRegistryAgentId={props.entry.acpRegistryAgentId}
        acpRegistryIconUrl={props.entry.acpRegistryIconUrl}
        showBadge={showInstanceBadge}
        className="size-6 z-30"
        iconClassName="size-5"
        indicatorBackground={
          props.hovered && !isDisabled
            ? "var(--muted)"
            : props.selected
              ? "var(--background)"
              : "color-mix(in oklab, var(--muted) 30%, transparent)"
        }
        {...(props.entry.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
      />
    </Toolbar.Button>
  );

  const trigger = isDisabled ? <span className="relative block w-full">{button}</span> : button;

  return (
    <div className="relative w-9 shrink-0" data-model-picker-provider={props.entry.instanceId}>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipPopup
          side={PICKER_TOOLTIP_SIDE}
          sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
          align="center"
        >
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

export const ModelPickerProviderBar = memo(function ModelPickerProviderBar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
}) {
  const m = useMessages();
  const showFavorites = props.showFavorites ?? true;
  const [hoveredInstanceId, setHoveredInstanceId] = useState<ProviderInstanceId | null>(null);

  return (
    <Toolbar.Root
      className="shrink-0 border-b border-border/70 bg-muted/30"
      data-model-picker-provider-bar
      aria-label={m(msg("Providers"))}
      orientation="horizontal"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.onFocusSearch();
          return;
        }
      }}
    >
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {showFavorites ? (
          <div className="relative w-9 shrink-0" data-model-picker-provider="favorites">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toolbar.Button
                    className={PROVIDER_BUTTON_CLASS}
                    onClick={() => props.onSelectInstance("favorites")}
                    type="button"
                    aria-label={m(msg("Favorites"))}
                    aria-pressed={props.selectedInstanceId === "favorites"}
                  >
                    <StarIcon className="size-5 fill-current shrink-0" aria-hidden />
                  </Toolbar.Button>
                }
              />
              <TooltipPopup
                side={PICKER_TOOLTIP_SIDE}
                sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                align="center"
              >
                <T>Favorites</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        ) : null}

        {props.instanceEntries.map((entry) => (
          <ModelPickerProviderBarItem
            key={entry.instanceId}
            entry={entry}
            instanceEntries={props.instanceEntries}
            selected={props.selectedInstanceId === entry.instanceId}
            hovered={hoveredInstanceId === entry.instanceId}
            disabledInstanceIds={props.disabledInstanceIds}
            selectableUnavailableInstanceIds={props.selectableUnavailableInstanceIds}
            getDisabledInstanceTooltip={props.getDisabledInstanceTooltip}
            messageResolver={m}
            onSelectInstance={props.onSelectInstance}
            setHoveredInstanceId={setHoveredInstanceId}
          />
        ))}
      </div>
    </Toolbar.Root>
  );
});
