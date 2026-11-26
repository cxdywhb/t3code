import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing =
    yield* sql`SELECT 1 FROM pragma_table_info('issue_automation_profiles') WHERE name = 'feishu_webhook_secret_id'`;
  if (existing.length > 0) return;
  yield* sql`
    ALTER TABLE issue_automation_profiles
    ADD COLUMN feishu_notification_enabled INTEGER NOT NULL DEFAULT 0
  `;
  yield* sql`
    ALTER TABLE issue_automation_profiles
    ADD COLUMN feishu_webhook_secret_id TEXT
  `;
});
