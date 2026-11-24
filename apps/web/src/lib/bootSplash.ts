const BOOT_SHELL_ID = "boot-shell";
const BOOT_ERROR_ID = "boot-error";
const MIN_REVEAL_MS = 980;
const EXIT_FAILSAFE_MS = 650;

export interface DismissBootSplashOptions {
  readonly minRevealMs?: number;
  readonly exitFailsafeMs?: number;
  readonly now?: () => number;
  readonly prefersReducedMotion?: () => boolean;
  readonly scheduleFrame?: (callback: FrameRequestCallback) => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultScheduleFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(0), 0) as unknown as number;
}

function nextPaint(scheduleFrame: (callback: FrameRequestCallback) => number): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(() => {
      scheduleFrame(() => resolve());
    });
  });
}

function isBootShellElement(element: HTMLElement | null): element is HTMLElement {
  return (
    element !== null &&
    typeof element.querySelector === "function" &&
    typeof element.remove === "function" &&
    typeof element.dataset === "object" &&
    element.dataset !== null
  );
}

function hasBootError(bootShell: HTMLElement): boolean {
  return bootShell.querySelector(`#${BOOT_ERROR_ID}`) !== null;
}

export async function dismissBootSplash(options: DismissBootSplashOptions = {}): Promise<void> {
  if (typeof document === "undefined") return;
  const bootShell = document.getElementById(BOOT_SHELL_ID);
  if (!isBootShellElement(bootShell) || hasBootError(bootShell)) return;

  const minRevealMs = options.minRevealMs ?? MIN_REVEAL_MS;
  const exitFailsafeMs = options.exitFailsafeMs ?? EXIT_FAILSAFE_MS;
  const now = options.now ?? (() => performance.now());
  const reducedMotion = (options.prefersReducedMotion ?? defaultPrefersReducedMotion)();
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const sleep = options.sleep ?? defaultSleep;

  // Let React commit and paint into #root underneath before revealing the workspace.
  await nextPaint(scheduleFrame);
  if (!bootShell.isConnected || hasBootError(bootShell)) return;

  if (!reducedMotion) {
    const remainingMs = minRevealMs - now();
    if (remainingMs > 0) {
      await sleep(remainingMs);
      if (!bootShell.isConnected || hasBootError(bootShell)) return;
    }
  }

  bootShell.dataset.closing = "true";

  const animations = typeof bootShell.getAnimations === "function" ? bootShell.getAnimations() : [];
  if (animations.length > 0) {
    await Promise.race([
      Promise.allSettled(animations.map((animation) => animation.finished)),
      sleep(exitFailsafeMs),
    ]);
  }

  if (bootShell.isConnected && !hasBootError(bootShell)) {
    bootShell.remove();
  }
}
