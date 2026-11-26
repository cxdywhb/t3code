import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";

export type McpAppToolApprovalDecision = "allow-once" | "allow-session" | "decline";

interface McpAppToolApprovalScope {
  readonly threadId: ThreadId;
  readonly connectionId: string | undefined;
  readonly itemId: TurnItemId;
  readonly environmentId: EnvironmentId;
  readonly server: string;
}

export interface McpAppToolApprovalTarget extends McpAppToolApprovalScope {
  readonly tool: string;
}

export interface McpAppToolApprovalServerSnapshot {
  readonly allowedTools: ReadonlyArray<string>;
  readonly suppressedTools: ReadonlyArray<string>;
}

export type McpAppToolApprovalRefusalReason =
  | "declined"
  | "suppressed"
  | "already-pending"
  | "unavailable";

export type McpAppToolApprovalResult =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason: McpAppToolApprovalRefusalReason };

export interface McpAppToolApprovalCoordinator {
  readonly isAllowed: (target: McpAppToolApprovalTarget) => boolean;
  readonly isBackgroundSuppressed: (target: McpAppToolApprovalTarget) => boolean;
  readonly isPromptPending: (target: McpAppToolApprovalTarget) => boolean;
  readonly authorize: (input: {
    readonly target: McpAppToolApprovalTarget;
    readonly userInitiated: boolean;
    readonly signal?: AbortSignal;
    readonly prompt: () => Promise<McpAppToolApprovalDecision | undefined>;
  }) => Promise<McpAppToolApprovalResult>;
  readonly getServerSnapshot: (scope: McpAppToolApprovalScope) => McpAppToolApprovalServerSnapshot;
  readonly resetServer: (scope: McpAppToolApprovalScope) => void;
  readonly resetAll: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function mcpAppToolApprovalRefusalMessage(reason: McpAppToolApprovalRefusalReason): string {
  switch (reason) {
    case "unavailable":
      return "T3 could not ask for approval here.";
    case "already-pending":
      // oxlint-disable-next-line t3code/no-untranslated-copy -- JSON-RPC error returned to the MCP app frame, not shown in T3's UI
      return "Waiting for approval of this tool.";
    case "declined":
    case "suppressed":
      // oxlint-disable-next-line t3code/no-untranslated-copy -- JSON-RPC error returned to the MCP app frame, not shown in T3's UI
      return "Declined by the user.";
  }
}

const EMPTY_SERVER_SNAPSHOT: McpAppToolApprovalServerSnapshot = {
  allowedTools: [],
  suppressedTools: [],
};

const serverKey = (scope: McpAppToolApprovalScope): string =>
  JSON.stringify([
    scope.environmentId,
    scope.threadId,
    scope.server,
    scope.connectionId ?? [scope.itemId],
  ]);

export function createMcpAppToolApprovalCoordinator(): McpAppToolApprovalCoordinator {
  const servers = new Map<
    string,
    {
      decisions: Map<string, "allowed" | "suppressed">;
      pending: Set<string>;
      snapshot: McpAppToolApprovalServerSnapshot;
    }
  >();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    isAllowed: (target) => servers.get(serverKey(target))?.decisions.get(target.tool) === "allowed",
    isBackgroundSuppressed: (target) =>
      servers.get(serverKey(target))?.decisions.get(target.tool) === "suppressed",
    isPromptPending: (target) => servers.get(serverKey(target))?.pending.has(target.tool) === true,
    authorize: async ({ target, userInitiated, prompt, signal }) => {
      if (signal?.aborted) return { approved: false, reason: "unavailable" };
      const key = serverKey(target);
      const state = servers.get(key) ?? {
        decisions: new Map<string, "allowed" | "suppressed">(),
        pending: new Set<string>(),
        snapshot: EMPTY_SERVER_SNAPSHOT,
      };
      const { tool } = target;
      const decision = state.decisions.get(tool);
      if (decision === "allowed") return { approved: true };
      if (decision === "suppressed" && !userInitiated)
        return { approved: false, reason: "suppressed" };
      if (state.pending.has(tool)) return { approved: false, reason: "already-pending" };

      servers.set(key, state);
      state.pending.add(tool);
      try {
        const choice = await prompt();
        if (choice === undefined || signal?.aborted || servers.get(key) !== state) {
          return { approved: false, reason: "unavailable" };
        }
        if (target.connectionId !== undefined) {
          const next =
            choice === "allow-session"
              ? "allowed"
              : choice === "decline"
                ? "suppressed"
                : undefined;
          if (next !== decision) {
            if (next === undefined) state.decisions.delete(tool);
            else state.decisions.set(tool, next);
            const allowedTools: string[] = [];
            const suppressedTools: string[] = [];
            for (const [name, status] of state.decisions) {
              (status === "allowed" ? allowedTools : suppressedTools).push(name);
            }
            state.snapshot =
              state.decisions.size === 0
                ? EMPTY_SERVER_SNAPSHOT
                : {
                    allowedTools: allowedTools.sort(),
                    suppressedTools: suppressedTools.sort(),
                  };
            notify();
          }
        }
        return choice === "decline" ? { approved: false, reason: "declined" } : { approved: true };
      } finally {
        state.pending.delete(tool);
        if (state.pending.size === 0 && state.decisions.size === 0 && servers.get(key) === state)
          servers.delete(key);
      }
    },
    getServerSnapshot: (scope) => servers.get(serverKey(scope))?.snapshot ?? EMPTY_SERVER_SNAPSHOT,
    resetServer: (scope) => {
      if (servers.delete(serverKey(scope))) notify();
    },
    resetAll: () => {
      if (servers.size === 0) return;
      servers.clear();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const mcpAppToolApprovals = createMcpAppToolApprovalCoordinator();
