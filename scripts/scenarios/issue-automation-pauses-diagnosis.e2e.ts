import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { expect } from "e2e";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

test(
  "Disabling an unattended diagnosis rule cancels the queue and pauses active work",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("diagnosis-demo");
    await runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const at = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
        INSERT INTO issue_automation_connectors (
          connector_id, platform, name, base_url, status, scopes_json, updated_at
        ) VALUES (
          'pause-connector', 'zentao', 'Test ZenTao', 'https://bugs.example.test', 'disconnected',
          '[{"id":"5","name":"Diagnosis demo"}]', ${at}
        )
      `;
        yield* sql`
        INSERT INTO issue_automation_profiles (
          profile_id, connector_id, name, enabled, scope_id, scope_name,
          repositories_json, models_json, filter_json, policy_json, updated_at
        ) VALUES (
          'pause-rule', 'pause-connector', 'Read-only diagnosis', 1, '5', 'Diagnosis demo',
          '{"primaryProjectId":"demo","linkedProjectIds":[],"moduleMappings":[]}',
          '{"primaryModel":{"instanceId":"devReplay","model":"showcase"},"triageModel":null,"highSeverityModel":null,"reviewModel":null,"fallbackModel":null}',
          '{"browseType":"unresolved","onlyUnconfirmed":false,"assignedToAccount":null,"maxSeverity":null,"keyword":null,"pollIntervalMinutes":5,"maxConcurrency":1}',
          '{"actionMode":"diagnose_only","autoWriteComment":false,"baseBranch":null,"customPromptInstructions":null}',
          ${at}
        )
      `;
        const tasks = [
          { key: "51", title: "Diagnosis already started", stage: "enriching" },
          { key: "52", title: "Diagnosis still queued", stage: "queued" },
        ];
        for (const task of tasks) {
          yield* sql`
          INSERT INTO issue_automation_tasks (
            task_id, profile_id, connector_id, platform, scope_id, scope_name, issue_key,
            display_key, issue_title, issue_url, issue_status, trigger_kind, action_mode,
            stage, assigned_model_label, created_at, updated_at
          ) VALUES (
            ${task.key}, 'pause-rule', 'pause-connector', 'zentao', '5', 'Diagnosis demo',
            ${task.key}, ${`#${task.key}`}, ${task.title}, 'https://bugs.example.test', 'active',
            'poll', 'diagnose_only', ${task.stage}, 'devReplay:showcase', ${at}, ${at}
          )
        `;
        }
      }).pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: `${T3_HOME}/userdata/statev2.sqlite` })),
      ),
    );

    await t3.open("/issue-automation");
    await screen.getByRole("button", /^Runs/).tap();
    await expect(screen.getByText("Queued", { exact: true })).toBeVisible();
    await screen.getByRole("button", /^Automation/).tap();
    const polling = screen.getByRole("switch", "Toggle unattended polling for Read-only diagnosis");
    await expect(polling).toHaveAttribute("aria-checked", "true");
    await polling.tap();
    await expect(polling).toHaveAttribute("aria-checked", "false");

    await screen.getByRole("button", /^Runs/).tap();
    await expect(screen.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Failed", { exact: true })).toBeVisible();
    await screen.getByRole("button", /^Paused/).tap();
    await expect(screen.getByText("Diagnosis already started")).toBeVisible();
    await expect(screen.getByText("Diagnosis still queued")).not.toBeVisible();
    await app.screenshot("rule-disabled");
  },
);
