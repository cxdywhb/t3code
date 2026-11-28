import {
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  IssueAutomationProfileId,
  IssueAutomationTaskId,
  ProviderInstanceId,
  WS_METHODS,
  type IssueAutomationAnalyzeIssuesInput,
  type IssueAutomationListRemoteIssuesInput,
  type IssueAutomationSaveProfileInput,
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
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
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

it("scans without dispatching and opens diagnosis, repair and ZenTao sync from the task report", async () => {
  using _environment = installFakeEnvironment([], {
    capabilities: { issueAutomationRepair: true },
    providers: [
      CLAUDE_PROVIDER,
      {
        ...CODEX_PROVIDER,
        supportsReadOnlyDiagnosis: true,
        models: CODEX_PROVIDER.models.map((model) =>
          model.slug === "gpt-5.4" ? { ...model, supportsReadOnlyDiagnosis: false } : model,
        ),
      },
    ],
  });
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
        mcpUrl: "https://mcp.example.com/zentao/mcp",
        writeActions: ["comment", "confirm", "resolve", "close", "activate", "create"],
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
          primaryModel: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-opus-4-6",
          },
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
  const savedModels = vi.fn((input: IssueAutomationSaveProfileInput) =>
    Effect.succeed({ ...snapshot.profiles[0]!, models: input.models }),
  );
  using _saveProfile = answerRpc(WS_METHODS.issueAutomationSaveProfile, savedModels);
  const diagnosis = snapshot.tasks[1]!;
  const repair = {
    ...diagnosis,
    id: IssueAutomationTaskId.make("attempt-3"),
    repairOfTaskId: diagnosis.id,
    actionMode: "fix_worktree_review",
    stage: "needs_human",
    createdAt: "2026-11-24T01:00:00.000Z",
    diagnosisReport: [
      "Applied and tested the repair",
      "",
      "## 禅道评论",
      "问题原因：保存记录后，列表仍显示旧数据。",
      "解决方案：保存成功后会刷新列表。",
    ].join("\n"),
    worktreeBranch: "fix/zentao-312",
  } satisfies IssueAutomationTask;
  let current = snapshot;
  const publish = (task: IssueAutomationTask) =>
    Effect.sync(() => {
      current = { ...snapshot, tasks: [task, ...snapshot.tasks] };
    });
  using _state = answerRpc(WS_METHODS.issueAutomationGetState, () => Effect.sync(() => current));
  using _subscribe = answerRpc(WS_METHODS.issueAutomationSubscribe, () => Stream.never);
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
  using _detail = answerRpc(WS_METHODS.issueAutomationGetRemoteIssueDetail, () =>
    Effect.succeed({
      ...matchingIssue,
      stepsHtml: "",
      stepsMarkdown: "",
      imageUrls: [],
      openedBuild: "6",
      availableBuilds: [{ id: "7", name: "v1.2.0" }],
      availableUsers: [],
      comments: [],
    }),
  );
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
  const dispatch = vi.fn((input: IssueAutomationAnalyzeIssuesInput) =>
    input.repairFromTaskId === diagnosis.id
      ? publish(repair).pipe(Effect.as({ tasks: [repair] }))
      : Effect.die("Expected a repair launched from the diagnosis report"),
  );
  using _dispatch = answerRpc(WS_METHODS.issueAutomationAnalyzeIssues, dispatch);
  const legacyPoll = vi.fn(() => Effect.die("The scan must not trigger polling"));
  using _legacyPoll = answerRpc(WS_METHODS.issueAutomationTriggerPoll, legacyPoll);
  using _confirm = answerRpc(WS_METHODS.issueAutomationConfirmRepair, () =>
    publish({ ...repair, stage: "completed", repairConfirmedAt: updatedAt }).pipe(Effect.asVoid),
  );
  const writeBack = vi.fn(() => Effect.succeed({ ok: true }));
  using _writeBack = answerRpc(WS_METHODS.issueAutomationWriteBack, writeBack);

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
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit unattended rule" });
  await expect
    .element(profileDialog.getByRole("combobox", { name: "Execution mode" }))
    .toHaveTextContent("Diagnose the root cause only");
  const primary = profileDialog.getByRole("button", { name: /Primary model/ });
  await expect.element(primary).toHaveTextContent("Opus 4.6");
  await primary.click();
  await page.getByPlaceholder("Search models...").fill("Opus");
  await expect.element(page.getByRole("option", { name: /Opus 4.6/ })).toBeVisible();
  await page.getByPlaceholder("Search models...").fill("GPT-5");
  await expect.element(page.getByRole("option", { name: /GPT-5.5/ })).toBeVisible();
  await expect.element(page.getByRole("option", { name: /GPT-5.4/ })).not.toBeInTheDocument();
  await page.getByRole("option", { name: /GPT-5.5/ }).click();
  await expect
    .element(profileDialog.getByRole("button", { name: /Cross-review model/ }))
    .toBeDisabled();
  const backgroundPolling = profileDialog.getByRole("switch", {
    name: "Enable background polling",
  });
  await expect.element(backgroundPolling).not.toBeChecked();
  await backgroundPolling.click();
  expect(savedModels).not.toHaveBeenCalled();
  await profileDialog.getByRole("button", { name: "Save rule" }).click();
  await expect.element(profileDialog).not.toBeInTheDocument();
  expect(savedModels).toHaveBeenCalledWith(
    expect.objectContaining({
      enabled: true,
      models: expect.objectContaining({ primaryModel: { instanceId: "codex", model: "gpt-5.5" } }),
    }),
  );
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect.element(page.getByText("Pairing screen stays blank")).toBeVisible();
  await expect.element(page.getByText("Pairing already confirmed")).not.toBeInTheDocument();
  const selectPage = page.getByRole("checkbox", { name: "Select all issues on this page" });
  await selectPage.click();
  await expect.element(page.getByRole("status").filter({ hasText: "1 selected" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Run batch" })).toBeVisible();
  await expect.element(page.getByText("Pairing screen stays blank")).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect.element(selectPage).not.toBeChecked();
  await expect.element(page.getByRole("button", { name: "Run batch" })).not.toBeInTheDocument();
  const scanInput = {
    supportsPauseStages: true,
    connectorId,
    scopeId: scope.id,
    browseType: "unresolved",
    keyword: "Pairing",
    page: 1,
    pageSize: 100,
  };
  expect(scans).toEqual([scanInput]);
  expect(dispatch).not.toHaveBeenCalled();
  expect(legacyPoll).not.toHaveBeenCalled();
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
  await page.viewport(420, 800);
  await expect.element(page.getByText("Pairing diagnosis")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "View diagnosis" })).toBeVisible();
  await page.viewport(1200, 800);
  expect(page.getByText("Pairing diagnosis").all()).toHaveLength(1);
  const history = page.getByRole("button", { name: "Execution history · 2 runs" });
  await expect.element(history).toHaveAttribute("aria-expanded", "false");
  await history.click();
  await expect.element(page.getByText("Run 2", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Run 1", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "View result" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "View logs" })).toBeVisible();

  await expect.element(page.getByRole("button", { name: "Start repair" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "View diagnosis" }).click();
  await page.getByRole("button", { name: "Start repair" }).click();
  await expect.element(page.getByRole("button", { name: "Review repair" })).toBeVisible();
  await expect.element(page.getByText("Applied and tested the repair")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Sync repair to ZenTao" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Confirm repair" }).click();
  expect(writeBack).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Sync repair to ZenTao" }).click();
  const dialog = page.getByRole("dialog", { name: "Sync repair to ZenTao" });
  const comment = dialog.getByRole("checkbox", { name: "Write repair comment" });
  const resolved = dialog.getByRole("checkbox", { name: "Mark as resolved" });
  const submit = dialog.getByRole("button", { name: "Confirm sync" });
  await expect.element(comment).not.toBeChecked();
  await expect.element(resolved).not.toBeChecked();
  await expect.element(submit).toBeDisabled();
  await resolved.click();
  await expect.element(submit).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Resolved build" }).click();
  await page.getByRole("option", { name: "v1.2.0" }).click();
  await comment.click();
  await expect.element(dialog.getByText("Comment preview")).toBeVisible();
  await expect.element(dialog.getByText(/解决方案：保存成功后会刷新列表。/)).toBeVisible();
  await expect.element(dialog.getByText("Applied and tested the repair")).not.toBeInTheDocument();
  await submit.click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(writeBack).toHaveBeenCalledExactlyOnceWith({
    connectorId,
    action: { kind: "sync_repair", taskId: repair.id, writeComment: true, resolvedBuild: "7" },
  });

  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  const allTime = page.getByRole("button", { name: "All time", exact: true });
  await expect.element(allTime).toBeVisible();
  (allTime.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("Issues covered")).toBeVisible();
  await expect.element(page.getByText("Pipeline outcome distribution")).toBeVisible();
});
