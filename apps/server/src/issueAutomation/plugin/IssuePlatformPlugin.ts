import type * as Effect from "effect/Effect";
import type {
  IssueAutomationBrowseFilter,
  IssueAutomationError,
  IssueAutomationPlatformDescriptor,
  IssueAutomationPlatformKind,
  IssueAutomationRemoteComment,
  IssueAutomationRemoteScope,
  IssueAutomationWriteBackAction,
  IssueAutomationWriteBackResult,
} from "@t3tools/contracts";

export interface PlatformCredentials {
  readonly baseUrl: string;
  readonly account: string;
  readonly secret: string;
}

export interface PlatformProbeResult {
  readonly normalizedBaseUrl: string;
  readonly viewerName: string;
  readonly serverVersion: string | null;
  readonly scopes: ReadonlyArray<IssueAutomationRemoteScope>;
}

export interface PlatformIssueSummary {
  readonly key: string;
  readonly displayKey: string;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly title: string;
  readonly url: string;
  readonly moduleId: string | null;
  readonly moduleName: string | null;
  readonly severity: number | null;
  readonly priority: number | null;
  readonly status: string;
  readonly statusLabel: string;
  readonly confirmed: boolean;
  readonly author: string | null;
  readonly assignee: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlatformIssuePage {
  readonly items: ReadonlyArray<PlatformIssueSummary>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface PlatformIssueDetail extends PlatformIssueSummary {
  readonly stepsHtml: string;
  readonly stepsMarkdown: string;
  readonly imageUrls: ReadonlyArray<string>;
  readonly openedBuild: string;
  readonly availableBuilds: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly availableUsers: ReadonlyArray<{ readonly account: string; readonly name: string }>;
  readonly comments: ReadonlyArray<IssueAutomationRemoteComment>;
}

export interface PlatformDownloadedAsset {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/**
 * Pluggable Enterprise Issue Platform adapter contract.
 * Implementing this interface for ZenTao, Jira, TAPD, etc. plugs into the entire
 * multi-repo, multi-model unattended automation engine without touching orchestration code.
 */
export interface IssuePlatformPlugin {
  readonly kind: IssueAutomationPlatformKind;
  readonly descriptor: IssueAutomationPlatformDescriptor;

  readonly normalizeBaseUrl: (rawUrl: string) => string;

  readonly probeAndListScopes: (
    credentials: PlatformCredentials,
  ) => Effect.Effect<PlatformProbeResult, IssueAutomationError>;

  readonly listIssues: (input: {
    readonly credentials: PlatformCredentials;
    readonly scopeId: string;
    readonly browseType: IssueAutomationBrowseFilter;
    readonly keyword?: string | undefined;
    readonly page: number;
    readonly pageSize: number;
  }) => Effect.Effect<PlatformIssuePage, IssueAutomationError>;

  readonly getIssueDetail: (input: {
    readonly credentials: PlatformCredentials;
    readonly scopeId: string;
    readonly issueKey: string;
  }) => Effect.Effect<PlatformIssueDetail, IssueAutomationError>;

  readonly downloadAttachment?: (input: {
    readonly credentials: PlatformCredentials;
    readonly url: string;
  }) => Effect.Effect<PlatformDownloadedAsset, IssueAutomationError>;

  readonly writeBack: (input: {
    readonly credentials: PlatformCredentials;
    readonly action: IssueAutomationWriteBackAction;
  }) => Effect.Effect<IssueAutomationWriteBackResult, IssueAutomationError>;
}
