import {
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  IssueAutomationProfileId,
  ProjectId,
  ProviderInstanceId,
  type IssueAutomationConnector,
  type IssueAutomationProfile,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";

import { ENVIRONMENT_ID, installFakeEnvironment } from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { ProfileModal } from "./IssueAutomationConfigModals";

it("focuses the masked webhook field when saving a rule with an invalid Feishu address", async () => {
  using _environment = installFakeEnvironment([]);
  const connectorId = IssueAutomationConnectorId.make("zentao");
  const projectId = ProjectId.make("app");
  const updatedAt = "2026-11-24T00:00:00.000Z";
  const scope = { id: "5", name: "Example App" };
  const connector: IssueAutomationConnector = {
    id: connectorId,
    platform: IssueAutomationPlatformKind.make("zentao"),
    name: "ZenTao",
    baseUrl: "https://zentao.example.com",
    account: "example",
    hasSecret: true,
    status: "connected",
    viewerName: null,
    serverVersion: null,
    statusDetail: null,
    scopes: [scope],
    updatedAt,
  };
  const rule: IssueAutomationProfile = {
    id: IssueAutomationProfileId.make("example-rule"),
    connectorId,
    name: scope.name,
    enabled: false,
    scopeId: scope.id,
    scopeName: scope.name,
    repositories: { primaryProjectId: projectId, linkedProjectIds: [], moduleMappings: [] },
    models: {
      primaryModel: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      triageModel: null,
      highSeverityModel: null,
      reviewModel: null,
      fallbackModel: null,
    },
    filter: {
      browseType: "unresolved",
      onlyUnconfirmed: false,
      assignedToAccount: null,
      maxSeverity: null,
      keyword: null,
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
  };
  await using _screen = await render(
    <ProfileModal
      open
      onOpenChange={() => {}}
      environmentId={ENVIRONMENT_ID}
      connectors={[connector]}
      projects={[{ id: projectId, title: "Example App", workspaceRoot: "/projects/example" }]}
      initial={rule}
    />,
  );

  const toggle = page.getByRole("switch", { name: "Notify Feishu when a task ends" });
  const webhook = page.getByLabelText("Group bot webhook");
  await expect.element(toggle).not.toBeChecked();
  await expect.element(webhook).not.toBeInTheDocument();
  await toggle.click();
  await webhook.fill("https://example.com/other-webhook");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect.element(webhook).toHaveFocus();
  await expect.element(webhook).toHaveAttribute("type", "password");
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Enter a valid Feishu group bot webhook.");
  await toggle.click();
  await expect.element(webhook).not.toBeInTheDocument();
});
