import { Slider } from "@base-ui/react/slider";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { type CSSProperties, type PointerEvent, useEffect, useId, useRef, useState } from "react";

import "./ComposerEffortSlider.css";

type EffortChoices = Extract<ProviderOptionDescriptor, { type: "select" }>["options"];

const stars = Array.from({ length: 22 }, (_, index) => ({
  top: `${8 + ((index * 31) % 85)}%`,
  "--star-phase": ((index + 1) * 0.61803398875) % 1,
  "--star-period": 0.92 + ((index * 7) % 17) / 100,
  "--star-brightness": 0.5 + ((index * 29) % 51) / 100,
}));

export function ComposerEffortSlider(props: {
  label: string;
  choices: EffortChoices;
  index: number;
  playbackRate?: number;
  onPick: (id: string) => void;
}) {
  const gt = useGT();
  const descriptionId = useId();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; origin: number; travel: number } | null>(null);
  const maxIndex = props.choices.length - 1;
  const index = Math.min(previewIndex ?? props.index, maxIndex);
  const choice = props.choices[index]!;
  const progress = index / maxIndex;
  const defaultLabel = choice.isDefault
    ? gt("Default", { $context: "marks the default option" })
    : null;
  const starCount = Math.round(stars.length * Math.sqrt(progress));
  const fillRef = useRef<HTMLDivElement>(null);
  const playbackRate = props.playbackRate ?? 1;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Retiming the browser's animations preserves their current positions.
  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;
    const syncRate = (event?: AnimationEvent) => {
      const target = event?.target instanceof Element ? event.target : fill;
      for (const animation of target.getAnimations({ subtree: true })) {
        if (animation instanceof CSSAnimation) animation.updatePlaybackRate(playbackRate);
      }
    };
    syncRate();
    fill.addEventListener("animationstart", syncRate);
    return () => fill.removeEventListener("animationstart", syncRate);
  }, [playbackRate]);

  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (gesture?.pointerId !== event.pointerId) return;
    if (event.type === "pointermove") {
      event.currentTarget.toggleAttribute("data-effort-tracking", true);
    }
    const position = (event.clientX - gesture.origin) / gesture.travel;
    event.currentTarget.style.setProperty(
      "--effort-drag-progress",
      String(Math.min(1, Math.max(0, position))),
    );
  };

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.removeAttribute("data-effort-tracking");
    event.currentTarget.style.removeProperty("--effort-drag-progress");
  };

  return (
    <Slider.Root
      data-effort-slider
      value={index}
      max={maxIndex}
      thumbAlignment="edge-client-only"
      onValueChange={setPreviewIndex}
      onValueCommitted={(next, details) => {
        setPreviewIndex(null);
        const picked = props.choices[next];
        if (picked && next !== props.index && !details.event.type.endsWith("cancel")) {
          props.onPick(picked.id);
        }
      }}
      className="flex shrink-0 flex-col gap-1.5 rounded-lg px-2 py-1.5"
      style={
        {
          "--effort-hue": 207 + 59 * progress,
          "--effort-progress": progress,
        } as CSSProperties
      }
    >
      <div aria-hidden="true" className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-muted-foreground">{props.label}</span>
        <span data-effort-value className="min-w-0 truncate text-right font-semibold">
          {choice.label}
          {defaultLabel ? (
            <span className="ms-1 font-normal text-muted-foreground">{defaultLabel}</span>
          ) : null}
        </span>
      </div>
      <Slider.Control
        data-effort-track
        className="group/effort-control relative h-7 w-full touch-none cursor-pointer rounded-full select-none"
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const track = event.currentTarget.getBoundingClientRect();
          const thumb = event.currentTarget.querySelector("[data-effort-thumb]");
          const thumbRect = thumb?.getBoundingClientRect();
          if (!thumbRect || track.width <= thumbRect.width) return;
          const radius = thumbRect.width / 2;
          const offset = thumb?.contains(event.target as Node)
            ? event.clientX - thumbRect.left - radius
            : 0;
          drag.current = {
            pointerId: event.pointerId,
            origin: track.left + radius + offset,
            travel: track.width - thumbRect.width,
          };
          followPointer(event);
        }}
        onPointerMove={followPointer}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onLostPointerCapture={releasePointer}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 border-t border-current forced-colors:block"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-full bg-foreground/12 shadow-inner forced-colors:bg-transparent"
        >
          <div className="absolute inset-x-3.5 top-1/2 forced-colors:hidden">
            {props.choices.map((option, stop) => (
              <span
                key={option.id}
                data-effort-stop={option.id}
                className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25 dark:bg-white/30"
                style={{ left: `${(100 * stop) / maxIndex}%` }}
              />
            ))}
          </div>
          <div
            ref={fillRef}
            data-effort-fill
            className="absolute inset-y-0 left-0 overflow-hidden rounded-full"
          >
            {starCount > 0 ? (
              <>
                <div data-effort-stars className="absolute inset-0 forced-colors:hidden">
                  {stars.slice(0, starCount).map((star) => (
                    <span
                      key={star.top}
                      className="absolute inset-x-0 h-0.75"
                      style={star as CSSProperties}
                    />
                  ))}
                </div>
                <span
                  data-effort-sweep
                  className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent opacity-0 forced-colors:hidden"
                />
              </>
            ) : null}
            <div
              data-effort-knob
              className="absolute inset-y-0 right-0 size-7 rounded-full bg-white group-has-[:focus-visible]/effort-control:outline-2 group-has-[:focus-visible]/effort-control:-outline-offset-4 forced-colors:border-2 forced-colors:border-current"
            />
          </div>
        </div>
        <Slider.Thumb
          data-effort-thumb
          aria-label={props.label}
          aria-valuetext={defaultLabel ? `${choice.label}, ${defaultLabel}` : choice.label}
          aria-describedby={choice.description ? descriptionId : undefined}
          className="size-7 opacity-0"
        />
      </Slider.Control>
      {props.choices.some((option) => option.description) ? (
        // Reserve the tallest description so a top-anchored picker cannot move the track mid-drag.
        <div className="grid min-h-8 min-w-0 grid-cols-[minmax(0,1fr)] text-muted-foreground text-xs leading-4 wrap-anywhere">
          {props.choices.map((option, optionIndex) =>
            option.description ? (
              <p
                key={option.id}
                id={optionIndex === index ? descriptionId : undefined}
                aria-hidden={optionIndex !== index}
                className={
                  optionIndex === index
                    ? "col-start-1 row-start-1"
                    : "invisible col-start-1 row-start-1"
                }
              >
                {option.description}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
    </Slider.Root>
  );
}
