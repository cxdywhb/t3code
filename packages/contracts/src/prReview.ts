import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

export const PrReviewPresetId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("PrReviewPresetId"),
);
export type PrReviewPresetId = typeof PrReviewPresetId.Type;

export const PrReviewTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("PrReviewTaskId"),
);
export type PrReviewTaskId = typeof PrReviewTaskId.Type;

export const PrReviewRole = Schema.Literals([
  "comprehensive",
  "correctness",
  "security",
  "performance",
  "architecture",
]);
export type PrReviewRole = typeof PrReviewRole.Type;

export const PrReviewWriteBackMode = Schema.Literals(["manual", "auto_comment", "auto_review"]);
export type PrReviewWriteBackMode = typeof PrReviewWriteBackMode.Type;

export const PrReviewMode = Schema.Literals(["direct_agent", "multi_model_fusion"]);
export type PrReviewMode = typeof PrReviewMode.Type;

export const PrReviewVerdict = Schema.Literals(["approve", "request-changes", "comment"]);
export type PrReviewVerdict = typeof PrReviewVerdict.Type;

export const PrReviewFindingSeverity = Schema.Literals(["blocker", "major", "minor", "nit"]);
export type PrReviewFindingSeverity = typeof PrReviewFindingSeverity.Type;

export const PrReviewStage = Schema.Literals([
  "queued",
  "fetching_context",
  "parallel_reviewing",
  "synthesizing",
  "writing_back",
  "completed",
  "failed",
  "cancelled",
]);
export type PrReviewStage = typeof PrReviewStage.Type;

export const PrReviewModelRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type PrReviewModelRunStatus = typeof PrReviewModelRunStatus.Type;

export const PrReviewSkillDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  displayName: Schema.String,
  description: Schema.String,
  path: TrimmedNonEmptyString,
  source: Schema.Literals(["workspace", "user", "provider"]),
});
export type PrReviewSkillDescriptor = typeof PrReviewSkillDescriptor.Type;

export const PrReviewModelSlot = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  modelSelection: ModelSelection,
  role: PrReviewRole,
  enabled: Schema.Boolean,
});
export type PrReviewModelSlot = typeof PrReviewModelSlot.Type;

export const PrReviewPreset = Schema.Struct({
  id: PrReviewPresetId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  description: Schema.String,
  isDefault: Schema.Boolean,
  reviewerModels: Schema.Array(PrReviewModelSlot).check(Schema.isMaxLength(8)),
  synthesizerModel: Schema.NullOr(ModelSelection),
  boundSkillNames: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(255))).check(
    Schema.isMaxLength(32),
  ),
  customInstructions: Schema.NullOr(Schema.String),
  writeBackMode: PrReviewWriteBackMode,
  updatedAt: IsoDateTime,
});
export type PrReviewPreset = typeof PrReviewPreset.Type;

export const PrReviewFinding = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  severity: PrReviewFindingSeverity,
  title: Schema.String,
  filePath: Schema.NullOr(Schema.String),
  line: Schema.NullOr(PositiveInt),
  description: Schema.String,
  suggestion: Schema.NullOr(Schema.String),
  raisedByModels: Schema.Array(Schema.String),
});
export type PrReviewFinding = typeof PrReviewFinding.Type;

