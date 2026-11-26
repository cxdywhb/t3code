import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "A newly added project shows in the sidebar before its first thread",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("existing-project");
    await t3.open("/settings/labs");
    await screen.getByLabel("Boring sidebar (group by project)", { exact: true }).tap();
    await screen.getByLabel("Two-line folder rows", { exact: true }).waitFor();
    await screen.getByRole("button", "Close", { exact: true }).tap();

    await t3.project("new-sidebar-project");
    const folder = screen
      .getByTestId("sidebar-project-folder")
      .getByRole("button", "new-sidebar-project");
    await expect.soft(folder).toBeVisible();
    await app.screenshot("new-project-before-first-thread");
  },
);
