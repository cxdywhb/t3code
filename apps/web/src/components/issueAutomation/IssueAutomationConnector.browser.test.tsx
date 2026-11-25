import {
  AuthAdministrativeClientScopes,
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  WS_METHODS,
  type IssueAutomationConnector,
  type IssueAutomationFinishConnectorAuthInput,
  type IssueAutomationStartConnectorAuthInput,
  type IssueAutomationStateSnapshot,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { answerRpc, installFakeEnvironment, type FakeDriver } from "../../../test/fakeEnvironment";
import { render, stubGlobal } from "../../../test/render";

vi.mock("../../../../../packages/client-runtime/src/connection/driver.ts", async (original) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    original<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it("reconnects an existing tracker automatically when browser authorization completes", async () => {
  using _environment = installFakeEnvironment([], { scopes: AuthAdministrativeClientScopes });
  const legacy: IssueAutomationConnector = {
    id: IssueAutomationConnectorId.make("same-connector"),
    platform: IssueAutomationPlatformKind.make("zentao"),
    name: "ZenTao",
    baseUrl: "https://bugs.example.test",
    mcpUrl: null,
    writeActions: [],
    status: "disconnected",
    viewerName: null,
    serverVersion: null,
    statusDetail: null,
    scopes: [{ id: "5", name: "App" }],
    updatedAt: "2026-11-24T00:00:00.000Z",
  };
  const mcpUrl = "https://custom.example.test/zentao/mcp";
  const connected = { ...legacy, mcpUrl, status: "connected" as const };
  const approval = Promise.withResolvers<IssueAutomationConnector>();
  const authorizationUrl = "https://custom.example.test/authorize";
  const start = vi.fn((_input: IssueAutomationStartConnectorAuthInput) =>
    Effect.succeed({ authorizationUrl, attemptId: "fixture", automatic: true }),
  );
  const finish = vi.fn((_input: IssueAutomationFinishConnectorAuthInput) =>
    Effect.promise(() => approval.promise),
  );
  using _start = answerRpc(WS_METHODS.issueAutomationStartConnectorAuth, start);
  using _finish = answerRpc(WS_METHODS.issueAutomationFinishConnectorAuth, finish);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const snapshot: IssueAutomationStateSnapshot = {
    platforms: [],
    connectors: [legacy],
    profiles: [],
    tasks: [],
    activeRunCount: 0,
  };
  using _state = answerRpc(WS_METHODS.issueAutomationGetState, () => Effect.succeed(snapshot));
  using _stream = answerRpc(WS_METHODS.issueAutomationSubscribe, () => Stream.make(snapshot));
  const router = getRouter(createMemoryHistory({ initialEntries: ["/issue-automation"] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, {
    // AppRoot mounts the actual routes.
    router: false,
  });
  using openBrowser = vi.spyOn(window, "open").mockReturnValue(null);
  await page.getByRole("button", { name: "Authorize MCP", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit platform connection" });
  const endpoint = page.getByRole("textbox", { name: "MCP service URL" });
  await expect.element(endpoint).toHaveValue("");
  await expect
    .element(page.getByRole("textbox", { name: "Account", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByLabelText("Password or token")).not.toBeInTheDocument();
  await expect
    .element(dialog.getByRole("textbox", { name: "ZenTao web URL (optional)" }))
    .not.toBeInTheDocument();
  await endpoint.fill(mcpUrl);
  const authorize = dialog.getByRole("button", { name: "Authorize MCP" });
  await expect.element(authorize).toBeEnabled();
  await authorize.click();
  await expect.element(page.getByRole("button", { name: "Open sign-in page" })).toBeVisible();
  expect(start).toHaveBeenCalledExactlyOnceWith({
    id: legacy.id,
    platform: legacy.platform,
    name: legacy.name,
    baseUrl: legacy.baseUrl,
    mcpUrl,
    callbackBaseUrl: window.location.origin,
  });
  await dialog.getByRole("button", { name: "Open sign-in page" }).click();
  expect(openBrowser).toHaveBeenCalledExactlyOnceWith(
    authorizationUrl,
    "_blank",
    "noopener,noreferrer",
  );
  await expect
    .element(dialog.getByRole("textbox", { name: "Address of the page your browser opened" }))
    .not.toBeInTheDocument();
  expect(finish).toHaveBeenCalledExactlyOnceWith({ attemptId: "fixture" });
  const revealWindow = vi.fn(async () => {});
  using _desktop = stubGlobal("desktopBridge", { revealWindow });
  approval.resolve(connected);
  await expect.element(dialog).not.toBeInTheDocument();
  expect(revealWindow).toHaveBeenCalledOnce();
});
