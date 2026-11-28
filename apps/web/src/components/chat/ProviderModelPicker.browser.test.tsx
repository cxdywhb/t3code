import {
  DEFAULT_CLIENT_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ComposerEffortSlider } from "./ComposerEffortSlider";
import { ComposerPickerFooter } from "./ComposerModelEffort";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { resolveRuntimeModeOption, runtimeModeOptions } from "./runtimeModeConfig";
import { markOpenToPermissions } from "./composerEventScope";

it("keeps the composer picker in place when a permission change reveals the footer chip", async () => {
  const defaultMode = "approval-required";
  const options = runtimeModeOptions.map((mode) => resolveRuntimeModeOption(mode));

  function ComposerFooter() {
    const [mode, setMode] = useState<RuntimeMode>(defaultMode);
    return (
      <div className="mx-auto flex w-96 justify-end" data-chat-composer-footer-controls>
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={ProviderInstanceId.make("codex")}
          model="test"
          lockedProvider={null}
          instanceEntries={[]}
          modelOptionsByInstance={new Map()}
          isComposerOwned
          popupAlign="end"
          triggerAriaLabel="Choose model"
          effortColumn={<div />}
          footer={
            <ComposerPickerFooter
              traits={null}
              runtimeMode={mode}
              runtimeModeOptions={options}
              onRuntimeModeChange={setMode}
            />
          }
          onInstanceModelChange={() => {}}
        />
        {mode !== defaultMode ? <span className="w-24">Permission chip</span> : null}
      </div>
    );
  }

  await using screen = await render(<ComposerFooter />);
  const trigger = screen.getByRole("button", { name: "Choose model" });
  markOpenToPermissions(trigger.element() as HTMLElement);
  await trigger.click();
  const permissions = page.getByRole("radiogroup", { name: "Permissions" });
  const supervised = permissions.getByRole("radio", { name: "Supervised" });
  const positioner = permissions
    .element()
    .closest<HTMLElement>('[data-slot="popover-positioner"]')!;
  const before = positioner.getBoundingClientRect();
  const triggerRight = trigger.element().getBoundingClientRect().right;
  await expect.element(supervised).toHaveAttribute("aria-checked", "true");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await expect.element(supervised).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  const auto = permissions.getByRole("radio", { name: "Auto", exact: true });
  await expect.element(auto).toHaveFocus();
  await expect.element(supervised).toHaveAttribute("aria-checked", "true");
  const description = document.getElementById(auto.element().getAttribute("aria-describedby")!)!;
  await expect.element(description).toBeVisible();
  expect(description.clientHeight).toBeGreaterThanOrEqual(32);
  expect(description.scrollHeight).toBeLessThanOrEqual(description.clientHeight);
  await userEvent.keyboard("{ArrowRight}{Enter}");
  await expect
    .element(permissions.getByRole("radio", { name: "Full access" }))
    .toHaveAttribute("aria-checked", "true");
  expect(trigger.element().getBoundingClientRect().right).toBeLessThan(triggerRight);
  const after = positioner.getBoundingClientRect();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

it("keeps each registry image when adding a model from another ACP agent", async () => {
  const icons = [
    "https://cdn.agentclientprotocol.com/registry/icons/picker-explicit.svg",
    "https://cdn.agentclientprotocol.com/registry/v1/latest/picker-by-id.svg",
  ];
  const cache = await caches.open("t3-acp-registry-icons-v1");
  await using _cachedIcons = {
    async [Symbol.asyncDispose]() {
      await Promise.all(icons.map((url) => cache.delete(url)));
    },
  };
  for (const [index, url] of icons.entries()) {
    await cache.put(
      url,
      new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${11 + index * 6}" height="10"><path d="M0 0h10v10H0z"/></svg>`,
        { headers: { "content-type": "image/svg+xml" } },
      ),
    );
  }
  const entries = deriveProviderInstanceEntries(
    ["First", "Second"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: `${name} agent`,
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  ).map((entry, index) => ({
    ...entry,
    ...(index === 0 ? { acpRegistryIconUrl: icons[0] } : { acpRegistryAgentId: "picker-by-id" }),
  }));
  const first = { instanceId: entries[0]!.instanceId, model: "first" };
  const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));

  function Picker() {
    const [selection, setSelection] = useState<ReadonlyArray<ModelSelection>>([first]);
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={first.instanceId}
        model={first.model}
        {...(selection.length > 1 ? { selectedModels: selection } : {})}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        onToggleModel={(instanceId, model) => setSelection([...selection, { instanceId, model }])}
        onInstanceModelChange={(instanceId, model) => setSelection([{ instanceId, model }])}
      />
    );
  }

  await using screen = await render(<Picker />);
  const imageWidths = () =>
    Array.from(
      screen.container.querySelectorAll<HTMLImageElement>("[data-chat-provider-model-picker] img"),
      (image) => image.naturalWidth,
    );
  await vi.waitFor(() => expect(imageWidths()).toEqual([11]));
  await screen.getByRole("button", { name: "First model", exact: true }).click();
  await page.getByRole("button", { name: "Second agent", exact: true }).click();
  await userEvent.keyboard("{Shift>}");
  try {
    await page.getByRole("option", { name: /Second model/ }).click();
  } finally {
    await userEvent.keyboard("{/Shift}");
  }
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(imageWidths()).toEqual([11, 17]));
});

