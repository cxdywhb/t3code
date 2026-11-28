import { PrReviewTask, PullRequestListEntry, WS_METHODS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  answerRpc,
  installFakeEnvironment,
  PROJECT_ID,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

vi.mock("../../../../../packages/client-runtime/src/connection/driver.ts", async (original) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    original<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

const repository =
  "engineering/workspaces/platform/extra-long-repository-for-testing-narrow-columns";
const title = "Fix credential refresh";
const summary = "Refresh must be retried after a transient failure.";
const updatedAt = "2026-11-25T09:00:00.000Z";
const pr = {
  provider: "gitlab",
  host: "gitlab.example.test",
  repository,
  projectId: PROJECT_ID,
  projectTitle: "Platform",
  headBranch: "fix/refresh",
  baseBranch: "main",
  updatedAt,
  createdAt: updatedAt,
};
const url = `https://${pr.host}/${repository}/-/merge_requests/5`;
const entry = Schema.decodeSync(PullRequestListEntry)({
  ...pr,
  number: 5,
  title,
  url,
  author: { login: "alex", name: null, avatarUrl: null },
  state: "open",
  isDraft: false,
  mergeability: "unknown",
  additions: 0,
  deletions: 0,
  viewerReviewRequested: false,
  labels: [],
});
const task = Schema.decodeSync(PrReviewTask)({
  ...pr,
  id: "report-5",
  presetId: null,
  presetName: null,
  prNumber: 5,
  prTitle: title,
  prUrl: url,
  prAuthor: "alex",
  headSha: null,
  mode: "multi_model_fusion",
  stage: "completed",
  boundSkillNames: [],
  reviewerRuns: [],
  synthesizerModelLabel: null,
  synthesisThreadId: null,
  verdict: "request-changes",
  summaryMarkdown: summary,
  findings: [],
  commentSyncedAt: null,
  reviewSyncedAt: null,
  lastError: null,
  steps: [],
  completedAt: updatedAt,
});

it("keeps compact review actions and the report on the unified PR list", async () => {
  using _environment = installFakeEnvironment([], {
    capabilities: { pullRequests: true, prReview: true },
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const merged = {
    ...entry,
    state: "merged",
    number: 6,
    title: "Completed validation",
    updatedAt: "2026-11-15T09:00:00.000Z",
    url: entry.url.replace(/5$/, "6"),
    author: { login: "sam", name: null, avatarUrl: null },
  };
  using _list = answerRpc(WS_METHODS.pullRequestsList, () =>
    Effect.succeed({
      entries: [merged, entry],
      viewers: { [entry.host]: "alex" },
      providers: [
        {
          host: entry.host,
          kind: entry.provider,
          searchesOnHost: true,
          projectCount: 1,
          projectIds: [PROJECT_ID],
          configured: true,
          detail: null,
        },
      ],
      errors: [],
      truncated: false,
      nextCursors: {},
    }),
  );
  const snapshot = { tasks: [task], presets: [], availableSkills: [], activeRunCount: 0 };
  using _state = answerRpc(WS_METHODS.prReviewGetState, () => Effect.succeed(snapshot));
  using _stream = answerRpc(WS_METHODS.prReviewSubscribe, () =>
    Stream.concat(Stream.make(snapshot), Stream.never),
  );

  await page.viewport(800, 800);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/pr-review"] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, { router: false });

  await expect.element(page.getByText(title, { exact: true })).toBeVisible();
  expect(router.state.location).toMatchObject({
    pathname: "/pull-requests",
    search: { reviewWorkspace: true },
  });
  await page.getByRole("button", { name: "Metrics & ROI", exact: true }).first().click();
  const benchmark = page.getByRole("combobox", { name: "Human-effort ROI benchmark:" });
  await expect.element(benchmark.getByText("Standard", { exact: true })).toBeVisible();
  await benchmark.click();
  await expect
    .element(page.getByRole("option", { name: "Standard R&D (350 LoC/h)" }))
    .toBeVisible();
  await page.getByRole("option", { name: "Strict dual-gate (250 LoC/h)" }).click();
  await expect.element(benchmark.getByText("Strict", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pull requests", exact: true }).click();
  const openHeading = page.getByRole("heading", { name: "Open", exact: true });
  const completedHeading = page.getByRole("heading", { name: "Completed", exact: true });
  await expect.element(openHeading).toBeVisible();
  await expect.element(completedHeading).toBeVisible();
  const ownRow = page
    .getByText(title, { exact: true })
    .element()
    .closest("[data-pull-request-key]");
  expect(openHeading.element().getBoundingClientRect().top).toBeLessThan(
    completedHeading.element().getBoundingClientRect().top,
  );
  const panelToggle = page.getByRole("button", { name: "Toggle right panel", exact: true });
  const search = page.getByRole("button", { name: "Search pull requests", exact: true });
  await expect.element(panelToggle).toBeVisible();
  await expect.element(search).toBeVisible();
  expect(search.element().getBoundingClientRect().right).toBeLessThan(
    panelToggle.element().getBoundingClientRect().left,
  );
  await search.click();
  const searchInput = page.getByRole("searchbox", { name: "Search pull requests", exact: true });
  await expect.element(searchInput).toHaveFocus();
  await expect
    .poll(() => searchInput.element().getBoundingClientRect().right)
    .toBeLessThan(panelToggle.element().getBoundingClientRect().left);
  const agent = page
    .elementLocator(ownRow!)
    .getByRole("button", { name: "Agent Review", exact: true });
  const fusion = page
    .elementLocator(ownRow!)
    .getByRole("button", { name: "Fusion Review", exact: true });
  await expect.element(agent).toBeVisible();
  await expect.element(fusion).toBeVisible();
  for (const button of [agent, fusion]) {
    const bounds = button.element().getBoundingClientRect();
    expect(bounds.width).toBe(bounds.height);
    expect(bounds.width).toBeLessThanOrEqual(28);
    expect(button.element().textContent).toBe("");
  }
  await page.getByRole("button", { name: "Batch Fusion Review", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: `Select ${title} for review` });
  await checkbox.click();
  const secondRow = page.getByText(merged.title, { exact: true });
  await secondRow.click();
  await expect.element(checkbox).toBeChecked();
  await expect
    .element(page.getByRole("checkbox", { name: `Select ${merged.title} for review` }))
    .toBeChecked();
  await page.getByRole("button", { name: "Batch Fusion Review (2)", exact: true }).click();
  await expect
    .element(page.getByRole("heading", { name: "Batch Multi-Model PR Fusion Review (2)" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancel = page.getByRole("button", { name: "Cancel batch selection", exact: true });
  await expect.element(cancel).toBeVisible();
  expect(cancel.element().textContent).toBe("");
  await cancel.click();
  await expect.element(checkbox).not.toBeInTheDocument();
  await expect.element(cancel).not.toBeInTheDocument();
  using clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-27T09:00:00.000Z"));
  const filters = page.getByRole("button", { name: /^Filters/ });
  await filters.click();
  await page.getByRole("menuitem", { name: /Last updated/ }).hover();
  await page.getByRole("menuitemradio", { name: "Last 3 days" }).click();
  await expect.element(secondRow).not.toBeInTheDocument();
  await expect.element(page.getByText(title, { exact: true })).toBeVisible();
  expect(router.state.location.search).toMatchObject({ updatedWithin: "3d" });
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await expect.element(secondRow).toBeVisible();
  await filters.click();
  clock.mockRestore();
  await agent.hover();
  await expect.element(page.getByText("Agent Review", { exact: true })).toBeVisible();
  await fusion.hover();
  await expect.element(page.getByText("Fusion Review", { exact: true })).toBeVisible();
  await fusion.click();
  await expect.element(page.getByRole("dialog")).toBeVisible();

  await router.navigate({ to: "/" });
  const usage = page.getByRole("button", { name: "Usage", exact: true });
  const terminal = page.getByRole("button", { name: "Global terminal", exact: true });
  await expect.element(usage).toBeVisible();
  await expect.element(terminal).toBeVisible();
  expect(usage.element().closest("li")?.nextElementSibling).toBe(terminal.element().closest("li"));
});
