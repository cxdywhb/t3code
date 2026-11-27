import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  IssueAutomationConnector,
  IssueAutomationConnectorId,
  IssueAutomationPlatformKind,
  IssueAutomationProfile,
  IssueAutomationProfileId,
  IssueAutomationRemoteScope,
  IssueAutomationStepLog,
  IssueAutomationTask,
  IssueAutomationTaskId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type PersistenceDecodeError as DecodeErr,
  type PersistenceSqlError as SqlErr,
} from "../persistence/Errors.ts";

export type IssueAutomationRepositoryError = SqlErr | DecodeErr;

const WriteActionsJson = Schema.fromJsonString(IssueAutomationConnector.fields.writeActions);
const decodeWriteActions = Schema.decodeUnknownEffect(WriteActionsJson);
const encodeWriteActions = Schema.encodeEffect(WriteActionsJson);

const ScopesJson = Schema.fromJsonString(Schema.Array(IssueAutomationRemoteScope));
const RepoBindingJson = Schema.fromJsonString(IssueAutomationProfile.fields.repositories);
const ModelStrategyJson = Schema.fromJsonString(IssueAutomationProfile.fields.models);
const FilterJson = Schema.fromJsonString(IssueAutomationProfile.fields.filter);
const PolicyJson = Schema.fromJsonString(IssueAutomationProfile.fields.policy);
const ProjectIdsJson = Schema.fromJsonString(Schema.Array(ProjectId));
const StepsJson = Schema.fromJsonString(Schema.Array(IssueAutomationStepLog));
const encodeStep = Schema.encodeEffect(Schema.fromJsonString(IssueAutomationStepLog));

const decodeScopes = Schema.decodeUnknownEffect(ScopesJson);
const encodeScopes = Schema.encodeEffect(ScopesJson);
const decodeConnector = Schema.decodeUnknownEffect(IssueAutomationConnector);

const decodeRepoBinding = Schema.decodeUnknownEffect(RepoBindingJson);
const encodeRepoBinding = Schema.encodeEffect(RepoBindingJson);
const decodeModelStrategy = Schema.decodeUnknownEffect(ModelStrategyJson);
const encodeModelStrategy = Schema.encodeEffect(ModelStrategyJson);
const decodeFilter = Schema.decodeUnknownEffect(FilterJson);
const encodeFilter = Schema.encodeEffect(FilterJson);
const decodePolicy = Schema.decodeUnknownEffect(PolicyJson);
const encodePolicy = Schema.encodeEffect(PolicyJson);
const decodeProfile = Schema.decodeUnknownEffect(IssueAutomationProfile);

const decodeProjectIds = Schema.decodeUnknownEffect(ProjectIdsJson);
const encodeProjectIds = Schema.encodeEffect(ProjectIdsJson);
const decodeSteps = Schema.decodeUnknownEffect(StepsJson);
const encodeSteps = Schema.encodeEffect(StepsJson);
const decodeTask = Schema.decodeUnknownEffect(IssueAutomationTask);

function toRepoError(sqlOp: string, decodeOp: string) {
  return (cause: unknown): IssueAutomationRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOp, cause)
      : new PersistenceSqlError({ operation: sqlOp, cause });
}

interface ConnectorRow {
  readonly connector_id: string;
  readonly platform: string;
  readonly name: string;
  readonly base_url: string;
  readonly mcp_url: string | null;
  readonly write_actions_json: string;
  readonly status: string;
  readonly viewer_name: string | null;
  readonly server_version: string | null;
  readonly status_detail: string | null;
  readonly scopes_json: string;
  readonly updated_at: string;
}

interface ProfileRow {
  readonly profile_id: string;
  readonly connector_id: string;
  readonly name: string;
  readonly enabled: number;
  readonly scope_id: string;
  readonly scope_name: string;
  readonly repositories_json: string;
  readonly models_json: string;
  readonly filter_json: string;
  readonly policy_json: string;
  readonly feishu_notification_enabled: number;
  readonly feishu_webhook_secret_id: string | null;
  readonly last_polled_at: string | null;
  readonly last_poll_error: string | null;
  readonly updated_at: string;
}

