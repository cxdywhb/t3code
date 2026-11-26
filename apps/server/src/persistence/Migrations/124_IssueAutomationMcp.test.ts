import { assert, it } from "@effect/vitest";
import { IssueAutomationConnectorId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import * as IssueAutomationRepository from "../../issueAutomation/IssueAutomationRepository.ts";
import { runMigrations } from "../Migrations.ts";

import IssueAutomation from "./119_IssueAutomation.ts";
import PrReviewWorkstation from "./120_PrReviewWorkstation.ts";
import IssueAutomationFeishu from "./121_IssueAutomationFeishu.ts";
import IssueAutomationRunLinks from "./122_IssueAutomationRunLinks.ts";
import IssueAutomationRepair from "./123_IssueAutomationRepair.ts";
import IssueAutomationMcp from "./124_IssueAutomationMcp.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("124_IssueAutomationMcp", (it) => {
  it.effect(
    "disconnects a password connection while preserving its identity and product bindings",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 120 });
        const at = "2026-11-24T00:00:00.000Z";
        yield* sql`
        INSERT INTO issue_automation_connectors (
          connector_id, platform, name, base_url, account, status, scopes_json, updated_at
        ) VALUES (
          'original', 'zentao', 'ZenTao', 'https://zen.example.test', 'legacy-account', 'connected',
          '[{"id":"2","name":"App"}]', ${at}
        )
      `;
        yield* sql`
        INSERT INTO issue_automation_profiles (
          profile_id, connector_id, name, scope_id, scope_name, repositories_json, models_json,
          filter_json, policy_json, updated_at
        ) VALUES ('rule', 'original', 'Rule', '2', 'App', '{}', '{}', '{}', '{}', ${at})
      `;
        yield* runMigrations();
        assert.deepEqual(yield* runMigrations(), []);
        const repository = yield* IssueAutomationRepository.IssueAutomationRepository.pipe(
          Effect.provide(IssueAutomationRepository.layer),
        );
        const connection = yield* repository.getConnector(
          IssueAutomationConnectorId.make("original"),
        );
        assert.equal(connection?.status, "disconnected");
        assert.equal(connection?.mcpUrl, null);
        assert.deepEqual(connection?.writeActions, []);
        assert.deepEqual(connection?.scopes, [{ id: "2", name: "App" }]);
        assert.deepEqual(
          yield* sql`SELECT connector_id, scope_id FROM issue_automation_profiles WHERE profile_id = 'rule'`,
          [{ connector_id: "original", scope_id: "2" }],
        );
      }),
  );
});

it.effect("preserves an authorized connection when upgrading the PR draft database", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 107 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "108_IssueAutomation": IssueAutomation,
        "109_PrReviewWorkstation": PrReviewWorkstation,
        "110_IssueAutomationFeishu": IssueAutomationFeishu,
        "111_IssueAutomationRunLinks": IssueAutomationRunLinks,
        "112_IssueAutomationRepair": IssueAutomationRepair,
        "113_IssueAutomationMcp": IssueAutomationMcp,
      }),
    });
    yield* sql`INSERT INTO issue_automation_connectors
      (connector_id,platform,name,base_url,mcp_url,status,updated_at)
      VALUES ('draft','zentao','Draft','','https://example.test/mcp','connected','2026-11-26')`;
    yield* runMigrations();
    assert.deepEqual(
      yield* sql`SELECT status,mcp_url FROM issue_automation_connectors WHERE connector_id='draft'`,
      [{ status: "connected", mcp_url: "https://example.test/mcp" }],
    );
    assert.deepEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
