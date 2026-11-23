import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createMcpAppToolApprovalCoordinator,
  mcpAppToolApprovalRefusalMessage,
} from "./toolApproval.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

describe("createMcpAppToolApprovalCoordinator", () => {
  it("approves allow-once without remembering and clears prior background suppression", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      environmentId: envA,
      server: "mobile-dev",
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
    expect(coordinator.getServerSnapshot(envA, "mobile-dev")).toEqual({
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
    expect(coordinator.getServerSnapshot(envA, "mobile-dev")).toEqual({
      allowedTools: [],
      suppressedTools: [],
    });
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it("remembers allow-session only for the matching environment, server, and tool", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      environmentId: envA,
      server: "mobile-dev",
      tool: "mobile_android_stream_reset",
    };
    const otherTool = { environmentId: envA, server: "mobile-dev", tool: "mobile_ios_tap" };
    const otherServer = {
      environmentId: envA,
      server: "other",
      tool: "mobile_android_stream_reset",
    };
    const otherEnv = {
      environmentId: envB,
      server: "mobile-dev",
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

    for (const isolated of [otherTool, otherServer, otherEnv]) {
      await coordinator.authorize({ target: isolated, userInitiated: false, prompt });
    }
    expect(prompt).toHaveBeenCalledTimes(4);
  });

  it("suppresses background retries after decline while allowing explicit user retries", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      environmentId: envA,
      server: "mobile-dev",
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
      environmentId: envA,
      server: "mobile-dev",
      tool: "mobile_android_stream_reset",
    };
    const tapTarget = { environmentId: envA, server: "mobile-dev", tool: "mobile_tap" };

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

  it("releases pending lock without recording suppression when prompt returns undefined", async () => {
    const coordinator = createMcpAppToolApprovalCoordinator();
    const target = {
      environmentId: envA,
      server: "mobile-dev",
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

    const initial = coordinator.getServerSnapshot(envA, "mobile-dev");
    expect(coordinator.getServerSnapshot(envA, "mobile-dev")).toBe(initial);

    await coordinator.authorize({
      target: { environmentId: envA, server: "mobile-dev", tool: "mobile_android_stream_reset" },
      userInitiated: false,
      prompt: async () => "allow-session",
    });
    await coordinator.authorize({
      target: { environmentId: envA, server: "mobile-dev", tool: "mobile_logs" },
      userInitiated: false,
      prompt: async () => "decline",
    });
    await coordinator.authorize({
      target: { environmentId: envB, server: "mobile-dev", tool: "mobile_android_stream_reset" },
      userInitiated: false,
      prompt: async () => "allow-session",
    });

    const afterGrant = coordinator.getServerSnapshot(envA, "mobile-dev");
    expect(afterGrant).toEqual({
      allowedTools: ["mobile_android_stream_reset"],
      suppressedTools: ["mobile_logs"],
    });
    expect(coordinator.getServerSnapshot(envA, "mobile-dev")).toBe(afterGrant);
    expect(listener).toHaveBeenCalledTimes(3);

    coordinator.resetServer(envA, "mobile-dev");
    expect(coordinator.getServerSnapshot(envA, "mobile-dev")).toBe(initial);
    expect(coordinator.getServerSnapshot(envB, "mobile-dev")).toEqual({
      allowedTools: ["mobile_android_stream_reset"],
      suppressedTools: [],
    });
    expect(listener).toHaveBeenCalledTimes(4);

    // No-op reset does not notify again.
    coordinator.resetServer(envA, "mobile-dev");
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
