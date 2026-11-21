import {
  PrReviewFinding,
  PrReviewModelRun,
  PrReviewModelSlot,
  PrReviewPresetId,
  PrReviewStepLog,
  PrReviewTaskId,
  ProjectId,
  SourceControlProviderKind,
  ThreadId,
  ModelSelection,
  type PrReviewMode,
  type PrReviewPreset,
  type PrReviewStage,
  type PrReviewTask,
  type PrReviewVerdict,
  type PrReviewWriteBackMode,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

const decodeModelSlots = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(PrReviewModelSlot)),
);
const encodeModelSlots = Schema.encodeSync(Schema.fromJsonString(Schema.Array(PrReviewModelSlot)));

const decodeNullableModelSelection = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.NullOr(ModelSelection)),
);
const encodeNullableModelSelection = Schema.encodeSync(
  Schema.fromJsonString(Schema.NullOr(ModelSelection)),
);

const decodeStringArray = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const encodeStringArray = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const decodeModelRuns = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(PrReviewModelRun)),
);
const encodeModelRuns = Schema.encodeSync(Schema.fromJsonString(Schema.Array(PrReviewModelRun)));

const decodeFindings = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(PrReviewFinding)),
);
const encodeFindings = Schema.encodeSync(Schema.fromJsonString(Schema.Array(PrReviewFinding)));

const decodeSteps = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(PrReviewStepLog)),
);
const encodeSteps = Schema.encodeSync(Schema.fromJsonString(Schema.Array(PrReviewStepLog)));

interface PresetRow {
  readonly preset_id: string;
  readonly name: string;
  readonly description: string;
  readonly is_default: number;
  readonly reviewer_models_json: string;
  readonly synthesizer_model_json: string | null;
  readonly bound_skill_names_json: string;
  readonly custom_instructions: string | null;
  readonly write_back_mode: string;
  readonly updated_at: string;
}