export type StoredProfile = IssueAutomationProfile & {
  readonly feishuWebhookSecretId: string | null;
};

interface TaskRow {
  readonly task_id: string;
  readonly profile_id: string | null;
  readonly connector_id: string;
  readonly platform: string;
  readonly scope_id: string;
  readonly scope_name: string;
  readonly issue_key: string;
  readonly display_key: string;
  readonly issue_title: string;
  readonly issue_url: string;
  readonly module_name: string | null;
  readonly severity: number | null;
  readonly priority: number | null;
  readonly issue_status: string;
  readonly assignee: string | null;
  readonly trigger_kind: string;
  readonly action_mode: string;
  readonly stage: string;
  readonly target_project_id: string | null;
  readonly reference_project_ids_json: string;
  readonly primary_thread_id: string | null;
  readonly review_thread_id: string | null;
  readonly primary_run_id: string | null;
  readonly review_run_id: string | null;
  readonly repair_of_task_id: string | null;
  readonly repair_confirmed_at: string | null;
  readonly assigned_model_label: string;
  readonly worktree_branch: string | null;
  readonly diagnosis_report: string | null;
  readonly review_report: string | null;
  readonly comment_synced_at: string | null;
  readonly state_synced_at: string | null;
  readonly remote_updated_marker: string | null;
  readonly last_error: string | null;
  readonly steps_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

export class IssueAutomationRepository extends Context.Service<
  IssueAutomationRepository,
  {
    readonly listConnectors: Effect.Effect<
      ReadonlyArray<IssueAutomationConnector>,
      IssueAutomationRepositoryError
    >;
    readonly getConnector: (
      id: IssueAutomationConnectorId,
    ) => Effect.Effect<IssueAutomationConnector | undefined, IssueAutomationRepositoryError>;
    readonly upsertConnector: (
      connector: IssueAutomationConnector,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;
    readonly deleteConnector: (
      id: IssueAutomationConnectorId,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;

    readonly listProfiles: Effect.Effect<
      ReadonlyArray<StoredProfile>,
      IssueAutomationRepositoryError
    >;
    readonly getProfile: (
      id: IssueAutomationProfileId,
    ) => Effect.Effect<StoredProfile | undefined, IssueAutomationRepositoryError>;
    readonly upsertProfile: (
      profile: StoredProfile,
      stopAutomaticDiagnosis?: boolean,
    ) => Effect.Effect<ReadonlyArray<IssueAutomationTaskId>, IssueAutomationRepositoryError>;
    readonly listPauseRelatedTasks: Effect.Effect<
      ReadonlyArray<IssueAutomationTask>,
      IssueAutomationRepositoryError
    >;
    readonly hasPendingResume: (
      id: IssueAutomationProfileId,
    ) => Effect.Effect<boolean, IssueAutomationRepositoryError>;
    readonly recordProfilePoll: (
      id: IssueAutomationProfileId,
      at: string,
      error: string | null,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;
    readonly deleteProfile: (
      id: IssueAutomationProfileId,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;

    readonly listTasks: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<IssueAutomationTask>, IssueAutomationRepositoryError>;
    readonly getTask: (
      id: IssueAutomationTaskId,
    ) => Effect.Effect<IssueAutomationTask | undefined, IssueAutomationRepositoryError>;
    readonly listIssueTasks: (
      connectorId: IssueAutomationConnectorId,
      issueKey: string,
    ) => Effect.Effect<ReadonlyArray<IssueAutomationTask>, IssueAutomationRepositoryError>;
    readonly upsertTask: (
      task: IssueAutomationTask,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;
    readonly appendTaskStep: (
      id: IssueAutomationTaskId,
      step: IssueAutomationStepLog,
    ) => Effect.Effect<void, IssueAutomationRepositoryError>;
  }
>()("t3/issueAutomation/IssueAutomationRepository") {}

import { sortZenTaoScopesDesc } from "./connectors/zentao/ZenTaoClient.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rowToConnector = Effect.fn("IssueAutomationRepository.rowToConnector")(function* (
    row: ConnectorRow,
  ) {
    const rawScopes = yield* decodeScopes(row.scopes_json);
    const scopes = sortZenTaoScopesDesc(rawScopes);
    return yield* decodeConnector({
      id: IssueAutomationConnectorId.make(row.connector_id),
      platform: IssueAutomationPlatformKind.make(row.platform),
      name: row.name,
      baseUrl: row.base_url,
      mcpUrl: row.mcp_url,
      writeActions: yield* decodeWriteActions(row.write_actions_json),
      status: row.status,
      viewerName: row.viewer_name,
      serverVersion: row.server_version,
      statusDetail: row.status_detail,
      scopes,
      updatedAt: row.updated_at,
    });
  });

  const rowToProfile = Effect.fn("IssueAutomationRepository.rowToProfile")(function* (
    row: ProfileRow,
  ) {
    const [repositories, models, filter, policy] = yield* Effect.all([
      decodeRepoBinding(row.repositories_json),
      decodeModelStrategy(row.models_json),
      decodeFilter(row.filter_json),
      decodePolicy(row.policy_json),
    ]);
    const profile = yield* decodeProfile({
      id: IssueAutomationProfileId.make(row.profile_id),
      connectorId: IssueAutomationConnectorId.make(row.connector_id),
      name: row.name,
      enabled: row.enabled === 1,
      scopeId: row.scope_id,
      scopeName: row.scope_name,
      repositories,
      models,
      filter,
      policy,
      feishuNotification: {
        enabled: row.feishu_notification_enabled === 1,
        hasWebhook: row.feishu_webhook_secret_id !== null,
      },
      lastPolledAt: row.last_polled_at,
      lastPollError: row.last_poll_error,
      updatedAt: row.updated_at,
    });
    return { ...profile, feishuWebhookSecretId: row.feishu_webhook_secret_id };
  });

  const rowToTask = Effect.fn("IssueAutomationRepository.rowToTask")(function* (row: TaskRow) {
    const [referenceProjectIds, steps] = yield* Effect.all([
      decodeProjectIds(row.reference_project_ids_json),
      decodeSteps(row.steps_json),
    ]);
    return yield* decodeTask({
      id: IssueAutomationTaskId.make(row.task_id),
      profileId: row.profile_id === null ? null : IssueAutomationProfileId.make(row.profile_id),
      connectorId: IssueAutomationConnectorId.make(row.connector_id),
      platform: IssueAutomationPlatformKind.make(row.platform),
      scopeId: row.scope_id,
      scopeName: row.scope_name,
      issueKey: row.issue_key,
      displayKey: row.display_key,
      issueTitle: row.issue_title,
      issueUrl: row.issue_url,
      moduleName: row.module_name,
      severity: row.severity,
      priority: row.priority,
      issueStatus: row.issue_status,
      assignee: row.assignee,
      trigger: row.trigger_kind,
      actionMode: row.action_mode,
      stage: row.stage,
      targetProjectId:
        row.target_project_id === null ? null : ProjectId.make(row.target_project_id),
      referenceProjectIds,
      primaryThreadId: row.primary_thread_id === null ? null : ThreadId.make(row.primary_thread_id),
      reviewThreadId: row.review_thread_id === null ? null : ThreadId.make(row.review_thread_id),
      ...(row.primary_run_id === null ? {} : { primaryRunId: RunId.make(row.primary_run_id) }),
      ...(row.review_run_id === null ? {} : { reviewRunId: RunId.make(row.review_run_id) }),
      ...(row.repair_of_task_id === null
        ? {}
        : { repairOfTaskId: IssueAutomationTaskId.make(row.repair_of_task_id) }),
      ...(row.repair_confirmed_at === null ? {} : { repairConfirmedAt: row.repair_confirmed_at }),
      assignedModelLabel: row.assigned_model_label,
      worktreeBranch: row.worktree_branch,
      diagnosisReport: row.diagnosis_report,
      reviewReport: row.review_report,
      commentSyncedAt: row.comment_synced_at,
      stateSyncedAt: row.state_synced_at,
      remoteUpdatedMarker: row.remote_updated_marker,
      lastError: row.last_error,
      steps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    });
  });

  const listConnectors: IssueAutomationRepository["Service"]["listConnectors"] =
    sql<ConnectorRow>`SELECT * FROM issue_automation_connectors ORDER BY updated_at DESC`.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, rowToConnector)),
      Effect.mapError(toRepoError("listIssueAutomationConnectors", "IssueAutomationConnector")),
    );

