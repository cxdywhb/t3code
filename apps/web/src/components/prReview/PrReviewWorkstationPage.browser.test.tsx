import { EnvironmentId, PrReviewTask, PullRequestListEntry } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PrReviewWorkstationPage } from "./PrReviewWorkstationPage";

import "~/index.css";

const environmentId = EnvironmentId.make("layout-test");
const repository =
  "engineering/workspaces/platform/extra-long-repository-for-testing-narrow-columns";
const title = "Fix credential refresh";
const summary = "Refresh must be retried after a transient failure.";
const updatedAt = "2026-11-25T09:00:00.000Z";
const pr = {
  provider: "gitlab",
  host: "gitlab.example.test",
  repository,
  projectId: "layout-test",
  projectTitle: "Platform",
  headBranch: "fix/refresh",
  baseBranch: "main",
  updatedAt,
  createdAt: updatedAt,
};
const url = `https://${pr.host}/${repository}/-/merge_requests/5`;
const entry = {
  ...Schema.decodeSync(PullRequestListEntry)({
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
  }),
  environmentId,
};
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

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => environmentId,
}));

vi.mock(import("~/state/pullRequests"), async (original) => ({
  ...(await original()),
  usePullRequestHostList: () => ({
    data: {
      entries: [entry],
      providers: [],
      viewers: {},
      errors: [],
      truncated: false,
      nextCursors: {},
      truncatedEnvironments: [],
    },
    observations: [],
    error: null,
    isPending: false,
    refresh: () => {},
    retry: () => {},
  }),
}));

vi.mock(import("~/state/prReview"), async (original) => ({
  ...(await original()),
  usePrReviewLiveState: () => ({
    environmentId,
    snapshot: { tasks: [task], presets: [], availableSkills: [], activeRunCount: 0 },
    isPending: false,
    error: null,
    refresh: () => {},
  }),
}));

it("keeps a report and both review actions reachable as the queue narrows", async () => {
  const container = document.createElement("div");
  container.style.width = "620px";
  await using screen = await render(<PrReviewWorkstationPage />, { container });
  const report = screen.getByRole("button", { name: /Report/ });
  const agent = screen.getByRole("button", { name: "Agent Review" });
  const fusion = screen.getByRole("button", { name: "Fusion Review" });
  await expect.element(report).toBeVisible();

  for (const width of [620, 360, 1000]) {
    container.style.width = `${width}px`;
    expect(report.element().getBoundingClientRect().right).toBeLessThan(
      agent.element().getBoundingClientRect().left,
    );
    expect(agent.element().getBoundingClientRect().right).toBeLessThan(
      fusion.element().getBoundingClientRect().left,
    );
    expect(fusion.element().getBoundingClientRect().right).toBeLessThan(
      container.getBoundingClientRect().right,
    );
    expect(
      screen.getByText(title, { exact: true }).element().getBoundingClientRect().width,
    ).toBeGreaterThan(24);
  }
  await expect.element(screen.getByText("Request Changes", { exact: true })).toBeVisible();
  container.style.width = "360px";
  await expect.element(screen.getByText("Request Changes", { exact: true })).not.toBeVisible();
  await userEvent.click(report);
  await expect.element(page.getByText(summary)).toBeVisible();
});
