import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * Pluggable enterprise issue platform kind. `zentao` ships active first; `jira` and future
 * connectors share the exact same contract and automation engine without changing core schemas.
 */
export const IssueAutomationPlatformKind = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("IssueAutomationPlatformKind"));
export type IssueAutomationPlatformKind = typeof IssueAutomationPlatformKind.Type;

export const IssueAutomationConnectorId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("IssueAutomationConnectorId"),
);
export type IssueAutomationConnectorId = typeof IssueAutomationConnectorId.Type;

export const IssueAutomationProfileId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("IssueAutomationProfileId"),
);
export type IssueAutomationProfileId = typeof IssueAutomationProfileId.Type;

export const IssueAutomationTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("IssueAutomationTaskId"),
);
export type IssueAutomationTaskId = typeof IssueAutomationTaskId.Type;

export const IssueAutomationAuthFieldKind = Schema.Literals(["url", "text", "password"]);
export type IssueAutomationAuthFieldKind = typeof IssueAutomationAuthFieldKind.Type;

export const IssueAutomationAuthFieldDescriptor = Schema.Struct({
  key: Schema.Literals(["mcpUrl", "baseUrl", "account", "secret"]),
  label: TrimmedNonEmptyString,
  placeholder: Schema.String,
  kind: IssueAutomationAuthFieldKind,
  required: Schema.Boolean,
});
export type IssueAutomationAuthFieldDescriptor = typeof IssueAutomationAuthFieldDescriptor.Type;

/** Static metadata advertised by each registered platform plugin in the server's plugin registry. */
export const IssueAutomationPlatformDescriptor = Schema.Struct({
  platform: IssueAutomationPlatformKind,
  displayName: TrimmedNonEmptyString,
  description: Schema.String,
  implemented: Schema.Boolean,
  scopeNoun: TrimmedNonEmptyString,
  issueNoun: TrimmedNonEmptyString,
  authFields: Schema.Array(IssueAutomationAuthFieldDescriptor),
});
export type IssueAutomationPlatformDescriptor = typeof IssueAutomationPlatformDescriptor.Type;

export const IssueAutomationModuleItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type IssueAutomationModuleItem = typeof IssueAutomationModuleItem.Type;

export const IssueAutomationRemoteScope = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  modules: Schema.optionalKey(Schema.Array(IssueAutomationModuleItem)),
});
export type IssueAutomationRemoteScope = typeof IssueAutomationRemoteScope.Type;

export const IssueAutomationConnectionStatus = Schema.Literals([
  "connected",
  "error",
  "disconnected",
]);
export type IssueAutomationConnectionStatus = typeof IssueAutomationConnectionStatus.Type;

export const IssueAutomationWriteKind = Schema.Literals([
  "comment",
  "confirm",
  "resolve",
  "close",
  "activate",
  "create",
]);
export type IssueAutomationWriteKind = typeof IssueAutomationWriteKind.Type;

/** Persisted platform connection metadata. OAuth credentials are stored separately on the server. */
export const IssueAutomationConnector = Schema.Struct({
  id: IssueAutomationConnectorId,
  platform: IssueAutomationPlatformKind,
  name: TrimmedNonEmptyString,
  baseUrl: Schema.String,
  mcpUrl: Schema.NullOr(Schema.String),
  writeActions: Schema.Array(IssueAutomationWriteKind),
  status: IssueAutomationConnectionStatus,
  viewerName: Schema.NullOr(Schema.String),
  serverVersion: Schema.NullOr(Schema.String),
  statusDetail: Schema.NullOr(Schema.String),
  scopes: Schema.Array(IssueAutomationRemoteScope),
  updatedAt: IsoDateTime,
});
export type IssueAutomationConnector = typeof IssueAutomationConnector.Type;

/** Maps a remote module name or issue title keyword to one specific local repository. */
export const IssueAutomationModuleRepoMapping = Schema.Struct({
  pattern: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  projectId: ProjectId,
});
export type IssueAutomationModuleRepoMapping = typeof IssueAutomationModuleRepoMapping.Type;

/** Associates 1 remote platform project/product with N local codebases. */
export const IssueAutomationRepoBinding = Schema.Struct({
  primaryProjectId: ProjectId,
  linkedProjectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(50)),
  moduleMappings: Schema.Array(IssueAutomationModuleRepoMapping).check(Schema.isMaxLength(100)),
});
export type IssueAutomationRepoBinding = typeof IssueAutomationRepoBinding.Type;

