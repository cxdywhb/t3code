import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import { readPromptUltrathink, type TraitsSelectionInput } from "./TraitsPicker";

const reasoning = {
  id: "thought_level",
  label: "Thinking",
  type: "select",
  role: "reasoning",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High", description: "More time to reason" },
  ],
} satisfies ProviderOptionDescriptor;

// Shaped like Devin over ACP: its session mode comes first, and its reasoning id is its own.
const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "fusion",
    name: "Fusion (Claude Opus 5.5 Medium + SWE-2 High)",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "mode",
          label: "Session Mode",
          type: "select",
          currentValue: "bypass",
          options: [
            { id: "code", label: "Code" },
            { id: "plan", label: "Plan" },
            { id: "bypass", label: "Bypass Permissions" },
          ],
        },
        reasoning,
        {
          id: "speed",
          label: "Speed",
          type: "select",
          currentValue: "standard",
          options: [
            { id: "standard", label: "Standard" },
            { id: "fast", label: "Fast" },
          ],
        },
        { id: "auto_approve", label: "Auto-approve tools", type: "boolean", currentValue: false },
      ],
    }),
  },
];

const promptModels = [
  {
    ...models[0]!,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          ...reasoning,
          options: [...reasoning.options, { id: "ultrathink", label: "Ultrathink" }],
          promptInjectedValues: ["ultrathink"],
        },
      ],
    }),
  },
];

function traitsInput(
  modelOptions: ReadonlyArray<ProviderOptionSelection>,
  onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection> | undefined) => void,
): TraitsSelectionInput {
  return {
    provider: ProviderDriverKind.make("acpRegistry"),
    instanceId: ProviderInstanceId.make("devin"),
    models,
    model: "fusion",
    modelOptions,
    onModelOptionsChange,
  };
}

function Column(props: {
  initialPrompt?: string;
  onPick?: (choice: ProviderOptionSelection | undefined) => void;
}) {
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
  const [prompt, setPrompt] = useState(props.initialPrompt ?? "");
  const traits = {
    ...traitsInput(options, (next) => {
      props.onPick?.(next?.find((option) => option.id === reasoning.id));
      setOptions(next ?? []);
    }),
    ...(props.initialPrompt ? { models: promptModels } : {}),
    promptUltrathink: readPromptUltrathink(prompt),
    onPromptEdit: setPrompt,
  };
  return (
    <>
      <div data-model-picker-effort>
        <ComposerEffortColumn traits={traits} />
      </div>
      <p role="status">{describeComposerEffort(traits, "bars", "sm").suffix}</p>
    </>
  );
}

it("moves the same speed indicator between all advertised tiers", async () => {
  function Footer() {
    const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
    const tiers = ["Standard", "Fast", "Ultrafast"];
    const traits = {
      ...traitsInput(options, (next) => setOptions(next ?? [])),
      models: [
        {
          ...models[0]!,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              reasoning,
              {
                type: "select",
                id: "serviceTier",
                label: "Speed",
                currentValue: "Standard",
                options: tiers.map((label) => ({ id: label, label })),
              },
            ],
          }),
        },
      ],
    };
    return (
      <>
        <ComposerEffortColumn traits={traits} />
        <ComposerPickerFooter
          traits={traits}
          runtimeMode="full-access"
          runtimeModeOptions={[]}
          onRuntimeModeChange={() => {}}
        />
      </>
    );
  }
  await using screen = await render(<Footer />, { router: false });
  const indicator = screen.container.querySelector<HTMLElement>("[data-speed-indicator]")!;
  const sweep = screen.container.querySelector("[data-effort-sweep]")!;
  const star = screen.container.querySelector("[data-effort-stars] > span")!;
  const animations = [sweep, star].flatMap((element) => element.getAnimations());
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    expect(animations).toHaveLength(2);
    await expect
      .poll(() => animations.map((animation) => animation.playbackRate))
      .toEqual([0.85, 0.85]);
  }
  for (const name of ["Ultrafast", "Fast", "Standard"]) {
    const option = screen.getByRole("radio", { name, exact: true });
    await option.click();
    await expect.element(option).toHaveAttribute("aria-checked", "true");
    for (const animation of animations) {
      await expect.poll(() => animation.playbackRate).toBe(name === "Standard" ? 0.85 : 1.2);
      expect(animation.playState).toBe("running");
    }
    expect(screen.container.querySelector("[data-speed-indicator]")).toBe(indicator);
    await expect
      .poll(() =>
        Math.abs(
          indicator.getBoundingClientRect().left - option.element().getBoundingClientRect().left,
        ),
      )
      .toBeLessThan(1);
  }
});