export const PrReviewModelRun = Schema.Struct({
  slotId: TrimmedNonEmptyString,
  role: PrReviewRole,
  modelSelection: ModelSelection,
  modelLabel: Schema.String,
  status: PrReviewModelRunStatus,
  threadId: Schema.NullOr(ThreadId),
  reportMarkdown: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type PrReviewModelRun = typeof PrReviewModelRun.Type;

export const PrReviewStepLog = Schema.Struct({
  at: IsoDateTime,
  stage: PrReviewStage,
  modelLabel: Schema.optionalKey(Schema.String),
  message: Schema.String,
});
export type PrReviewStepLog = typeof PrReviewStepLog.Type;

export const PrReviewTask = Schema.Struct({
  id: PrReviewTaskId,
  presetId: Schema.NullOr(PrReviewPresetId),
  presetName: Schema.NullOr(Schema.String),
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: Schema.String,
  repository: TrimmedNonEmptyString,
  prNumber: PositiveInt,
  prTitle: Schema.String,
  prUrl: Schema.String,
  prAuthor: Schema.NullOr(Schema.String),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  headSha: Schema.NullOr(Schema.String),
  mode: PrReviewMode,
  stage: PrReviewStage,
  boundSkillNames: Schema.Array(Schema.String),
  reviewerRuns: Schema.Array(PrReviewModelRun),
  synthesizerModelLabel: Schema.NullOr(Schema.String),
  synthesisThreadId: Schema.NullOr(ThreadId),
  verdict: Schema.NullOr(PrReviewVerdict),
  summaryMarkdown: Schema.NullOr(Schema.String),
  findings: Schema.Array(PrReviewFinding),
  commentSyncedAt: Schema.NullOr(IsoDateTime),
  reviewSyncedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  steps: Schema.Array(PrReviewStepLog),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type PrReviewTask = typeof PrReviewTask.Type;

export const PrReviewStateSnapshot = Schema.Struct({
  presets: Schema.Array(PrReviewPreset),
  tasks: Schema.Array(PrReviewTask),
  availableSkills: Schema.Array(PrReviewSkillDescriptor),
  activeRunCount: NonNegativeInt,
});
export type PrReviewStateSnapshot = typeof PrReviewStateSnapshot.Type;

export const PrReviewSavePresetInput = Schema.Struct({
  id: Schema.optional(PrReviewPresetId),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  description: Schema.String.check(Schema.isMaxLength(2000)),
  isDefault: Schema.Boolean,
  reviewerModels: Schema.Array(PrReviewModelSlot).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
  synthesizerModel: Schema.NullOr(ModelSelection),
  boundSkillNames: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(255))).check(
    Schema.isMaxLength(32),
  ),
  customInstructions: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16_384))),
  writeBackMode: PrReviewWriteBackMode,
});
export type PrReviewSavePresetInput = typeof PrReviewSavePresetInput.Type;

export const PrReviewDeletePresetInput = Schema.Struct({
  presetId: PrReviewPresetId,
});
export type PrReviewDeletePresetInput = typeof PrReviewDeletePresetInput.Type;

export const PrReviewTargetItem = Schema.Struct({
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: Schema.String,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  author: Schema.optional(Schema.NullOr(Schema.String)),
  headBranch: Schema.optional(Schema.String),
  baseBranch: Schema.optional(Schema.String),
});
export type PrReviewTargetItem = typeof PrReviewTargetItem.Type;

export const PrReviewStartInput = Schema.Struct({
  targets: Schema.Array(PrReviewTargetItem).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  mode: PrReviewMode,
  presetId: Schema.optional(PrReviewPresetId),
  reviewerModels: Schema.optional(
    Schema.Array(PrReviewModelSlot).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  ),
  synthesizerModel: Schema.optional(Schema.NullOr(ModelSelection)),
  boundSkillNames: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(255))).check(
      Schema.isMaxLength(32),
    ),
  ),
  customInstructions: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(16_384))),
  ),
  writeBackMode: Schema.optional(PrReviewWriteBackMode),
});
export type PrReviewStartInput = typeof PrReviewStartInput.Type;

export const PrReviewStartResult = Schema.Struct({
  tasks: Schema.Array(PrReviewTask),
  jumpThreadId: Schema.NullOr(ThreadId),
  jumpProjectId: Schema.NullOr(ProjectId),
});
export type PrReviewStartResult = typeof PrReviewStartResult.Type;

export const PrReviewCancelTaskInput = Schema.Struct({
  taskId: PrReviewTaskId,
});
export type PrReviewCancelTaskInput = typeof PrReviewCancelTaskInput.Type;

export const PrReviewWriteBackInput = Schema.Struct({
  taskId: PrReviewTaskId,
  kind: Schema.Literals(["comment", "review"]),
  verdict: Schema.optional(PrReviewVerdict),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(65_536)),
  inlineFindingIds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(50)),
  ),
});
export type PrReviewWriteBackInput = typeof PrReviewWriteBackInput.Type;

export const PrReviewWriteBackResult = Schema.Struct({
  ok: Schema.Boolean,
  syncedAt: IsoDateTime,
});
export type PrReviewWriteBackResult = typeof PrReviewWriteBackResult.Type;

export class PrReviewError extends Schema.TaggedError<PrReviewError>()(
  "PrReviewError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(PrReviewError)(this, { status: 502 });
  }

  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}
