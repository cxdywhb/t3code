import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing =
    yield* sql`SELECT 1 FROM pragma_table_info('issue_automation_tasks') WHERE name = 'repair_confirmed_at'`;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE issue_automation_tasks ADD COLUMN repair_of_task_id TEXT`;
  yield* sql`ALTER TABLE issue_automation_tasks ADD COLUMN repair_confirmed_at TEXT`;
});
