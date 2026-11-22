import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pr_review_presets (
      preset_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      reviewer_models_json TEXT NOT NULL,
      synthesizer_model_json TEXT,
      bound_skill_names_json TEXT NOT NULL DEFAULT '[]',
      custom_instructions TEXT,
      write_back_mode TEXT NOT NULL DEFAULT 'manual',
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pr_review_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      preset_id TEXT,
      preset_name TEXT,
      provider TEXT NOT NULL,
      host TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_title TEXT NOT NULL,
      repository TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL,
      pr_url TEXT NOT NULL,
      pr_author TEXT,
      head_branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      head_sha TEXT,
      mode TEXT NOT NULL,
      stage TEXT NOT NULL,
      bound_skill_names_json TEXT NOT NULL DEFAULT '[]',
      reviewer_runs_json TEXT NOT NULL DEFAULT '[]',
      synthesizer_model_label TEXT,
      synthesis_thread_id TEXT,
      verdict TEXT,
      summary_markdown TEXT,
      findings_json TEXT NOT NULL DEFAULT '[]',
      comment_synced_at TEXT,
      review_synced_at TEXT,
      last_error TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pr_review_tasks_pr_lookup
    ON pr_review_tasks (host, repository, pr_number, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pr_review_tasks_updated
    ON pr_review_tasks (updated_at DESC)
  `;
});
