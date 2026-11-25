import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE issue_automation_tasks ADD COLUMN repair_of_task_id TEXT`;
  yield* sql`ALTER TABLE issue_automation_tasks ADD COLUMN repair_confirmed_at TEXT`;
});
