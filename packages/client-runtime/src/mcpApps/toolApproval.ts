import type { EnvironmentId } from "@t3tools/contracts";

export type McpAppToolApprovalDecision = "allow-once" | "allow-session" | "decline";

export interface McpAppToolApprovalTarget {
  readonly environmentId: EnvironmentId;
  readonly server: string;
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
    readonly prompt: () => Promise<McpAppToolApprovalDecision | undefined>;
  }) => Promise<McpAppToolApprovalResult>;
  readonly getServerSnapshot: (
    environmentId: EnvironmentId,
    server: string,
  ) => McpAppToolApprovalServerSnapshot;
  readonly resetServer: (environmentId: EnvironmentId, server: string) => void;
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

interface StoredApprovalEntry {
  readonly environmentId: EnvironmentId;
  readonly server: string;
  readonly tool: string;
  readonly status: "allowed" | "suppressed-background";
}

const EMPTY_SERVER_SNAPSHOT: McpAppToolApprovalServerSnapshot = {
  allowedTools: [],
  suppressedTools: [],
};

const toolKey = (target: McpAppToolApprovalTarget): string =>
  JSON.stringify([target.environmentId, target.server, target.tool]);

const serverKey = (environmentId: EnvironmentId, server: string): string =>
  JSON.stringify([environmentId, server]);

export function createMcpAppToolApprovalCoordinator(): McpAppToolApprovalCoordinator {
  const entries = new Map<string, StoredApprovalEntry>();
  const pendingPrompts = new Set<string>();
  const serverSnapshots = new Map<string, McpAppToolApprovalServerSnapshot>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const recomputeServerSnapshot = (environmentId: EnvironmentId, server: string) => {
    const allowedTools: Array<string> = [];
    const suppressedTools: Array<string> = [];
    for (const entry of entries.values()) {
      if (entry.environmentId !== environmentId || entry.server !== server) continue;
      if (entry.status === "allowed") allowedTools.push(entry.tool);
      else suppressedTools.push(entry.tool);
    }
    const key = serverKey(environmentId, server);
    if (allowedTools.length === 0 && suppressedTools.length === 0) {
      serverSnapshots.delete(key);
      return;
    }
    allowedTools.sort();
    suppressedTools.sort();
    serverSnapshots.set(key, { allowedTools, suppressedTools });
  };

  return {
    isAllowed: (target) => entries.get(toolKey(target))?.status === "allowed",
    isBackgroundSuppressed: (target) =>
      entries.get(toolKey(target))?.status === "suppressed-background",
    isPromptPending: (target) => pendingPrompts.has(toolKey(target)),
    authorize: async ({ target, userInitiated, prompt }) => {
      const key = toolKey(target);
      const existing = entries.get(key);
      if (existing?.status === "allowed") return { approved: true };
      if (existing?.status === "suppressed-background" && !userInitiated) {
        return { approved: false, reason: "suppressed" };
      }
      if (pendingPrompts.has(key)) {
        return { approved: false, reason: "already-pending" };
      }

      pendingPrompts.add(key);
      let decision: McpAppToolApprovalDecision | undefined;
      try {
        decision = await prompt();
      } finally {
        pendingPrompts.delete(key);
      }

      if (decision === undefined) {
        return { approved: false, reason: "unavailable" };
      }
      if (decision === "allow-session") {
        entries.set(key, { ...target, status: "allowed" });
        recomputeServerSnapshot(target.environmentId, target.server);
        notify();
        return { approved: true };
      }
      if (decision === "allow-once") {
        if (entries.delete(key)) {
          recomputeServerSnapshot(target.environmentId, target.server);
          notify();
        }
        return { approved: true };
      }
      entries.set(key, { ...target, status: "suppressed-background" });
      recomputeServerSnapshot(target.environmentId, target.server);
      notify();
      return { approved: false, reason: "declined" };
    },
    getServerSnapshot: (environmentId, server) =>
      serverSnapshots.get(serverKey(environmentId, server)) ?? EMPTY_SERVER_SNAPSHOT,
    resetServer: (environmentId, server) => {
      let removed = false;
      for (const [key, entry] of entries.entries()) {
        if (entry.environmentId === environmentId && entry.server === server) {
          entries.delete(key);
          removed = true;
        }
      }
      serverSnapshots.delete(serverKey(environmentId, server));
      if (removed) notify();
    },
    resetAll: () => {
      const hadState = entries.size > 0 || pendingPrompts.size > 0 || serverSnapshots.size > 0;
      entries.clear();
      pendingPrompts.clear();
      serverSnapshots.clear();
      if (hadState) notify();
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
