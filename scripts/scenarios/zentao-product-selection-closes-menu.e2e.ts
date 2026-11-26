import { IssueAutomationConnectorId, WS_METHODS } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";

import { T3_HOME } from "../e2e.config.ts";
import { rpcClient, runPromise, test, WEB } from "./t3.ts";

test(
  "Selecting a ZenTao product closes the unattended rule menu",
  WEB,
  async ({ t3, app, screen }) => {
    const connectorId = IssueAutomationConnectorId.make("fake-zentao-product-menu");
    const scopes = Array.from({ length: 7 }, (_, index) => ({
      id: String(index + 1),
      name: `Test product ${index + 1}`,
    }));
    const scopesJson = JSON.stringify(scopes);
    const mcpUrl = "https://127.0.0.1:1/mcp";
    const fixtureCredential = JSON.stringify({
      mcpUrl,
      client: { client_id: "fixture" },
      tokens: { access_token: "fixture", token_type: "Bearer" },
    });

    await t3.project("demo");
    await t3.project("target-repo");
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, app.baseUrl ?? "");
        yield* Effect.acquireRelease(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const fs = yield* FileSystem.FileSystem;
            yield* fs.writeFileString(
              `${T3_HOME}/userdata/secrets/issue-automation-connector-${connectorId}-oauth.bin`,
              fixtureCredential,
            );
            yield* sql`
              INSERT INTO issue_automation_connectors (
                connector_id, platform, name, base_url, mcp_url, status, scopes_json, updated_at
              ) VALUES (
                ${connectorId}, 'zentao', 'Test ZenTao', 'https://bugs.example.test',
                ${mcpUrl}, 'connected', ${scopesJson}, '2026-11-24T00:00:00Z'
              )
            `;
          }).pipe(
            Effect.provide(
              NodeSqliteClient.layer({ filename: `${T3_HOME}/userdata/statev2.sqlite` }),
            ),
          ),
          () =>
            client[WS_METHODS.issueAutomationDeleteConnector]({ connectorId }).pipe(
              Effect.ignore({ log: true }),
            ),
        );

        yield* Effect.promise(async () => {
          await t3.open("/issue-automation");
          const filter = screen.getByRole("button", "Filter issues");
          await filter.tap();
          await screen.getByRole("menuitemradio", "Assigned to me").tap();
          await expect(filter).toContainText("Assigned to me");
          await expect(filter).toHaveAttribute("aria-expanded", "false");

          const repository = screen.getByRole("button", "Default target repository");
          await repository.tap();
          await screen.getByRole("menuitemradio", "target-repo", { exact: true }).tap();
          await expect(repository).toContainText("target-repo");
          await expect(repository).toHaveAttribute("aria-expanded", "false");

          await screen.getByRole("button", "Unattended rule", { exact: true }).tap();
          const ruleName = screen.getByPlaceholder("Auto-diagnosis rule");
          await ruleName.fill("Custom rule");
          const trigger = screen.getByRole("button", "Select ZenTao product", { exact: true });
          await trigger.tap();
          const outsideRule = { x: 8, y: 200 };
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
          await screen.tapAt(outsideRule);
          await expect(ruleName).toHaveValue("Custom rule");
          await expect(trigger).toHaveAttribute("aria-expanded", "false");
          await trigger.tap();
          await screen.getByRole("textbox", "Search products").fill("Test product 2");
          await screen.getByRole("menuitemradio", /Test product 2/).tap();

          await expect.soft(trigger).toContainText("#2 · Test product 2");
          await expect.soft(trigger).toHaveAttribute("aria-expanded", "false");
          await expect(ruleName).toHaveValue("Test product 2");
          await app.screenshot("zentao-product-selected");
          await ruleName.fill("Custom product 2 rule");
          const scope = screen.getByRole("combobox", "Scope", { exact: true });
          await scope.tap();
          await expect(scope).toHaveAttribute("aria-expanded", "true");
          await screen.tapAt(outsideRule);
          await expect(scope).toHaveAttribute("aria-expanded", "false");
          await expect(ruleName).toHaveValue("Custom product 2 rule");
          await screen.tapAt(outsideRule);
          await expect(ruleName).not.toBeVisible();
        });
      }).pipe(Effect.scoped),
    );
  },
);
