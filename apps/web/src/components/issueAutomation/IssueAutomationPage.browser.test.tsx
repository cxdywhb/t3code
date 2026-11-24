import {
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  IssueAutomationProfileId,
  IssueAutomationTaskId,
  ProviderInstanceId,
  WS_METHODS,
  type IssueAutomationListRemoteIssuesInput,
  type IssueAutomationRemoteIssue,
  type IssueAutomationStateSnapshot,
  type IssueAutomationTask,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
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

it("scans a paused rule on a server without the scan RPC and only lists matching issues", async () => {
  using _environment = installFakeEnvironment([]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const connectorId = IssueAutomationConnectorId.make("zentao");
  const profileId = IssueAutomationProfileId.make("mobile-unconfirmed");
  const platform = IssueAutomationPlatformKind.make("zentao");
  const updatedAt = "2026-11-24T00:00:00.000Z";
  const scope = { id: "5", name: "Mobile app" };
  const previous = {
    id: IssueAutomationTaskId.make("attempt-1"),
    profileId,
    connectorId,
    platform,
    scopeId: scope.id,
    scopeName: scope.name,
    issueKey: "312",
    displayKey: "#312",
    issueTitle: "Pairing diagnosis",
    issueUrl: "https://zentao.example.com/bug-view-312.html",
    moduleName: null,
    severity: 2,
    priority: null,
    issueStatus: "active",
    assignee: null,
    trigger: "manual",
    actionMode: "diagnose_only",
    stage: "cancelled",
    targetProjectId: PROJECT_ID,
    referenceProjectIds: [],
    primaryThreadId: null,
    reviewThreadId: null,
    assignedModelLabel: "codex:gpt-5.4",
    worktreeBranch: null,
    diagnosisReport: null,
    reviewReport: null,
    commentSyncedAt: null,
    stateSyncedAt: null,
    remoteUpdatedMarker: null,
    lastError: null,
    steps: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt,
    completedAt: updatedAt,
  } satisfies IssueAutomationTask;
  const snapshot: IssueAutomationStateSnapshot = {
    platforms: [],
    connectors: [
      {
        id: connectorId,
        platform,
        name: "ZenTao",
        baseUrl: "https://zentao.example.com",
        account: "test",
        hasSecret: true,
        status: "connected",
        viewerName: null,
        serverVersion: null,
        statusDetail: null,
        scopes: [scope],
        updatedAt,
      },
    ],
    profiles: [
      {
        id: profileId,
        connectorId,
        name: "Unconfirmed mobile issues",
        enabled: false,
        scopeId: scope.id,
        scopeName: scope.name,
        repositories: { primaryProjectId: PROJECT_ID, linkedProjectIds: [], moduleMappings: [] },
        models: {
          primaryModel: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          triageModel: null,
          highSeverityModel: null,
          reviewModel: null,
          fallbackModel: null,
        },
        filter: {
          browseType: "unresolved",
          onlyUnconfirmed: true,
          assignedToAccount: null,
          maxSeverity: null,
          keyword: "Pairing",
          pollIntervalMinutes: 5,
          maxConcurrency: 1,
        },
        policy: {
          actionMode: "diagnose_only",
          autoWriteComment: false,
          baseBranch: null,
          customPromptInstructions: null,
        },
        lastPolledAt: null,
        lastPollError: null,
        updatedAt,
      },
    ],
    tasks: [
      previous,
      {
        ...previous,
        id: IssueAutomationTaskId.make("attempt-2"),
        stage: "completed",
        createdAt: updatedAt,
        diagnosisReport: "Diagnosis result",
      },
    ],
    activeRunCount: 0,
  };
  using _state = answerRpc(WS_METHODS.issueAutomationGetState, () => Effect.succeed(snapshot));
  using _subscribe = answerRpc(WS_METHODS.issueAutomationSubscribe, () =>
    Stream.concat(Stream.make(snapshot), Stream.never),
  );
  const matchingIssue: IssueAutomationRemoteIssue = {
    connectorId,
    platform,
    scopeId: scope.id,
    scopeName: scope.name,
    key: "312",
    displayKey: "#312",
    title: "Pairing screen stays blank",
    url: "https://zentao.example.com/bug-view-312.html",
    moduleId: null,
    moduleName: null,
    severity: 2,
    priority: null,
    status: "active",
    statusLabel: "Active",
    confirmed: false,
    author: null,
    assignee: null,
    createdAt: updatedAt,
    updatedAt,
    latestTaskId: null,
    latestStage: null,
  };
  const scans: IssueAutomationListRemoteIssuesInput[] = [];
  using _list = answerRpc(
    WS_METHODS.issueAutomationListRemoteIssues,
    (input: IssueAutomationListRemoteIssuesInput) => {
      if (input.keyword !== "Pairing") {
        return Effect.succeed({ issues: [], total: 0, page: 1, pageSize: 25 });
      }
      scans.push(input);
      return Effect.succeed({
        issues: [
          matchingIssue,
          { ...matchingIssue, key: "313", title: "Pairing already confirmed", confirmed: true },
        ],
        total: 2,
        page: 1,
        pageSize: input.pageSize ?? 25,
      });
    },
  );
  const unsupportedScan = vi.fn(() =>
    Effect.die("Unknown request tag: issueAutomation.scanProfileIssues"),
  );
  using _scan = answerRpc(WS_METHODS.issueAutomationScanProfileIssues, unsupportedScan);
  const dispatch = vi.fn(() => Effect.die("The scan must not dispatch a task"));
  using _dispatch = answerRpc(WS_METHODS.issueAutomationAnalyzeIssues, dispatch);
  using _legacyPoll = answerRpc(WS_METHODS.issueAutomationTriggerPoll, dispatch);

  await page.viewport(1200, 800);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/issue-automation"] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, {
    // AppRoot mounts the actual routes.
    router: false,
  });
  await page.getByRole("button", { name: /^Automation/ }).click();
  await expect
    .element(page.getByRole("switch", { name: /Unconfirmed mobile issues/ }))
    .not.toBeChecked();
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect.element(page.getByText("Pairing screen stays blank")).toBeVisible();
  await expect.element(page.getByText("Pairing already confirmed")).not.toBeInTheDocument();
  const scanInput = {
    connectorId,
    scopeId: scope.id,
    browseType: "unresolved",
    keyword: "Pairing",
    page: 1,
    pageSize: 100,
  };
  expect(scans).toEqual([scanInput]);
  expect(dispatch).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Clear rule filter" }).click();
  await expect.element(page.getByText("Pairing screen stays blank")).not.toBeInTheDocument();

  await page.getByRole("button", { name: /^Automation/ }).click();
  await page.getByRole("button", { name: "More rule actions" }).click();
  const ruleMenu = page.getByRole("menu");
  await expect.element(ruleMenu.getByRole("menuitem", { name: "Delete rule" })).toBeVisible();
  expect(ruleMenu.getByRole("menuitem").all()).toHaveLength(1);
  await userEvent.keyboard("{Escape}");
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect.element(page.getByText("Pairing screen stays blank")).toBeVisible();
  expect(scans).toEqual([scanInput, scanInput]);
  expect(unsupportedScan).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();

  await page.getByRole("button", { name: /^Runs/ }).click();
  await expect.element(page.getByText("Pairing diagnosis")).toBeVisible();
  expect(page.getByText("Pairing diagnosis").all()).toHaveLength(1);
  const history = page.getByRole("button", { name: "Execution history · 2 runs" });
  await expect.element(history).toHaveAttribute("aria-expanded", "false");
  await history.click();
  await expect.element(page.getByText("Run 2", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Run 1", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "View result" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "View logs" })).toBeVisible();
});