it("keeps a docked picker open after a pick and hands focus to that model's effort", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      [
        { slug: "original", name: "Original model" },
        { slug: "second", name: "Second model" },
        { slug: "plain", name: "Plain model" },
      ],
    ],
  ]);
  function Picker() {
    const [model, setModel] = useState("original");
    const [level, setLevel] = useState(1);
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        triggerAriaLabel="Choose model"
        onInstanceModelChange={(_, selected) => setModel(selected)}
        effortColumn={
          model === "original" ? (
            <ComposerEffortSlider
              label="Thinking"
              choices={[
                { id: "0", label: "Low" },
                { id: "1", label: "High" },
              ]}
              index={level}
              onPick={(id) => setLevel(Number(id))}
            />
          ) : model === "second" ? (
            <button type="button" role="radio" aria-checked data-effort-row data-effort-level>
              Medium
            </button>
          ) : null
        }
      />
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  const slider = page.getByRole("slider", { name: "Thinking" });
  await expect.element(slider).toHaveFocus();
  let modelPane = search.element().closest("[data-model-picker-content]")!;
  const effortPane = slider.element().closest("[data-model-picker-effort]")!;
  expect(
    modelPane.getBoundingClientRect().bottom - effortPane.getBoundingClientRect().top,
  ).toBeLessThan(0.5);
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(slider).toHaveFocus();
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  const track = effortPane.querySelector("[data-effort-track]")!;
  await page.elementLocator(track).click({
    position: { x: track.getBoundingClientRect().width - 14, y: 14 },
  });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await userEvent.keyboard("{Escape}");
  await screen.getByRole("button", { name: "Choose model" }).click();
  modelPane = search.element().closest("[data-model-picker-content]")!;
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(search).toHaveFocus();

  const popup = modelPane.closest<HTMLElement>("[data-slot=popover-popup]")!;
  const height = popup.offsetHeight;
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect.element(page.getByText("No favorites yet")).toBeVisible();
  expect(popup.offsetHeight).toBe(height);
  await page
    .elementLocator(modelPane.querySelector('[data-model-picker-provider="codex"] button')!)
    .click();
  await expect.element(page.getByRole("option", { name: /Original model/ })).toBeVisible();
  expect(popup.offsetHeight).toBe(height);

  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();

  await page.getByRole("option", { name: /Plain model/ }).click();
  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).not.toBeInTheDocument();
});

it("lists a model reported twice by one provider once, with contiguous jump shortcuts", async () => {
  const instanceId = ProviderInstanceId.make("claude");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      ["a", "b", "c", "c", "d", "d"].map((slug) => ({
        slug,
        name: `Model ${slug.toUpperCase()}`,
      })),
    ],
  ]);
  const keybindings = compileResolvedKeybindingsConfig(
    ([1, 2, 3, 4, 5, 6] as const).map((index) => ({
      key: `mod+${index}`,
      command: `modelPicker.jump.${index}` as const,
      when: "modelPickerOpen",
    })),
  );

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={instanceId}
      model="a"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={options}
      keybindings={keybindings}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  await expect.element(page.getByRole("option", { name: /Model A/ })).toBeVisible();
  await vi.waitFor(() =>
    expect(
      page
        .getByRole("option")
        .elements()
        .map((row) => [
          row.textContent?.match(/Model [A-Z]/)?.[0],
          row.querySelector("kbd")?.textContent?.slice(-1),
        ]),
    ).toEqual([
      ["Model A", "1"],
      ["Model B", "2"],
      ["Model C", "3"],
      ["Model D", "4"],
    ]),
  );
});

it("opens on the active provider when every favorite belongs to a disabled provider", async () => {
  const entries = deriveProviderInstanceEntries(
    ["Codex", "Claude"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make(name.toLowerCase()),
      enabled: name === "Codex",
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  );
  const [codex, claude] = entries;
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    favorites: [{ provider: claude!.instanceId, model: "claude" }],
  });
  using _settings = {
    [Symbol.dispose]: () => __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS),
  };

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={codex!.instanceId}
      model="codex"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  await expect.element(page.getByRole("option", { name: /Codex model/ })).toBeVisible();
});

it("keeps the touch keyboard down while choosing a provider", async () => {
  const entries = deriveProviderInstanceEntries(
    ["Codex", "Claude"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make(name.toLowerCase()),
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  );
  const [codex] = entries;
  const matchMedia = window.matchMedia.bind(window);
  using _touch = vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query === "(pointer: coarse)"
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList)
      : matchMedia(query),
  );

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={codex!.instanceId}
      model="codex"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  const popup = search.element().closest('[data-slot="popover-popup"]');
  await vi.waitFor(() => expect(document.activeElement).toBe(popup));

  await page.getByRole("button", { name: /^Claude/ }).click();
  await expect.element(page.getByRole("option", { name: /Claude model/ })).toBeVisible();
  await expect.element(search).not.toHaveFocus();
});
