import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createMcpAppToolApprovalCoordinator,
  mcpAppToolApprovalRefusalMessage,
} from "./toolApproval.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

const scope = {
  threadId: ThreadId.make("thread-a"),
  itemId: TurnItemId.make("item-a"),
  connectionId: "connection-a",
  environmentId: envA,
  server: "mobile-dev",
};

describe("createMcpAppToolApprovalCoordinator", () => {
  it("approves allow-once without remembering and clears prior background suppression", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      ...scope,
      tool: "mobile_android_stream_reset",
    };

    const prompt = vi
      .fn<() => Promise<"allow-once" | "allow-session" | "decline" | undefined>>()
      .mockResolvedValueOnce("allow-once")
      .mockResolvedValueOnce("decline")
      .mockResolvedValueOnce("allow-once");

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: true,
    });
    expect(coordinator.isAllowed(target)).toBe(false);
    expect(coordinator.getServerSnapshot(scope)).toEqual({
      allowedTools: [],
      suppressedTools: [],
    });

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: false,
      reason: "declined",
    });
    expect(coordinator.isBackgroundSuppressed(target)).toBe(true);

    // Explicit user click prompts again, and allow-once lifts the background suppression.
    await expect(coordinator.authorize({ target, userInitiated: true, prompt })).resolves.toEqual({
      approved: true,
    });
    expect(coordinator.isBackgroundSuppressed(target)).toBe(false);
    expect(coordinator.getServerSnapshot(scope)).toEqual({
      allowedTools: [],
      suppressedTools: [],
    });
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it("remembers allow-session only for the matching environment, server, and tool", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      ...scope,
      tool: "mobile_android_stream_reset",
    };
    const otherTool = { ...scope, tool: "mobile_ios_tap" };
    const otherServer = {
      ...scope,
      server: "other",
      tool: "mobile_android_stream_reset",
    };
    const otherEnv = {
      ...scope,
      environmentId: envB,
      tool: "mobile_android_stream_reset",
    };

    const prompt = vi.fn().mockResolvedValue("allow-session");

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: true,
    });
    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: true,
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(coordinator.isAllowed(target)).toBe(true);
    expect(coordinator.isAllowed(otherTool)).toBe(false);
    expect(coordinator.isAllowed(otherServer)).toBe(false);
    expect(coordinator.isAllowed(otherEnv)).toBe(false);

    for (const isolated of [
      otherTool,
      otherServer,
      otherEnv,
      { ...target, threadId: ThreadId.make("thread-b") },
      { ...target, connectionId: "replacement" },
    ]) {
      expect(coordinator.isAllowed(isolated)).toBe(false);
      await coordinator.authorize({ target: isolated, userInitiated: false, prompt });
    }
    expect(prompt).toHaveBeenCalledTimes(6);
  });

  it("suppresses background retries after decline while allowing explicit user retries", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      ...scope,
      tool: "mobile_android_stream_reset",
    };

    const prompt = vi.fn().mockResolvedValueOnce("decline").mockResolvedValueOnce("allow-session");

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: false,
      reason: "declined",
    });
    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: false,
      reason: "suppressed",
    });
    expect(prompt).toHaveBeenCalledTimes(1);

    await expect(coordinator.authorize({ target, userInitiated: true, prompt })).resolves.toEqual({
      approved: true,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(coordinator.isAllowed(target)).toBe(true);
    expect(coordinator.isBackgroundSuppressed(target)).toBe(false);
  });

  it("deduplicates concurrent prompts for the same tool without blocking other tools", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const resetTarget = {
      ...scope,
      tool: "mobile_android_stream_reset",
    };
    const tapTarget = { ...scope, tool: "mobile_tap" };

    let resolveFirst!: (value: "allow-session") => void;
    const firstPrompt = new Promise<"allow-session">((resolve) => {
      resolveFirst = resolve;
    });
    const promptReset = vi.fn(() => firstPrompt);
    const promptTap = vi.fn(async () => "allow-once" as const);

    const pendingFirst = coordinator.authorize({
      target: resetTarget,
      userInitiated: false,
      prompt: promptReset,
    });
    expect(coordinator.isPromptPending(resetTarget)).toBe(true);

    await expect(
      coordinator.authorize({
        target: resetTarget,
        userInitiated: false,
        prompt: promptReset,
      }),
    ).resolves.toEqual({ approved: false, reason: "already-pending" });

    await expect(
      coordinator.authorize({
        target: tapTarget,
        userInitiated: true,
        prompt: promptTap,
      }),
    ).resolves.toEqual({ approved: true });

    resolveFirst("allow-session");
    await expect(pendingFirst).resolves.toEqual({ approved: true });
    expect(coordinator.isPromptPending(resetTarget)).toBe(false);
    expect(promptReset).toHaveBeenCalledTimes(1);
    expect(promptTap).toHaveBeenCalledTimes(1);
  });

  it("ignores late decisions after reset or unmount and preserves a replacement prompt", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = { ...scope, tool: "write" };
    const old = Promise.withResolvers<"allow-session">();
    const current = Promise.withResolvers<"decline">();
    const abort = new AbortController();
    const first = coordinator.authorize({ target, userInitiated: true, prompt: () => old.promise });
    expect(coordinator.isPromptPending({ ...target, connectionId: "replacement" })).toBe(false);
    coordinator.resetServer(scope);
    const second = coordinator.authorize({
      target,
      userInitiated: true,
      signal: abort.signal,
      prompt: () => current.promise,
    });
    old.resolve("allow-session");
    await expect(first).resolves.toEqual({ approved: false, reason: "unavailable" });
    expect(coordinator.isPromptPending(target)).toBe(true);
    abort.abort();
    current.resolve("decline");
    await expect(second).resolves.toEqual({ approved: false, reason: "unavailable" });
    expect(coordinator.getServerSnapshot(scope)).toEqual({ allowedTools: [], suppressedTools: [] });
  });

  it("releases pending lock without recording suppression when prompt returns undefined", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      ...scope,
      tool: "mobile_android_stream_reset",
    };
    const prompt = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce("allow-once");

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: false,
      reason: "unavailable",
    });
    expect(coordinator.isPromptPending(target)).toBe(false);
    expect(coordinator.isBackgroundSuppressed(target)).toBe(false);

    await expect(coordinator.authorize({ target, userInitiated: false, prompt })).resolves.toEqual({
      approved: true,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("keeps server snapshots referentially stable, notifies subscribers, and resets per server", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);

    const initial = coordinator.getServerSnapshot(scope);
    expect(coordinator.getServerSnapshot(scope)).toBe(initial);

    await coordinator.authorize({
      target: { ...scope, tool: "mobile_android_stream_reset" },
      userInitiated: false,
      prompt: async () => "allow-session",
    });
    await coordinator.authorize({
      target: { ...scope, tool: "mobile_logs" },
      userInitiated: false,
      prompt: async () => "decline",
    });
    await coordinator.authorize({
      target: { ...scope, environmentId: envB, tool: "mobile_android_stream_reset" },
      userInitiated: false,
      prompt: async () => "allow-session",
    });

    const replacement = { ...scope, connectionId: "replacement" };
    expect(coordinator.getServerSnapshot(replacement)).toBe(initial);
    coordinator.resetServer(replacement);
    const afterGrant = coordinator.getServerSnapshot(scope);
    expect(afterGrant).toEqual({
      allowedTools: ["mobile_android_stream_reset"],
      suppressedTools: ["mobile_logs"],
    });
    expect(coordinator.getServerSnapshot(scope)).toBe(afterGrant);
    expect(listener).toHaveBeenCalledTimes(3);

    coordinator.resetServer(scope);
    expect(coordinator.getServerSnapshot(scope)).toBe(initial);
    expect(coordinator.getServerSnapshot({ ...scope, environmentId: envB })).toEqual({
      allowedTools: ["mobile_android_stream_reset"],
      suppressedTools: [],
    });
    expect(listener).toHaveBeenCalledTimes(4);

    // No-op reset does not notify again.
    coordinator.resetServer(scope);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    coordinator.resetAll();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(mcpAppToolApprovalRefusalMessage("unavailable")).toBe(
      "T3 could not ask for approval here.",
    );
    expect(mcpAppToolApprovalRefusalMessage("already-pending")).toBe(
      "Waiting for approval of this tool.",
    );
    expect(mcpAppToolApprovalRefusalMessage("declined")).toBe("Declined by the user.");
    expect(mcpAppToolApprovalRefusalMessage("suppressed")).toBe("Declined by the user.");
  });
});
