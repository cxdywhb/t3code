import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE collaboration_templates (
    id TEXT PRIMARY KEY,
    template_json TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE collaboration_requirements (
    key TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    input_json TEXT NOT NULL
  )`;
});
