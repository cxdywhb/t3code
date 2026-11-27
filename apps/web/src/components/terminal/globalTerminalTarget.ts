import { AuthTerminalReadScope, type EnvironmentId } from "@t3tools/contracts";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { readPrimaryEnvironmentId, usePrimaryEnvironmentId } from "../../state/environments";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import type { ThreadRouteTarget } from "../../threadRoutes";

function resolveEnvironment(
  target: ThreadRouteTarget | null,
  draftEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
) {
  // 有会话目标时不回退到其他主机，避免在远端未加载或无权限时打开本机终端。
  if (target?.kind === "server") return target.threadRef.environmentId;
  if (target?.kind === "draft") return draftEnvironmentId;
  return primaryEnvironmentId;
}

export function useGlobalTerminalEnvironmentId() {
  const target = useThreadRouteTarget();
  const draftEnvironmentId = useComposerDraftStore((state) =>
    target?.kind === "draft"
      ? (state.getDraftSession(target.draftId)?.environmentId ?? null)
      : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = resolveEnvironment(target, draftEnvironmentId, primaryEnvironmentId);
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  return canRead ? environmentId : null;
}

export function readGlobalTerminalEnvironmentId(target: ThreadRouteTarget | null) {
  const draftEnvironmentId =
    target?.kind === "draft"
      ? (useComposerDraftStore.getState().getDraftSession(target.draftId)?.environmentId ?? null)
      : null;
  const environmentId = resolveEnvironment(target, draftEnvironmentId, readPrimaryEnvironmentId());
  return environmentId !== null && readEnvironmentScope(environmentId, AuthTerminalReadScope)
    ? environmentId
    : null;
}
