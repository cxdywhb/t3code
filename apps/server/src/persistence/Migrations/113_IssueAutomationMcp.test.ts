import { assert, it } from "@effect/vitest";
import { IssueAutomationConnectorId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as IssueAutomationRepository from "../../issueAutomation/IssueAutomationRepository.ts";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("113_IssueAutomationMcp", (it) => {
  it.effect(
    "disconnects a password connection while preserving its identity and product bindings",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 112 });
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