/** Multi-model orchestration strategy using any local providers registered in T3 Code. */
export const IssueAutomationModelStrategy = Schema.Struct({
  triageModel: Schema.NullOr(ModelSelection),
  primaryModel: ModelSelection,
  highSeverityModel: Schema.NullOr(ModelSelection),
  reviewModel: Schema.NullOr(ModelSelection),
  fallbackModel: Schema.NullOr(ModelSelection),
});
export type IssueAutomationModelStrategy = typeof IssueAutomationModelStrategy.Type;

export const IssueAutomationBrowseFilter = Schema.Literals([
  "unresolved",
  "unclosed",
  "assigntome",
  "openedbyme",
  "all",
]);
export type IssueAutomationBrowseFilter = typeof IssueAutomationBrowseFilter.Type;

export const IssueAutomationIssueFilter = Schema.Struct({
  browseType: IssueAutomationBrowseFilter,
  onlyUnconfirmed: Schema.Boolean,
  assignedToAccount: Schema.NullOr(Schema.String),
  maxSeverity: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))),
  keyword: Schema.NullOr(Schema.String),
  pollIntervalMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 })),
  maxConcurrency: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
});
export type IssueAutomationIssueFilter = typeof IssueAutomationIssueFilter.Type;

export const IssueAutomationActionMode = Schema.Literals([
  "diagnose_only",
  "fix_worktree_review",
  "auto_resolve",
]);
export type IssueAutomationActionMode = typeof IssueAutomationActionMode.Type;

export const IssueAutomationPolicy = Schema.Struct({
  actionMode: IssueAutomationActionMode,
  autoWriteComment: Schema.Boolean,
  baseBranch: Schema.NullOr(Schema.String),
  customPromptInstructions: Schema.NullOr(Schema.String),
});
export type IssueAutomationPolicy = typeof IssueAutomationPolicy.Type;

