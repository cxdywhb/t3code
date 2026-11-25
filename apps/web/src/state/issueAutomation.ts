import { useAtomValue } from "@effect/atom-react";
import { request } from "@t3tools/client-runtime/rpc";
import {
  createAtomCommandScheduler,
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  type EnvironmentId,
  type IssueAutomationProfile,
  type IssueAutomationStateSnapshot,
} from "@t3tools/contracts";
import { scanIssueAutomationPage } from "@t3tools/shared/issueAutomationScan";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useServerConfigs } from "./entities";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";

function createIssueAutomationAtoms() {
  const scheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  const stateQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issue-automation:state",
    tag: WS_METHODS.issueAutomationGetState,
  });

  const stateStream = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-stream:issue-automation:state",
    tag: WS_METHODS.issueAutomationSubscribe,
  });

  const remoteIssues = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issue-automation:remote-issues",
    tag: WS_METHODS.issueAutomationListRemoteIssues,
  });

  const remoteIssueDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issue-automation:remote-issue-detail",
    tag: WS_METHODS.issueAutomationGetRemoteIssueDetail,
  });

  const remoteScanProfileIssues = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issue-automation:scan-profile-issues",
    tag: WS_METHODS.issueAutomationScanProfileIssues,
  });

  const scanWithIssueList = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issue-automation:scan-with-issue-list",
    execute: Effect.fn("IssueAutomation.scanWithIssueList")(function* (input: {
      readonly connectorId: IssueAutomationProfile["connectorId"];
      readonly scopeId: string;
      readonly filter: IssueAutomationProfile["filter"];
      readonly page: number;
    }) {
      const { items, hasNextPage } = yield* scanIssueAutomationPage(
        input.page,
        input.filter,
        (page, pageSize) =>
          request(WS_METHODS.issueAutomationListRemoteIssues, {
            connectorId: input.connectorId,
            scopeId: input.scopeId,
            browseType: input.filter.browseType,
            ...(input.filter.keyword === null ? {} : { keyword: input.filter.keyword }),
            page,
            pageSize,
          }).pipe(Effect.map(({ issues, total }) => ({ items: issues, total }))),
      );
      return { issues: items, hasNextPage };
    }),
  });

  const refreshState = (environmentId: EnvironmentId) => stateQuery({ environmentId, input: {} });

  return {
    stateQuery,
    stateStream,
    remoteIssues,
    remoteIssueDetail,
    scanProfileIssues: ({
      environmentId,
      profile,
      page,
      supportsRuleScan,
    }: {
      readonly environmentId: EnvironmentId;
      readonly profile: IssueAutomationProfile;
      readonly page: number;
      readonly supportsRuleScan: boolean;
    }) =>
      supportsRuleScan
        ? remoteScanProfileIssues({ environmentId, input: { profileId: profile.id, page } })
        : scanWithIssueList({
            environmentId,
            input: {
              connectorId: profile.connectorId,
              scopeId: profile.scopeId,
              filter: profile.filter,
              page,
            },
          }),
    saveConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:save-connector",
      tag: WS_METHODS.issueAutomationSaveConnector,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    deleteConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:delete-connector",
      tag: WS_METHODS.issueAutomationDeleteConnector,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    refreshScopes: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:refresh-scopes",
      tag: WS_METHODS.issueAutomationRefreshScopes,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    saveProfile: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:save-profile",
      tag: WS_METHODS.issueAutomationSaveProfile,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    deleteProfile: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:delete-profile",
      tag: WS_METHODS.issueAutomationDeleteProfile,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    setProfileEnabled: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:set-profile-enabled",
      tag: WS_METHODS.issueAutomationSetProfileEnabled,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    analyzeIssues: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:analyze-issues",
      tag: WS_METHODS.issueAutomationAnalyzeIssues,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    cancelTask: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:cancel-task",
      tag: WS_METHODS.issueAutomationCancelTask,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    confirmRepair: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:confirm-repair",
      tag: WS_METHODS.issueAutomationConfirmRepair,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    writeBack: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "issue-automation:write-back",
      tag: WS_METHODS.issueAutomationWriteBack,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
  };
}

export const issueAutomationEnvironment = createIssueAutomationAtoms();

const EMPTY_SNAPSHOT: IssueAutomationStateSnapshot = {
  platforms: [],
  connectors: [],
  profiles: [],
  tasks: [],
  activeRunCount: 0,
};

const liveStreamSnapshotAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get): IssueAutomationStateSnapshot | null => {
    if (environmentId === null) return null;
    return AsyncResult.getOrElse(
      get(issueAutomationEnvironment.stateStream({ environmentId, input: {} })),
      () => null,
    );
  }).pipe(Atom.withLabel(`web:issue-automation:live-stream:${environmentId ?? "none"}`)),
);

export function useIssueAutomationSupported(): boolean {
  const configs = useServerConfigs();
  for (const config of configs.values()) {
    if (config.environment.capabilities.issueAutomation === true) {
      return true;
    }
  }
  return false;
}

export function useIssueAutomationLiveState(environmentId: EnvironmentId | null): {
  readonly snapshot: IssueAutomationStateSnapshot;
  readonly isLoading: boolean;
} {
  const primaryId = usePrimaryEnvironmentId();
  const targetEnvId = environmentId ?? primaryId;

  const streamed = useAtomValue(liveStreamSnapshotAtom(targetEnvId));
  const queried = useEnvironmentQuery(
    targetEnvId !== null
      ? issueAutomationEnvironment.stateQuery({ environmentId: targetEnvId, input: {} })
      : null,
  );

  if (targetEnvId === null) {
    return { snapshot: EMPTY_SNAPSHOT, isLoading: false };
  }

  return {
    snapshot: streamed ?? queried.data ?? EMPTY_SNAPSHOT,
    isLoading: streamed === null && queried.data === null && queried.isPending,
  };
}
