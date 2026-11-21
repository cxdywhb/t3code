import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_automation_connectors (
      connector_id TEXT PRIMARY KEY NOT NULL,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      account TEXT NOT NULL,
      status TEXT NOT NULL,
      viewer_name TEXT,
      server_version TEXT,
      status_detail TEXT,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_automation_profiles (
      profile_id TEXT PRIMARY KEY NOT NULL,
      connector_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      scope_id TEXT NOT NULL,
      scope_name TEXT NOT NULL,
      repositories_json TEXT NOT NULL,
      models_json TEXT NOT NULL,
      filter_json TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      last_polled_at TEXT,
      last_poll_error TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_issue_automation_profiles_connector
    ON issue_automation_profiles (connector_id, enabled)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_automation_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT,
      connector_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      scope_name TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      display_key TEXT NOT NULL,
      issue_title TEXT NOT NULL,
      issue_url TEXT NOT NULL,
      module_name TEXT,
      severity INTEGER,
      priority INTEGER,
      issue_status TEXT NOT NULL,
      assignee TEXT,
      trigger_kind TEXT NOT NULL,
      action_mode TEXT NOT NULL,
      stage TEXT NOT NULL,
      target_project_id TEXT,
      reference_project_ids_json TEXT NOT NULL DEFAULT '[]',
      primary_thread_id TEXT,
      review_thread_id TEXT,
      assigned_model_label TEXT NOT NULL,
      worktree_branch TEXT,
      diagnosis_report TEXT,
      review_report TEXT,
      comment_synced_at TEXT,
      state_synced_at TEXT,
      remote_updated_marker TEXT,
      last_error TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_issue_automation_tasks_lookup
    ON issue_automation_tasks (connector_id, issue_key, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_issue_automation_tasks_updated
    ON issue_automation_tasks (updated_at DESC)
  `;
});
