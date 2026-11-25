import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  requestChoiceConfirmDialog,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
  respondToConfirmDialogChoice,
  subscribeConfirmDialogHost,
} from "./confirmDialog";

const mountHost = () => subscribeConfirmDialogHost(() => {});

function requireConfirmation(confirmation: Promise<boolean> | undefined): Promise<boolean> {
  if (!confirmation) {
    throw new Error("Expected a registered confirmation host.");
  }
  return confirmation;
}

describe("confirm dialog coordinator", () => {
  beforeEach(() => {
    resetConfirmDialogForTests();
  });

  it("serializes concurrent confirmations", async () => {
    const unregister = mountHost();
    const first = requireConfirmation(
      requestConfirmDialog("Delete the project?", { initialFocus: "confirm" }),
    );
    const second = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    respondToConfirmDialog(false);
    await expect(first).resolves.toBe(false);
    expect(readConfirmDialogState()).toEqual({
      status: "closing",
      message: "Delete the project?",
      variant: "default",
      initialFocus: "confirm",
    });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete the worktree too?",
      variant: "default",
    });

    respondToConfirmDialog(true);
    await expect(second).resolves.toBe(true);
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
  });

  it("cancels active and queued confirmations if the last host unmounts", async () => {
    const unregister = mountHost();
    const active = requireConfirmation(requestConfirmDialog("Delete the thread?"));
    const queued = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    unregister();

    await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });

  it("has no host until one subscribes", () => {
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
    const unsubscribe = mountHost();
    expect(requestConfirmDialog("Continue?")).toBeDefined();
    unsubscribe();
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
  });

  it("ignores responses after the active dialog has been closed", () => {
    const unregister = mountHost();
    const confirmation = requireConfirmation(requestConfirmDialog("Continue?"));

    respondToConfirmDialog(true);
    respondToConfirmDialog(false);
    completeConfirmDialogClose();

    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
    return expect(confirmation).resolves.toBe(true);
  });

  it("supports secondary choices, aborts active and queued requests, and resolves undefined on host unmount", async () => {
    const unregister = mountHost();
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();

    const first = requestChoiceConfirmDialog("Allow tool?", {
      confirmLabel: "Allow once",
      secondaryLabel: "Always allow this session",
      signal: activeAbort.signal,
    });
    const second = requestChoiceConfirmDialog("Allow second tool?", {
      confirmLabel: "Allow once",
      secondaryLabel: "Always allow this session",
      signal: queuedAbort.signal,
    });
    const third = requestChoiceConfirmDialog("Allow third tool?", {
      confirmLabel: "Allow once",
      secondaryLabel: "Always allow this session",
    });

    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Allow tool?",
      variant: "default",
      initialFocus: undefined,
      confirmLabel: "Allow once",
      secondaryLabel: "Always allow this session",
    });

    queuedAbort.abort();
    await expect(second).resolves.toBeUndefined();

    activeAbort.abort();
    await expect(first).resolves.toBeUndefined();
    expect(readConfirmDialogState()).toMatchObject({ status: "closing", message: "Allow tool?" });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toMatchObject({
      status: "confirming",
      message: "Allow third tool?",
    });

    respondToConfirmDialogChoice("secondary");
    await expect(third).resolves.toBe("secondary");
    completeConfirmDialogClose();

    const unmounted = requestChoiceConfirmDialog("Allow fourth tool?", {
      confirmLabel: "Allow once",
      secondaryLabel: "Always allow this session",
    });
    unregister();
    await expect(unmounted).resolves.toBeUndefined();
  });

  it("passes non-closing secondary actions through to the dialog state", async () => {
    const unregister = mountHost();
    const onSecondaryAction = () => {};
    const confirmation = requestChoiceConfirmDialog("Install update?", {
      secondaryLabel: "Open local folder",
      onSecondaryAction,
    });

    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Install update?",
      variant: "default",
      initialFocus: undefined,
      secondaryLabel: "Open local folder",
      onSecondaryAction,
    });

    respondToConfirmDialogChoice("confirm");
    completeConfirmDialogClose();
    unregister();
    await expect(confirmation).resolves.toBe("confirm");
  });
});
