import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../test/render";

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
// The thread list needs live environments; the shortcut lives in the shell around it.
vi.mock(import("../env"), () => ({ isElectron: true }));
vi.mock(import("./Sidebar"), async () => {
  const { SidebarChromeHeader } = await import("./sidebar/SidebarChrome");
  return { default: (() => <SidebarChromeHeader isElectron />) as never };
});

import { AppSidebarLayout } from "./AppSidebarLayout";

describe("sidebar toggle shortcut", () => {
  it("leaves the key to a focused terminal when its rule excludes terminalFocus", async () => {
    localStorage.removeItem("chat_thread_sidebar_open");
    await page.viewport(1280, 800);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <AppSidebarLayout>
        <div data-terminal-owner="drawer">
          <textarea aria-label="Terminal input" />
        </div>
        <button type="button">Outside</button>
      </AppSidebarLayout>,
    );
    const wrapper = screen.container.querySelector('[data-slot="sidebar-wrapper"]')!;

    await userEvent.click(screen.getByRole("textbox", { name: "Terminal input" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(wrapper.getAttribute("data-sidebar-state")).toBe("expanded");

    await userEvent.click(screen.getByRole("button", { name: "Outside" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    await vi.waitFor(() => expect(wrapper.getAttribute("data-sidebar-state")).toBe("collapsed"));
  });
});

it("centers the wordmark between the window controls and history and keeps the toggle reachable", async () => {
  localStorage.removeItem("chat_thread_sidebar_open");
  await page.viewport(1280, 800);
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using screen = await render(
    <AppSidebarLayout>
      <main />
    </AppSidebarLayout>,
  );

  const panel = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-container"]')!;
  const logo = screen.getByRole("link", { name: "X Code" }).element().getBoundingClientRect();
  const back = screen.getByRole("button", { name: "Go back" }).element().getBoundingClientRect();
  const forward = screen
    .getByRole("button", { name: "Go forward" })
    .element()
    .getBoundingClientRect();
  const toggle = screen.getByRole("button", { name: "Toggle main sidebar" });
  const rect = () => toggle.element().getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  expect(Math.abs((logo.left + logo.right - bounds.left - 90 - back.left) / 2)).toBeLessThan(1);
  expect(back.left).toBeGreaterThan(logo.right);
  expect(forward.left).toBeGreaterThanOrEqual(back.right);
  expect(Math.abs(rect().left - forward.right)).toBeLessThan(1);
  expect(bounds.right - rect().right).toBeLessThanOrEqual(10);

  await vi.waitFor(() => expect(getComputedStyle(panel).transitionProperty).toContain("translate"));
  await userEvent.click(toggle);
  await vi.waitFor(() => expect(panel.getBoundingClientRect().right).toBeCloseTo(0, 0));
  expect(rect().left).toBeCloseTo(bounds.left + 90, 0);
  await userEvent.click(toggle);
  await vi.waitFor(() => expect(panel.getBoundingClientRect().right).toBeCloseTo(bounds.right, 0));
  expect(rect().left).toBeCloseTo(forward.right, 0);
});
