import { useAtomValue } from "@effect/atom-react";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import {
  PrReviewSkillDescriptor,
  WS_METHODS,
  type EnvironmentId,
  type PrReviewStateSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useServerConfigs } from "./entities";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";

function createPrReviewAtoms() {
  const scheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  const stateQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:pr-review:state",
    tag: WS_METHODS.prReviewGetState,
  });

  const stateStream = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-stream:pr-review:state",
    tag: WS_METHODS.prReviewSubscribe,
  });

  const refreshState = (environmentId: EnvironmentId) => stateQuery({ environmentId, input: {} });

  return {
    skillsQuery: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
      label: "environment-data:pr-review:skills",
      tag: WS_METHODS.prReviewListSkills,
    }),
    stateQuery,
    stateStream,
    savePreset: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "pr-review:save-preset",
      tag: WS_METHODS.prReviewSavePreset,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    deletePreset: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "pr-review:delete-preset",
      tag: WS_METHODS.prReviewDeletePreset,
      scheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    startReview: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "pr-review:start-review",
      tag: WS_METHODS.prReviewStartReview,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    cancelTask: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "pr-review:cancel-task",
      tag: WS_METHODS.prReviewCancelTask,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
    writeBack: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "pr-review:write-back",
      tag: WS_METHODS.prReviewWriteBack,
      scheduler,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refreshState(target.environmentId))),
    }),
  };
}

export const prReviewEnvironment = createPrReviewAtoms();

const EMPTY_SNAPSHOT: PrReviewStateSnapshot = {
  presets: [],
  tasks: [],
  availableSkills: [],
  activeRunCount: 0,
};

const liveStreamSnapshotAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get): PrReviewStateSnapshot | null => {
    if (environmentId === null) return null;
    return AsyncResult.getOrElse(
      get(prReviewEnvironment.stateStream({ environmentId, input: {} })),
      () => null,
    );
  }).pipe(Atom.withLabel(`web:pr-review:live-stream:${environmentId ?? "none"}`)),
);

export function usePrReviewSupported(): boolean {
  const configs = useServerConfigs();
  for (const config of configs.values()) {
    if (config.environment.capabilities.prReview === true) {
      return true;
    }
  }
  return false;
}

const Favorites = Schema.Array(PrReviewSkillDescriptor);
export function useFavoriteReviewSkills(environmentId: EnvironmentId | null) {
  return useLocalStorage(
    `t3code:pr-review:favorite-skills:${environmentId ?? "default"}`,
    [],
    Favorites,
  );
}

export function usePrReviewLiveState(explicitEnvironmentId?: EnvironmentId | null) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    explicitEnvironmentId !== undefined ? explicitEnvironmentId : primaryEnvironmentId;
  const initialQuery = useEnvironmentQuery(
    environmentId !== null ? prReviewEnvironment.stateQuery({ environmentId, input: {} }) : null,
  );
  const streamed = useAtomValue(liveStreamSnapshotAtom(environmentId));
  return {
    environmentId,
    snapshot: streamed ?? initialQuery.data ?? EMPTY_SNAPSHOT,
    isPending: streamed === null && initialQuery.isPending,
    error: initialQuery.error,
    refresh: initialQuery.refresh,
  };
}
