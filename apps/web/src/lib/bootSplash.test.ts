import { describe, expect, it, vi } from "vite-plus/test";

import { dismissBootSplash } from "./bootSplash";

interface FakeBootShell {
  readonly dataset: Record<string, string | undefined>;
  isConnected: boolean;
  hasError: boolean;
  readonly removed: ReturnType<typeof vi.fn>;
  readonly getAnimations: ReturnType<typeof vi.fn>;
  readonly querySelector: (selector: string) => object | null;
  readonly remove: () => void;
}

function createFakeBootShell(options?: {
  hasError?: boolean;
  animations?: ReadonlyArray<{ readonly finished: Promise<unknown> }>;
}): FakeBootShell {
  const removed = vi.fn();
  const getAnimations = vi.fn(() => options?.animations ?? []);
  const shell: FakeBootShell = {
    dataset: {},
    isConnected: true,
    hasError: options?.hasError ?? false,
    removed,
    getAnimations,
    querySelector: (selector: string) => (selector === "#boot-error" && shell.hasError ? {} : null),
    remove: () => {
      shell.isConnected = false;
      removed();
    },
  };
  return shell;
}

function stubBootDocument(shell: FakeBootShell | null) {
  vi.stubGlobal("document", {
    getElementById: (id: string) => (id === "boot-shell" ? shell : null),
  });
}

const immediateFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};

describe("dismissBootSplash", () => {
  it("waits for the remaining minimum reveal window on fast boots, then fades and removes", async () => {
    let resolveAnimation!: () => void;
    const animationFinished = new Promise<void>((resolve) => {
      resolveAnimation = resolve;
    });
    const shell = createFakeBootShell({ animations: [{ finished: animationFinished }] });
    stubBootDocument(shell);

    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
      if (ms === 650) {
        // Keep failsafe pending so the animation promise wins.
        await new Promise(() => {});
      }
    });

    try {
      const pending = dismissBootSplash({
        minRevealMs: 980,
        exitFailsafeMs: 650,
        now: () => 260,
        prefersReducedMotion: () => false,
        scheduleFrame: immediateFrame,
        sleep,
      });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sleeps).toEqual([720, 650]);
      expect(shell.dataset.closing).toBe("true");
      expect(shell.removed).not.toHaveBeenCalled();

      resolveAnimation();
      await pending;

      expect(shell.removed).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts exiting immediately when startup already exceeded the minimum reveal time", async () => {
    const shell = createFakeBootShell();
    stubBootDocument(shell);
    const sleep = vi.fn(async () => {});

    try {
      await dismissBootSplash({
        minRevealMs: 980,
        now: () => 1400,
        prefersReducedMotion: () => false,
        scheduleFrame: immediateFrame,
        sleep,
      });

      expect(sleep).not.toHaveBeenCalled();
      expect(shell.dataset.closing).toBe("true");
      expect(shell.removed).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the minimum reveal wait when prefers-reduced-motion is enabled", async () => {
    const shell = createFakeBootShell();
    stubBootDocument(shell);
    const sleep = vi.fn(async () => {});

    try {
      await dismissBootSplash({
        minRevealMs: 980,
        now: () => 120,
        prefersReducedMotion: () => true,
        scheduleFrame: immediateFrame,
        sleep,
      });

      expect(sleep).not.toHaveBeenCalled();
      expect(shell.dataset.closing).toBe("true");
      expect(shell.removed).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the splash element intact if a boot error is shown", async () => {
    const shell = createFakeBootShell({ hasError: true });
    stubBootDocument(shell);
    const sleep = vi.fn(async () => {});

    try {
      await dismissBootSplash({
        now: () => 2000,
        prefersReducedMotion: () => false,
        scheduleFrame: immediateFrame,
        sleep,
      });

      expect(shell.dataset.closing).toBeUndefined();
      expect(shell.removed).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores non-DOM document stubs cleanly", async () => {
    vi.stubGlobal("document", { getElementById: () => ({}) });
    const sleep = vi.fn(async () => {});

    try {
      await expect(
        dismissBootSplash({ scheduleFrame: immediateFrame, sleep }),
      ).resolves.toBeUndefined();
      expect(sleep).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
