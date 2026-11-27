import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "A newly added project shows in the sidebar before its first thread",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await browser.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await t3.project("existing-project");
    await t3.open("/settings/labs");
    await screen.getByLabel("Boring sidebar (group by project)", { exact: true }).tap();
    await screen.getByLabel("Two-line folder rows", { exact: true }).waitFor();
    await t3.open("/settings/general");
    await screen.getByLabel("Language", { exact: true }).tap();
    await screen.getByText("中文（简体）", { exact: true }).tap();
    await screen.getByLabel("语言", { exact: true }).waitFor();
    await t3.open();

    const project = await t3.project("new-sidebar-project");
    const projectRow = screen.getByRole("button", "new-sidebar-project", { exact: true });
    const emptyMessage = screen
      .getByTestId("sidebar-project-folder")
      .filter({ hasText: "new-sidebar-project" })
      .getByText("暂无会话", { exact: true });
    await expect(projectRow).toBeVisible();
    await expect(emptyMessage).toBeVisible();
    await app.screenshot("new-project-before-first-thread");

    await projectRow.tap();
    await expect(emptyMessage).toBeHidden();
    await projectRow.tap();
    await expect(emptyMessage).toBeVisible();

    await t3.thread({ project, title: "First thread", messages: ["Start"] });
    await expect(screen.getByRole("button", "First thread", { exact: false })).toBeVisible();
    await expect(emptyMessage).toBeHidden();
  },
);