it("draws an agent's reasoning as bars and keeps its mode out of the levels", async () => {
  await using screen = await render(<Column />, { router: false }); // no routes involved
  const status = screen.getByRole("status");
  expect(status.element().querySelector("[data-composer-effort-glyph]")).not.toBeNull();
  await expect.element(status).toHaveTextContent("");

  const slider = screen.getByRole("slider", { name: "Thinking" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium, Default");
  await expect.element(screen.getByRole("radio", { name: "Plan" })).not.toBeInTheDocument();

  await userEvent.tab();
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await expect.element(slider).toHaveAccessibleDescription("More time to reason");
  await userEvent.keyboard("{Home}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  await userEvent.tab();
  await expect
    .element(screen.getByRole("button", { name: "Session Mode: Bypass Permissions" }))
    .toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  const speed = screen.getByRole("button", { name: "Speed: Standard" });
  await expect.element(speed).toHaveFocus();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitemradio", { name: "Standard" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await expect.element(speed).toHaveFocus();

  await userEvent.click(screen.getByText("Auto-approve tools"));
  await expect
    .element(screen.getByRole("switch", { name: "Auto-approve tools" }))
    .toHaveAttribute("aria-checked", "true");

  await userEvent.click(screen.getByRole("button", { name: "Session Mode: Bypass Permissions" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "Plan" }));
  await expect
    .element(screen.getByRole("button", { name: "Session Mode: Plan" }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
});

it("lets an explicit reasoning choice replace an Ultrathink prefix", async () => {
  await using screen = await render(<Column initialPrompt="Ultrathink: Go" />, { router: false }); // no routes involved
  await userEvent.tab();
  await expect.element(screen.getByRole("radio", { name: "Low" })).toHaveFocus();
  await expect.element(screen.getByRole("radio", { name: "Ultrathink" })).not.toBeInTheDocument();
  for (const key of ["{Control>}h{/Control}", "{Meta>}h{/Meta}", "{Alt>}h{/Alt}", "{Delete}"]) {
    await userEvent.keyboard(key);
    await expect.element(screen.getByRole("radio", { name: "Low" })).toHaveFocus();
  }
  await userEvent.keyboard("H");
  await expect.element(screen.getByRole("radio", { name: "High" })).toHaveFocus();
  // Wraps past the last level back to the first match.
  await userEvent.keyboard("m");
  await expect.element(screen.getByRole("radio", { name: "Medium Default" })).toHaveFocus();
  await userEvent.keyboard("h{Enter}");
  const slider = screen.getByRole("slider", { name: "Thinking" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await expect.element(slider).toHaveFocus();
});

it("jumps to advertised stops and keeps arrow keys on the slider", async () => {
  const onPick = vi.fn();
  await using screen = await render(<Column onPick={onPick} />, { router: false });
  const slider = screen.getByRole("slider", { name: "Thinking" });
  const root = slider.element().closest("[data-effort-slider]")!;
  expect(root.querySelectorAll("[data-effort-stop]")).toHaveLength(3);
  const track = root.querySelector<HTMLElement>("[data-effort-track]")!;
  const bounds = track.getBoundingClientRect();
  const high = root
    .querySelector<HTMLElement>('[data-effort-stop="high"]')!
    .getBoundingClientRect();
  const position = { x: high.left + high.width / 2 - bounds.left, y: bounds.height / 2 };
  expect(high.top + high.height / 2).toBeCloseTo(bounds.top + position.y);
  await page.elementLocator(track).click({ position });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await page.elementLocator(track).click({ position });
  expect(onPick).toHaveBeenCalledExactlyOnceWith({ id: reasoning.id, value: "high" });
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium, Default");
});

it("tracks the pointer between reasoning steps and commits once on release", async () => {
  const onPick = vi.fn();
  await using screen = await render(<Column onPick={onPick} />, { router: false }); // no routes involved
  const slider = screen.getByRole("slider", { name: "Thinking" });
  const track = slider.element().closest<HTMLElement>("[data-effort-track]")!;
  const trackLocator = page.elementLocator(track);
  const { left, width } = track.getBoundingClientRect();
  const knob = track.querySelector<HTMLElement>("[data-effort-knob]")!;
  const fill = track.querySelector<HTMLElement>("[data-effort-fill]")!;
  const countStars = () => track.querySelector("[data-effort-stars]")?.childElementCount ?? 0;
  const expectJoinedEdges = () => {
    const edge = knob.getBoundingClientRect().right;
    const stars = track.querySelector<HTMLElement>("[data-effort-stars]")!;
    expect(Math.abs(fill.getBoundingClientRect().right - edge)).toBeLessThan(1);
    expect(Math.abs(stars.getBoundingClientRect().right - edge)).toBeLessThan(1);
  };
  await trackLocator.hover({ position: { x: width * 0.05, y: 14 } });
  await commands.pointerDown();
  try {
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
    expect(countStars()).toBe(0);
    await trackLocator.hover({ position: { x: width * 0.65, y: 14 } });
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium, Default");
    const expectKnobAtPointer = (fraction: number) => {
      const bounds = knob.getBoundingClientRect();
      expect(Math.abs(bounds.left + bounds.width / 2 - (left + width * fraction))).toBeLessThan(1);
      expect(getComputedStyle(fill).transitionDuration).toBe("0s");
    };
    expectKnobAtPointer(0.65);
    expectJoinedEdges();
    const midStars = countStars();
    expect(midStars).toBeGreaterThan(0);
    expect(midStars).toBeLessThan(22);
    await trackLocator.hover({ position: { x: width * 0.95, y: 14 } });
    await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
    expect(countStars()).toBe(22);
    await trackLocator.hover({ position: { x: width * 0.83, y: 14 } });
    expectKnobAtPointer(0.83);
    expectJoinedEdges();
    expect(onPick).not.toHaveBeenCalled();
  } finally {
    await commands.pointerUp();
  }
  expect(onPick).toHaveBeenCalledExactlyOnceWith({ id: "thought_level", value: "high" });
  expect(track.style.getPropertyValue("--effort-drag-progress")).toBe("");
  expect(track.hasAttribute("data-effort-tracking")).toBe(false);
  expectJoinedEdges();
  await expect
    .poll(() => Math.abs(knob.getBoundingClientRect().right - (left + width)))
    .toBeLessThan(1);

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const layer of track.querySelectorAll("[data-effort-stars] > span, [data-effort-sweep]")) {
      const [animation] = layer.getAnimations();
      const effect = animation!.effect as KeyframeEffect;
      expect(effect.getTiming().iterations).toBe(Infinity);
      expect(effect.getTiming().direction).toBe("normal");
      expect(effect.getKeyframes().at(-1)?.transform).toBe("translateX(-100%)");
    }
  }

  let pointerId = 0;
  track.addEventListener("pointerdown", (event) => (pointerId = event.pointerId), { once: true });
  await trackLocator.hover({ position: { x: width * 0.05, y: 14 } });
  await commands.pointerDown();
  try {
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
    track.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId }));
    await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  } finally {
    await commands.pointerUp();
  }
  expect(onPick).toHaveBeenCalledTimes(1);
});