  const getConnector: IssueAutomationRepository["Service"]["getConnector"] = Effect.fn(
    "IssueAutomationRepository.getConnector",
  )(
    function* (id) {
      const [row] = yield* sql<ConnectorRow>`
        SELECT * FROM issue_automation_connectors WHERE connector_id = ${id}
      `;
      return row === undefined ? undefined : yield* rowToConnector(row);
    },
    Effect.mapError(toRepoError("getIssueAutomationConnector", "IssueAutomationConnector")),
  );

  const upsertConnector: IssueAutomationRepository["Service"]["upsertConnector"] = Effect.fn(
    "IssueAutomationRepository.upsertConnector",
  )(
    function* (connector) {
      const scopesJson = yield* encodeScopes(connector.scopes);
      const writeActionsJson = yield* encodeWriteActions(connector.writeActions);
      yield* sql`
        INSERT INTO issue_automation_connectors (
          connector_id, platform, name, base_url, mcp_url, write_actions_json, status,
          viewer_name, server_version, status_detail, scopes_json, updated_at
        ) VALUES (
          ${connector.id}, ${connector.platform}, ${connector.name}, ${connector.baseUrl},
          ${connector.mcpUrl}, ${writeActionsJson}, ${connector.status}, ${connector.viewerName},
          ${connector.serverVersion}, ${connector.statusDetail}, ${scopesJson}, ${connector.updatedAt}
        )
        ON CONFLICT (connector_id) DO UPDATE SET
          platform = excluded.platform,
          name = excluded.name,
          base_url = excluded.base_url,
          mcp_url = excluded.mcp_url,
          write_actions_json = excluded.write_actions_json,
          status = excluded.status,
          viewer_name = excluded.viewer_name,
          server_version = excluded.server_version,
          status_detail = excluded.status_detail,
          scopes_json = excluded.scopes_json,
          updated_at = excluded.updated_at
      `;
    },
    Effect.mapError(toRepoError("upsertIssueAutomationConnector", "IssueAutomationConnector")),
  );