/** An unattended automation rule binding a remote project/product to local repos & models. */
export const IssueAutomationProfile = Schema.Struct({
  id: IssueAutomationProfileId,
  connectorId: IssueAutomationConnectorId,
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  scopeId: TrimmedNonEmptyString,
  scopeName: TrimmedNonEmptyString,
  repositories: IssueAutomationRepoBinding,
  models: IssueAutomationModelStrategy,
  filter: IssueAutomationIssueFilter,
  policy: IssueAutomationPolicy,
  feishuNotification: Schema.optionalKey(
    Schema.Struct({ enabled: Schema.Boolean, hasWebhook: Schema.Boolean }),
  ),
  lastPolledAt: Schema.NullOr(IsoDateTime),
  lastPollError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type IssueAutomationProfile = typeof IssueAutomationProfile.Type;

export const IssueAutomationStage = Schema.Literals([
  "queued",
  "enriching",
  "routing",
  "diagnosing",
  "reviewing",
  "writing_back",
  "cancelling",
  "pausing",
  "paused",
  "resuming",
  "completed",
  "needs_human",
  "failed",
  "cancelled",
]);
export type IssueAutomationStage = typeof IssueAutomationStage.Type;

export const IssueAutomationStepLog = Schema.Struct({
  at: IsoDateTime,
  stage: IssueAutomationStage,
  modelLabel: Schema.optionalKey(Schema.String),
  message: Schema.String,
});
export type IssueAutomationStepLog = typeof IssueAutomationStepLog.Type;

/** Durable execution record of an automated diagnosis/resolution run for one issue. */
export const IssueAutomationTask = Schema.Struct({
  id: IssueAutomationTaskId,
  profileId: Schema.NullOr(IssueAutomationProfileId),
  connectorId: IssueAutomationConnectorId,
  platform: IssueAutomationPlatformKind,
  scopeId: TrimmedNonEmptyString,
  scopeName: Schema.String,
  issueKey: TrimmedNonEmptyString,
  displayKey: TrimmedNonEmptyString,
  issueTitle: Schema.String,
  issueUrl: Schema.String,
  moduleName: Schema.NullOr(Schema.String),
  severity: Schema.NullOr(Schema.Int),
  priority: Schema.NullOr(Schema.Int),
  issueStatus: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  trigger: Schema.Literals(["poll", "manual"]),
  actionMode: IssueAutomationActionMode,
  stage: IssueAutomationStage,
  targetProjectId: Schema.NullOr(ProjectId),
  referenceProjectIds: Schema.Array(ProjectId),
  primaryThreadId: Schema.NullOr(ThreadId),
  reviewThreadId: Schema.NullOr(ThreadId),
  primaryRunId: Schema.optionalKey(RunId),
  reviewRunId: Schema.optionalKey(RunId),
  repairOfTaskId: Schema.optionalKey(IssueAutomationTaskId),
  repairConfirmedAt: Schema.optionalKey(IsoDateTime),
  assignedModelLabel: Schema.String,
  worktreeBranch: Schema.NullOr(Schema.String),
  diagnosisReport: Schema.NullOr(Schema.String),
  reviewReport: Schema.NullOr(Schema.String),
  commentSyncedAt: Schema.NullOr(IsoDateTime),
  stateSyncedAt: Schema.NullOr(IsoDateTime),
  remoteUpdatedMarker: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  steps: Schema.Array(IssueAutomationStepLog),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type IssueAutomationTask = typeof IssueAutomationTask.Type;

/** One row returned when browsing a remote project's issues in the automation workbench. */
export const IssueAutomationRemoteIssue = Schema.Struct({
  connectorId: IssueAutomationConnectorId,
  platform: IssueAutomationPlatformKind,
  scopeId: TrimmedNonEmptyString,
  scopeName: Schema.String,
  key: TrimmedNonEmptyString,
  displayKey: TrimmedNonEmptyString,
  title: Schema.String,
  url: Schema.String,
  moduleId: Schema.NullOr(Schema.String),
  moduleName: Schema.NullOr(Schema.String),
  severity: Schema.NullOr(Schema.Int),
  priority: Schema.NullOr(Schema.Int),
  status: Schema.String,
  statusLabel: Schema.String,
  confirmed: Schema.Boolean,
  author: Schema.NullOr(Schema.String),
  assignee: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  latestTaskId: Schema.NullOr(IssueAutomationTaskId),
  latestStage: Schema.NullOr(IssueAutomationStage),
});
export type IssueAutomationRemoteIssue = typeof IssueAutomationRemoteIssue.Type;

export const IssueAutomationRemoteComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  actor: Schema.String,
  action: Schema.String,
  createdAt: Schema.String,
  body: Schema.String,
});
export type IssueAutomationRemoteComment = typeof IssueAutomationRemoteComment.Type;

export const IssueAutomationRemoteIssueDetail = Schema.Struct({
  ...IssueAutomationRemoteIssue.fields,
  stepsHtml: Schema.String,
  stepsMarkdown: Schema.String,
  imageUrls: Schema.Array(Schema.String),
  openedBuild: Schema.String,
  availableBuilds: Schema.Array(Schema.Struct({ id: TrimmedNonEmptyString, name: Schema.String })),
  availableUsers: Schema.Array(
    Schema.Struct({ account: TrimmedNonEmptyString, name: Schema.String }),
  ),
  comments: Schema.Array(IssueAutomationRemoteComment),
});
export type IssueAutomationRemoteIssueDetail = typeof IssueAutomationRemoteIssueDetail.Type;

export const IssueAutomationStateSnapshot = Schema.Struct({
  platforms: Schema.Array(IssueAutomationPlatformDescriptor),
  connectors: Schema.Array(IssueAutomationConnector),
  profiles: Schema.Array(IssueAutomationProfile),
  tasks: Schema.Array(IssueAutomationTask),
  activeRunCount: NonNegativeInt,
});
export type IssueAutomationStateSnapshot = typeof IssueAutomationStateSnapshot.Type;

export const ISSUE_AUTOMATION_OAUTH_CALLBACK_PATH = "/oauth/issue-automation/callback";

export const IssueAutomationStartConnectorAuthInput = Schema.Struct({
  id: Schema.optional(IssueAutomationConnectorId),
  platform: IssueAutomationPlatformKind,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  mcpUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  baseUrl: Schema.String.check(Schema.isMaxLength(1024)),
  callbackBaseUrl: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2048))),
});
export type IssueAutomationStartConnectorAuthInput =
  typeof IssueAutomationStartConnectorAuthInput.Type;

export const IssueAutomationStartConnectorAuthResult = Schema.Struct({
  authorizationUrl: TrimmedNonEmptyString,
  attemptId: TrimmedNonEmptyString,
  automatic: Schema.optionalKey(Schema.Boolean),
});
export type IssueAutomationStartConnectorAuthResult =
  typeof IssueAutomationStartConnectorAuthResult.Type;

export const IssueAutomationFinishConnectorAuthInput = Schema.Struct({
  attemptId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  callbackUrl: Schema.optionalKey(
    Schema.RedactedFromValue(TrimmedNonEmptyString.check(Schema.isMaxLength(16_384))),
  ),
});
export type IssueAutomationFinishConnectorAuthInput =
  typeof IssueAutomationFinishConnectorAuthInput.Type;

