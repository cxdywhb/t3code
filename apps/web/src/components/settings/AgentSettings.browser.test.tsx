import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { RegistryProvider } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ supported: true, saved: "", persist: vi.fn() }));
vi.mock(import("./SettingsScopeContext"), () => ({
  useSettingsScope: (() => ({
    environment: {
      environmentId: EnvironmentId.make("remote"),
      serverConfig: { environment: { capabilities: { globalAgentInstructions: state.supported } } },
    },
  })) as never,
}));
vi.mock(import("./useScopedSettings"), () => ({
  useScopedSettings: (() => state.saved) as never,
}));
vi.mock(import("../../state/session"), () => ({ useEnvironmentScope: () => true }));
vi.mock(import("../../state/server"), async () => {
  const { Atom } = await import("effect/reactivity");
  const permission = Atom.make(true);
  return { serverEnvironment: { updateSettings: { permissionAtom: () => permission } } } as never;
});
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.persist) as never,
}));
vi.mock(import("./settingsSearch"), () => ({
  useSearchableSetting: () => () => ({ id: "global-agents-md", title: "Global AGENTS.md" }),
}));
vi.mock(
  import("./settingsLayout"),
  () =>
    ({
      SettingsPageContainer: ({ children }: { children: ReactNode }) => children,
      SettingsSection: ({ children }: { children: ReactNode }) => children,
      SettingsRow: ({ children, managed }: { children: ReactNode; managed?: string }) => (
        <div>
          {managed}
          {children}
        </div>
      ),
    }) as never,
);
vi.mock(import("../ui/toast"), () => ({ toastManager: { add: vi.fn() } }) as never);

import { AgentSettingsPanel } from "./AgentSettings";
import { toastManager } from "../ui/toast";

function setup() {
  state.supported = true;
  state.saved = "";
  state.persist.mockReset();
  vi.mocked(toastManager.add).mockClear();
}

it("disables global instructions when the remote server does not advertise support", async () => {
  setup();
  state.supported = false;
  await using screen = await render(
    <RegistryProvider>
      <AgentSettingsPanel />
    </RegistryProvider>,
  );
  await expect.element(screen.getByRole("textbox")).toBeDisabled();
});

it("preserves the draft when a server drops it, and confirms an exact save or clear", async () => {
  setup();
  state.persist.mockResolvedValue(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
  await using screen = await render(
    <RegistryProvider>
      <AgentSettingsPanel />
    </RegistryProvider>,
  );
  const editor = screen.getByRole("textbox");
  const save = screen.getByRole("button", { name: "Save", exact: true });
  const rule = "# Rules\n  保留缩进 🦊\n";
  await editor.fill(rule);
  await save.click();
  await expect.element(editor).toHaveValue(rule);
  expect(toastManager.add).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  await expect.element(save).toBeEnabled();

  state.persist.mockImplementation(async () => {
    state.saved = rule;
    return AsyncResult.success({ ...DEFAULT_SERVER_SETTINGS, globalAgentInstructions: rule });
  });
  await save.click();
  await expect.element(save).toBeDisabled();
  expect(toastManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));

  state.persist.mockImplementation(async () => {
    state.saved = "";
    return AsyncResult.success(DEFAULT_SERVER_SETTINGS);
  });
  await editor.fill("");
  await save.click();
  await expect.element(editor).toHaveValue("");
  await expect.element(save).toBeDisabled();
});