  const deleteConnector: IssueAutomationRepository["Service"]["deleteConnector"] = Effect.fn(
    "IssueAutomationRepository.deleteConnector",
  )(
    function* (id) {
      yield* sql`DELETE FROM issue_automation_profiles WHERE connector_id = ${id}`;
      yield* sql`DELETE FROM issue_automation_connectors WHERE connector_id = ${id}`;
    },
    Effect.mapError(toRepoError("deleteIssueAutomationConnector", "IssueAutomationConnector")),
  );

  const listProfiles: IssueAutomationRepository["Service"]["listProfiles"] = sql<ProfileRow>`
    SELECT * FROM issue_automation_profiles ORDER BY updated_at DESC
  `.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, rowToProfile)),
    Effect.mapError(toRepoError("listIssueAutomationProfiles", "IssueAutomationProfile")),
  );

  const getProfile = Effect.fn("IssueAutomationRepository.getProfile")(
    function* (id: IssueAutomationProfileId) {
      const [row] = yield* sql<ProfileRow>`
        SELECT * FROM issue_automation_profiles WHERE profile_id = ${id}
      `;
      return row ? yield* rowToProfile(row) : undefined;
    },
    Effect.mapError(toRepoError("getIssueAutomationProfile", "IssueAutomationProfile")),
  );

  const upsertProfile: IssueAutomationRepository["Service"]["upsertProfile"] = Effect.fn(
    "IssueAutomationRepository.upsertProfile",
  )(
    function* (profile, stopAutomaticDiagnosis) {
      const [reposJson, modelsJson, filterJson, policyJson] = yield* Effect.all([
        encodeRepoBinding(profile.repositories),
        encodeModelStrategy(profile.models),
        encodeFilter(profile.filter),
        encodePolicy(profile.policy),
      ]);
      const save = sql`
        INSERT INTO issue_automation_profiles (
          profile_id, connector_id, name, enabled, scope_id, scope_name,
          repositories_json, models_json, filter_json, policy_json,
          feishu_notification_enabled, feishu_webhook_secret_id,
          last_polled_at, last_poll_error, updated_at
        ) VALUES (
          ${profile.id}, ${profile.connectorId}, ${profile.name}, ${profile.enabled ? 1 : 0},
          ${profile.scopeId}, ${profile.scopeName}, ${reposJson}, ${modelsJson},
          ${filterJson}, ${policyJson}, ${profile.feishuNotification?.enabled ? 1 : 0},
          ${profile.feishuWebhookSecretId}, ${profile.lastPolledAt}, ${profile.lastPollError},
          ${profile.updatedAt}
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          connector_id = excluded.connector_id,
          name = excluded.name,
          enabled = excluded.enabled,
          scope_id = excluded.scope_id,
          scope_name = excluded.scope_name,
          repositories_json = excluded.repositories_json,
          models_json = excluded.models_json,
          filter_json = excluded.filter_json,
          policy_json = excluded.policy_json,
          feishu_notification_enabled = excluded.feishu_notification_enabled,
          feishu_webhook_secret_id = excluded.feishu_webhook_secret_id,
          updated_at = excluded.updated_at
      `;
      if (!stopAutomaticDiagnosis) {
        yield* save;
        return [];
      }

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* save;
          const cancelled = yield* sql<{ task_id: IssueAutomationTaskId; stage: string }>`
            UPDATE issue_automation_tasks
            SET stage = CASE WHEN stage = 'queued' THEN 'cancelled' ELSE 'pausing' END,
                last_error = NULL,
                updated_at = ${profile.updatedAt},
                completed_at = CASE WHEN stage = 'queued' THEN ${profile.updatedAt} ELSE NULL END,
                steps_json = json_insert(steps_json, '$[#]', json_object(
                  'at', ${profile.updatedAt},
                  'stage', CASE WHEN stage = 'queued' THEN 'cancelled' ELSE 'pausing' END,
                  'message', CASE WHEN stage = 'queued' THEN '自动轮询已关闭，已取消排队诊断'
                                  ELSE '自动轮询已关闭，正在暂停诊断' END
                ))
            WHERE profile_id = ${profile.id}
              AND trigger_kind = 'poll'
              AND action_mode = 'diagnose_only'
              AND stage IN ('queued', 'enriching', 'routing', 'diagnosing', 'paused', 'resuming')
            RETURNING task_id, stage
          `;
          return cancelled.filter((row) => row.stage === "cancelled").map((row) => row.task_id);
        }),
      );
    },
    Effect.mapError(toRepoError("upsertIssueAutomationProfile", "IssueAutomationProfile")),
  );

  const recordProfilePoll = Effect.fn("IssueAutomationRepository.recordProfilePoll")(
    function* (id: IssueAutomationProfileId, at: string, error: string | null) {
      yield* sql`
        UPDATE issue_automation_profiles SET last_polled_at = ${at}, last_poll_error = ${error}
        WHERE profile_id = ${id}
      `;
    },
    Effect.mapError(toRepoError("recordIssueAutomationProfilePoll", "IssueAutomationProfile")),
  );

  const appendTaskStep = Effect.fn("IssueAutomationRepository.appendTaskStep")(
    function* (id: IssueAutomationTaskId, step: IssueAutomationStepLog) {
      const stepJson = yield* encodeStep(step);
      yield* sql`
        UPDATE issue_automation_tasks
        SET steps_json = json_insert(steps_json, '$[#]', json(${stepJson}))
        WHERE task_id = ${id}
      `;
    },
    Effect.mapError(toRepoError("appendIssueAutomationTaskStep", "IssueAutomationTask")),
  );

  const deleteProfile: IssueAutomationRepository["Service"]["deleteProfile"] = Effect.fn(
    "IssueAutomationRepository.deleteProfile",
  )(
    function* (id) {
      yield* sql`DELETE FROM issue_automation_profiles WHERE profile_id = ${id}`;
    },
    Effect.mapError(toRepoError("deleteIssueAutomationProfile", "IssueAutomationProfile")),
  );

  const listTasks: IssueAutomationRepository["Service"]["listTasks"] = Effect.fn(
    "IssueAutomationRepository.listTasks",
  )(
    function* (limit = 1000) {
      const rows = yield* sql<TaskRow>`
        SELECT * FROM issue_automation_tasks
        ORDER BY updated_at DESC, rowid DESC
        LIMIT ${limit}
      `;
      return yield* Effect.forEach(rows, rowToTask);
    },
    Effect.mapError(toRepoError("listIssueAutomationTasks", "IssueAutomationTask")),
  );

  const listPauseRelatedTasks = sql<TaskRow>`
    SELECT * FROM issue_automation_tasks
    WHERE stage IN ('pausing', 'paused', 'resuming')
      OR (stage = 'cancelling' AND profile_id IS NOT NULL
          AND trigger_kind = 'poll' AND action_mode = 'diagnose_only')
    ORDER BY created_at, rowid
  `.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, rowToTask)),
    Effect.mapError(toRepoError("listPauseRelatedIssueAutomationTasks", "IssueAutomationTask")),
  );

  const hasPendingResume = Effect.fn("IssueAutomationRepository.hasPendingResume")(
    function* (id: IssueAutomationProfileId) {
      const rows = yield* sql`
        SELECT 1 FROM issue_automation_tasks
        WHERE profile_id = ${id} AND stage IN ('pausing', 'paused') AND last_error IS NULL
        LIMIT 1
      `;
      return rows.length > 0;
    },
    Effect.mapError(toRepoError("hasPendingIssueAutomationResume", "IssueAutomationTask")),
  );

  const getTask = Effect.fn("IssueAutomationRepository.getTask")(
    function* (id: IssueAutomationTaskId) {
      const [row] = yield* sql<TaskRow>`SELECT * FROM issue_automation_tasks WHERE task_id = ${id}`;
      return row ? yield* rowToTask(row) : undefined;
    },
    Effect.mapError(toRepoError("getIssueAutomationTask", "IssueAutomationTask")),
  );

  const listIssueTasks = Effect.fn("IssueAutomationRepository.listIssueTasks")(
    function* (connectorId: IssueAutomationConnectorId, issueKey: string) {
      const rows = yield* sql<TaskRow>`
      SELECT * FROM issue_automation_tasks WHERE connector_id = ${connectorId} AND issue_key = ${issueKey}
      ORDER BY created_at DESC, rowid DESC
    `;
      return yield* Effect.forEach(rows, rowToTask);
    },
    Effect.mapError(toRepoError("listTasksForIssue", "IssueAutomationTask")),
  );

  const upsertTask: IssueAutomationRepository["Service"]["upsertTask"] = Effect.fn(
    "IssueAutomationRepository.upsertTask",
  )(
    function* (task) {
      const [refProjectsJson, stepsJson] = yield* Effect.all([
        encodeProjectIds(task.referenceProjectIds),
        encodeSteps(task.steps),
      ]);
      yield* sql`
        INSERT INTO issue_automation_tasks (
          task_id, profile_id, connector_id, platform, scope_id, scope_name,
          issue_key, display_key, issue_title, issue_url, module_name,
          severity, priority, issue_status, assignee, trigger_kind,
          action_mode, stage, target_project_id, reference_project_ids_json,
          primary_thread_id, review_thread_id, primary_run_id, review_run_id, assigned_model_label, worktree_branch,
          diagnosis_report, review_report, comment_synced_at, state_synced_at,
          remote_updated_marker, last_error, steps_json, created_at, updated_at, completed_at,
          repair_of_task_id, repair_confirmed_at
        ) VALUES (
          ${task.id}, ${task.profileId}, ${task.connectorId}, ${task.platform},
          ${task.scopeId}, ${task.scopeName}, ${task.issueKey}, ${task.displayKey},
          ${task.issueTitle}, ${task.issueUrl}, ${task.moduleName},
          ${task.severity}, ${task.priority}, ${task.issueStatus}, ${task.assignee},
          ${task.trigger}, ${task.actionMode}, ${task.stage}, ${task.targetProjectId},
          ${refProjectsJson}, ${task.primaryThreadId}, ${task.reviewThreadId},
          ${task.primaryRunId ?? null}, ${task.reviewRunId ?? null},
          ${task.assignedModelLabel}, ${task.worktreeBranch}, ${task.diagnosisReport},
          ${task.reviewReport}, ${task.commentSyncedAt}, ${task.stateSyncedAt},
          ${task.remoteUpdatedMarker}, ${task.lastError}, ${stepsJson},
          ${task.createdAt}, ${task.updatedAt}, ${task.completedAt},
          ${task.repairOfTaskId ?? null}, ${task.repairConfirmedAt ?? null}
        )
        ON CONFLICT (task_id) DO UPDATE SET
          profile_id = excluded.profile_id,
          issue_title = excluded.issue_title,
          issue_url = excluded.issue_url,
          module_name = excluded.module_name,
          severity = excluded.severity,
          priority = excluded.priority,
          issue_status = excluded.issue_status,
          assignee = excluded.assignee,
          action_mode = excluded.action_mode,
          stage = excluded.stage,
          target_project_id = excluded.target_project_id,
          reference_project_ids_json = excluded.reference_project_ids_json,
          primary_thread_id = excluded.primary_thread_id,
          review_thread_id = excluded.review_thread_id,
          primary_run_id = excluded.primary_run_id,
          review_run_id = excluded.review_run_id,
          assigned_model_label = excluded.assigned_model_label,
          worktree_branch = excluded.worktree_branch,
          diagnosis_report = excluded.diagnosis_report,
          review_report = excluded.review_report,
          comment_synced_at = excluded.comment_synced_at,
          state_synced_at = excluded.state_synced_at,
          remote_updated_marker = excluded.remote_updated_marker,
          last_error = excluded.last_error,
          repair_confirmed_at = excluded.repair_confirmed_at,
          steps_json = excluded.steps_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `;
    },
    Effect.mapError(toRepoError("upsertIssueAutomationTask", "IssueAutomationTask")),
  );

  return IssueAutomationRepository.of({
    listConnectors,
    getConnector,
    upsertConnector,
    deleteConnector,
    listProfiles,
    getProfile,
    upsertProfile,
    listPauseRelatedTasks,
    hasPendingResume,
    recordProfilePoll,
    deleteProfile,
    listTasks,
    getTask,
    listIssueTasks,
    upsertTask,
    appendTaskStep,
  });
});

export const layer = Layer.effect(IssueAutomationRepository, make);