export const IssueAutomationDeleteConnectorInput = Schema.Struct({
  connectorId: IssueAutomationConnectorId,
});
export type IssueAutomationDeleteConnectorInput = typeof IssueAutomationDeleteConnectorInput.Type;

export const IssueAutomationRefreshScopesInput = Schema.Struct({
  connectorId: IssueAutomationConnectorId,
});
export type IssueAutomationRefreshScopesInput = typeof IssueAutomationRefreshScopesInput.Type;

export const IssueAutomationPauseStagesInput = Schema.Struct({
  supportsPauseStages: Schema.optionalKey(Schema.Boolean),
});

export const IssueAutomationListRemoteIssuesInput = Schema.Struct({
  ...IssueAutomationPauseStagesInput.fields,
  connectorId: IssueAutomationConnectorId,
  scopeId: TrimmedNonEmptyString,
  browseType: Schema.optional(IssueAutomationBrowseFilter),
  keyword: Schema.optional(Schema.String),
  page: Schema.optional(PositiveInt),
  pageSize: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type IssueAutomationListRemoteIssuesInput = typeof IssueAutomationListRemoteIssuesInput.Type;

export const IssueAutomationListRemoteIssuesResult = Schema.Struct({
  issues: Schema.Array(IssueAutomationRemoteIssue),
  total: NonNegativeInt,
  page: PositiveInt,
  pageSize: PositiveInt,
});
export type IssueAutomationListRemoteIssuesResult =
  typeof IssueAutomationListRemoteIssuesResult.Type;

export const IssueAutomationScanProfileIssuesInput = Schema.Struct({
  ...IssueAutomationPauseStagesInput.fields,
  profileId: IssueAutomationProfileId,
  page: Schema.optional(PositiveInt),
});
export type IssueAutomationScanProfileIssuesInput =
  typeof IssueAutomationScanProfileIssuesInput.Type;

export const IssueAutomationScanProfileIssuesResult = Schema.Struct({
  issues: Schema.Array(IssueAutomationRemoteIssue),
  hasNextPage: Schema.Boolean,
});
export type IssueAutomationScanProfileIssuesResult =
  typeof IssueAutomationScanProfileIssuesResult.Type;

export const IssueAutomationGetRemoteIssueDetailInput = Schema.Struct({
  ...IssueAutomationPauseStagesInput.fields,
  connectorId: IssueAutomationConnectorId,
  scopeId: TrimmedNonEmptyString,
  issueKey: TrimmedNonEmptyString,
});
export type IssueAutomationGetRemoteIssueDetailInput =
  typeof IssueAutomationGetRemoteIssueDetailInput.Type;

export const IssueAutomationSaveProfileInput = Schema.Struct({
  id: Schema.optional(IssueAutomationProfileId),
  connectorId: IssueAutomationConnectorId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  enabled: Schema.Boolean,
  scopeId: TrimmedNonEmptyString,
  scopeName: TrimmedNonEmptyString,
  repositories: IssueAutomationRepoBinding,
  models: IssueAutomationModelStrategy,
  filter: IssueAutomationIssueFilter,
  policy: IssueAutomationPolicy,
  feishuNotification: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.Boolean,
      webhook: Schema.optionalKey(Schema.RedactedFromValue(Schema.String)),
    }),
  ),
});
export type IssueAutomationSaveProfileInput = typeof IssueAutomationSaveProfileInput.Type;

export const isIssueAutomationFeishuWebhook = (url: string): boolean =>
  /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_-]+$/.test(url) &&
  url.length <= 512;

export const IssueAutomationDeleteProfileInput = Schema.Struct({
  profileId: IssueAutomationProfileId,
});
export type IssueAutomationDeleteProfileInput = typeof IssueAutomationDeleteProfileInput.Type;

export const IssueAutomationSetProfileEnabledInput = Schema.Struct({
  profileId: IssueAutomationProfileId,
  enabled: Schema.Boolean,
});
export type IssueAutomationSetProfileEnabledInput =
  typeof IssueAutomationSetProfileEnabledInput.Type;

export const IssueAutomationTriggerPollInput = Schema.Struct({
  profileId: IssueAutomationProfileId,
});
export type IssueAutomationTriggerPollInput = typeof IssueAutomationTriggerPollInput.Type;

export const IssueAutomationTriggerPollResult = Schema.Struct({
  enqueuedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
});
export type IssueAutomationTriggerPollResult = typeof IssueAutomationTriggerPollResult.Type;

