import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing =
    yield* sql`SELECT 1 FROM pragma_table_info('issue_automation_connectors') WHERE name = 'write_actions_json'`;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE issue_automation_connectors DROP COLUMN account`;
  yield* sql`ALTER TABLE issue_automation_connectors ADD COLUMN mcp_url TEXT`;
  yield* sql`ALTER TABLE issue_automation_connectors ADD COLUMN write_actions_json TEXT NOT NULL DEFAULT '[]'`;
  yield* sql`
    UPDATE issue_automation_connectors
    SET status = 'disconnected', status_detail = NULL, viewer_name = NULL, server_version = NULL
  `;
});