interface TaskRow {
  readonly task_id: string;
  readonly preset_id: string | null;
  readonly preset_name: string | null;
  readonly provider: string;
  readonly host: string;
  readonly project_id: string;
  readonly project_title: string;
  readonly repository: string;
  readonly pr_number: number;
  readonly pr_title: string;
  readonly pr_url: string;
  readonly pr_author: string | null;
  readonly head_branch: string;
  readonly base_branch: string;
  readonly head_sha: string | null;
  readonly mode: string;
  readonly stage: string;
  readonly bound_skill_names_json: string;
  readonly reviewer_runs_json: string;
  readonly synthesizer_model_label: string | null;
  readonly synthesis_thread_id: string | null;
  readonly verdict: string | null;
  readonly summary_markdown: string | null;
  readonly findings_json: string;
  readonly comment_synced_at: string | null;
  readonly review_synced_at: string | null;
  readonly last_error: string | null;
  readonly steps_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

function rowToPreset(row: PresetRow): PrReviewPreset | null {
  const reviewerModels = decodeModelSlots(row.reviewer_models_json);
  if (Option.isNone(reviewerModels)) return null;
  const synthesizerModel = row.synthesizer_model_json
    ? Option.getOrElse(decodeNullableModelSelection(row.synthesizer_model_json), () => null)
    : null;
  const boundSkillNames = Option.getOrElse(decodeStringArray(row.bound_skill_names_json), () => []);
  return {
    id: PrReviewPresetId.make(row.preset_id),
    name: row.name,
    description: row.description,
    isDefault: row.is_default === 1,
    reviewerModels: reviewerModels.value,
    synthesizerModel,
    boundSkillNames,
    customInstructions: row.custom_instructions,
    writeBackMode: row.write_back_mode as PrReviewWriteBackMode,
    updatedAt: row.updated_at,
  };
}

function rowToTask(row: TaskRow): PrReviewTask {
  return {
    id: PrReviewTaskId.make(row.task_id),
    presetId: row.preset_id ? PrReviewPresetId.make(row.preset_id) : null,
    presetName: row.preset_name,
    provider: SourceControlProviderKind.make(row.provider),
    host: row.host,
    projectId: ProjectId.make(row.project_id),
    projectTitle: row.project_title,
    repository: row.repository,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    prUrl: row.pr_url,
    prAuthor: row.pr_author,
    headBranch: row.head_branch,
    baseBranch: row.base_branch,
    headSha: row.head_sha,
    mode: row.mode as PrReviewMode,
    stage: row.stage as PrReviewStage,
    boundSkillNames: Option.getOrElse(decodeStringArray(row.bound_skill_names_json), () => []),
    reviewerRuns: Option.getOrElse(decodeModelRuns(row.reviewer_runs_json), () => []),
    synthesizerModelLabel: row.synthesizer_model_label,
    synthesisThreadId: row.synthesis_thread_id ? ThreadId.make(row.synthesis_thread_id) : null,
    verdict: (row.verdict as PrReviewVerdict | null) ?? null,
    summaryMarkdown: row.summary_markdown,
    findings: Option.getOrElse(decodeFindings(row.findings_json), () => []),
    commentSyncedAt: row.comment_synced_at,
    reviewSyncedAt: row.review_synced_at,
    lastError: row.last_error,
    steps: Option.getOrElse(decodeSteps(row.steps_json), () => []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class PrReviewRepository extends Context.Service<
  PrReviewRepository,
  {
    readonly listPresets: Effect.Effect<ReadonlyArray<PrReviewPreset>, SqlError.SqlError>;
    readonly upsertPreset: (preset: PrReviewPreset) => Effect.Effect<void, SqlError.SqlError>;
    readonly deletePreset: (id: PrReviewPresetId) => Effect.Effect<void, SqlError.SqlError>;
    readonly listTasks: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<PrReviewTask>, SqlError.SqlError>;
    readonly getTask: (id: PrReviewTaskId) => Effect.Effect<PrReviewTask | null, SqlError.SqlError>;
    readonly upsertTask: (task: PrReviewTask) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("t3/prReview/PrReviewRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listPresets = sql<PresetRow>`
    SELECT * FROM pr_review_presets ORDER BY is_default DESC, updated_at DESC
  `.pipe(Effect.map((rows) => rows.flatMap((r) => (rowToPreset(r) ? [rowToPreset(r)!] : []))));

  const upsertPreset = Effect.fn("PrReviewRepository.upsertPreset")(function* (
    preset: PrReviewPreset,
  ) {
    if (preset.isDefault) {
      yield* sql`
        UPDATE pr_review_presets SET is_default = 0 WHERE preset_id != ${preset.id}
      `;
    }
    yield* sql`
      INSERT INTO pr_review_presets (
        preset_id, name, description, is_default,
        reviewer_models_json, synthesizer_model_json, bound_skill_names_json,
        custom_instructions, write_back_mode, updated_at
      ) VALUES (
        ${preset.id},
        ${preset.name},
        ${preset.description},
        ${preset.isDefault ? 1 : 0},
        ${encodeModelSlots(preset.reviewerModels)},
        ${encodeNullableModelSelection(preset.synthesizerModel)},
        ${encodeStringArray(preset.boundSkillNames)},
        ${preset.customInstructions},
        ${preset.writeBackMode},
        ${preset.updatedAt}
      )
      ON CONFLICT (preset_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        reviewer_models_json = excluded.reviewer_models_json,
        synthesizer_model_json = excluded.synthesizer_model_json,
        bound_skill_names_json = excluded.bound_skill_names_json,
        custom_instructions = excluded.custom_instructions,
        write_back_mode = excluded.write_back_mode,
        updated_at = excluded.updated_at
    `;
  });

  const deletePreset = (id: PrReviewPresetId) =>
    sql`DELETE FROM pr_review_presets WHERE preset_id = ${id}`.pipe(Effect.asVoid);

  const listTasks = (limit = 200) =>
    sql<TaskRow>`
      SELECT * FROM pr_review_tasks ORDER BY updated_at DESC LIMIT ${limit}
    `.pipe(Effect.map((rows) => rows.map(rowToTask)));

  const getTask = (id: PrReviewTaskId) =>
    sql<TaskRow>`
      SELECT * FROM pr_review_tasks WHERE task_id = ${id} LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] ? rowToTask(rows[0]) : null)));

  const upsertTask = (task: PrReviewTask) =>
    sql`
      INSERT INTO pr_review_tasks (
        task_id, preset_id, preset_name, provider, host,
        project_id, project_title, repository, pr_number, pr_title, pr_url, pr_author,
        head_branch, base_branch, head_sha, mode, stage,
        bound_skill_names_json, reviewer_runs_json, synthesizer_model_label, synthesis_thread_id,
        verdict, summary_markdown, findings_json,
        comment_synced_at, review_synced_at, last_error, steps_json,
        created_at, updated_at, completed_at
      ) VALUES (
        ${task.id},
        ${task.presetId},
        ${task.presetName},
        ${task.provider},
        ${task.host},
        ${task.projectId},
        ${task.projectTitle},
        ${task.repository},
        ${task.prNumber},
        ${task.prTitle},
        ${task.prUrl},
        ${task.prAuthor},
        ${task.headBranch},
        ${task.baseBranch},
        ${task.headSha},
        ${task.mode},
        ${task.stage},
        ${encodeStringArray(task.boundSkillNames)},
        ${encodeModelRuns(task.reviewerRuns)},
        ${task.synthesizerModelLabel},
        ${task.synthesisThreadId},
        ${task.verdict},
        ${task.summaryMarkdown},
        ${encodeFindings(task.findings)},
        ${task.commentSyncedAt},
        ${task.reviewSyncedAt},
        ${task.lastError},
        ${encodeSteps(task.steps)},
        ${task.createdAt},
        ${task.updatedAt},
        ${task.completedAt}
      )
      ON CONFLICT (task_id) DO UPDATE SET
        stage = excluded.stage,
        reviewer_runs_json = excluded.reviewer_runs_json,
        synthesizer_model_label = excluded.synthesizer_model_label,
        synthesis_thread_id = excluded.synthesis_thread_id,
        verdict = excluded.verdict,
        summary_markdown = excluded.summary_markdown,
        findings_json = excluded.findings_json,
        comment_synced_at = excluded.comment_synced_at,
        review_synced_at = excluded.review_synced_at,
        last_error = excluded.last_error,
        steps_json = excluded.steps_json,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `.pipe(Effect.asVoid);

  return PrReviewRepository.of({
    listPresets,
    upsertPreset,
    deletePreset,
    listTasks,
    getTask,
    upsertTask,
  });
});

export const layer = Layer.effect(PrReviewRepository, make);