export const IssueAutomationAnalyzeIssuesInput = Schema.Struct({
  connectorId: IssueAutomationConnectorId,
  scopeId: TrimmedNonEmptyString,
  scopeName: Schema.String,
  issueKeys: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(30),
  ),
  profileId: Schema.optional(IssueAutomationProfileId),
  overrideRepositories: Schema.optional(IssueAutomationRepoBinding),
  overrideModels: Schema.optional(IssueAutomationModelStrategy),
  overridePolicy: Schema.optional(IssueAutomationPolicy),
  retryTaskId: Schema.optionalKey(IssueAutomationTaskId),
  repairFromTaskId: Schema.optionalKey(IssueAutomationTaskId),
});
export type IssueAutomationAnalyzeIssuesInput = typeof IssueAutomationAnalyzeIssuesInput.Type;

export const IssueAutomationAnalyzeIssuesResult = Schema.Struct({
  tasks: Schema.Array(IssueAutomationTask),
});
export type IssueAutomationAnalyzeIssuesResult = typeof IssueAutomationAnalyzeIssuesResult.Type;

export const IssueAutomationCancelTaskInput = Schema.Struct({
  taskId: IssueAutomationTaskId,
});
export type IssueAutomationCancelTaskInput = typeof IssueAutomationCancelTaskInput.Type;

export const IssueAutomationConfirmRepairInput = Schema.Struct({
  taskId: IssueAutomationTaskId,
});
export type IssueAutomationConfirmRepairInput = typeof IssueAutomationConfirmRepairInput.Type;

export const IssueAutomationSyncRepairAction = Schema.Struct({
  kind: Schema.Literal("sync_repair"),
  taskId: IssueAutomationTaskId,
  writeComment: Schema.Boolean,
  resolvedBuild: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
});
export type IssueAutomationSyncRepairAction = typeof IssueAutomationSyncRepairAction.Type;

export const IssueAutomationWriteBackAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("comment"),
    issueKey: TrimmedNonEmptyString,
    comment: TrimmedNonEmptyString.check(Schema.isMaxLength(65_536)),
    taskId: Schema.optional(IssueAutomationTaskId),
  }),
  Schema.Struct({
    kind: Schema.Literal("confirm"),
    issueKey: TrimmedNonEmptyString,
    assignedTo: Schema.optional(Schema.String),
    comment: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
    taskId: Schema.optional(IssueAutomationTaskId),
  }),
  Schema.Struct({
    kind: Schema.Literal("resolve"),
    issueKey: TrimmedNonEmptyString,
    resolution: Schema.Literals([
      "fixed",
      "bydesign",
      "duplicate",
      "external",
      "notrepro",
      "postponed",
      "willnotfix",
    ]),
    resolvedBuild: Schema.optional(Schema.String),
    assignedTo: Schema.optional(Schema.String),
    comment: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
    taskId: Schema.optional(IssueAutomationTaskId),
  }),
  Schema.Struct({
    kind: Schema.Literal("close"),
    issueKey: TrimmedNonEmptyString,
    comment: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
    taskId: Schema.optional(IssueAutomationTaskId),
  }),
  Schema.Struct({
    kind: Schema.Literal("activate"),
    issueKey: TrimmedNonEmptyString,
    assignedTo: Schema.optional(Schema.String),
    comment: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
    taskId: Schema.optional(IssueAutomationTaskId),
  }),
  Schema.Struct({
    kind: Schema.Literal("create"),
    scopeId: TrimmedNonEmptyString,
    moduleId: Schema.optional(Schema.String),
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    steps: Schema.String.check(Schema.isMaxLength(65_536)),
    severity: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
    priority: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
    assignedTo: Schema.optional(Schema.String),
    openedBuild: Schema.optional(Schema.String),
  }),
]);
export type IssueAutomationWriteBackAction = typeof IssueAutomationWriteBackAction.Type;

export const IssueAutomationWriteBackInput = Schema.Struct({
  connectorId: IssueAutomationConnectorId,
  action: Schema.Union([IssueAutomationWriteBackAction, IssueAutomationSyncRepairAction]),
});
export type IssueAutomationWriteBackInput = typeof IssueAutomationWriteBackInput.Type;

export const IssueAutomationWriteBackResult = Schema.Struct({
  ok: Schema.Boolean,
  createdIssueKey: Schema.optionalKey(TrimmedNonEmptyString),
  createdIssueUrl: Schema.optionalKey(Schema.String),
});
export type IssueAutomationWriteBackResult = typeof IssueAutomationWriteBackResult.Type;

export class IssueAutomationError extends Schema.TaggedError<IssueAutomationError>()(
  "IssueAutomationError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(IssueAutomationError)(this, { status: 502 });
  }

  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}
