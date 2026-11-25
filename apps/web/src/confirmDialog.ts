import type { ConfirmDialogOptions, ConfirmDialogVariant } from "@t3tools/contracts";

export type ConfirmDialogChoiceResult = "cancel" | "confirm" | "secondary";

export interface ChoiceConfirmDialogOptions extends ConfirmDialogOptions {
  readonly confirmLabel?: string;
  readonly secondaryLabel?: string;
  /** Runs when the secondary button is clicked without closing the dialog. */
  readonly onSecondaryAction?: () => void;
  readonly signal?: AbortSignal;
}

export type ConfirmDialogState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming";
      readonly message: string;
      readonly variant: ConfirmDialogVariant;
      readonly initialFocus: ConfirmDialogOptions["initialFocus"];
      readonly confirmLabel?: string;
      readonly secondaryLabel?: string;
      readonly onSecondaryAction?: () => void;
    }
  | {
      readonly status: "closing";
      readonly message: string;
      readonly variant: ConfirmDialogVariant;
      readonly initialFocus: ConfirmDialogOptions["initialFocus"];
      readonly confirmLabel?: string;
      readonly secondaryLabel?: string;
      readonly onSecondaryAction?: () => void;
    };

type PendingConfirmation = {
  readonly message: string;
  readonly variant: ConfirmDialogVariant;
  readonly initialFocus: ConfirmDialogOptions["initialFocus"];
  readonly confirmLabel?: string;
  readonly secondaryLabel?: string;
  readonly onSecondaryAction?: () => void;
  readonly resolveChoice: (choice: ConfirmDialogChoiceResult | undefined) => void;
  cleanupAbort?: (() => void) | undefined;
};

const idleState: ConfirmDialogState = { status: "idle" };
let state: ConfirmDialogState = idleState;
let activeConfirmation: PendingConfirmation | null = null;
let queuedConfirmations: PendingConfirmation[] = [];
const listeners = new Set<() => void>();

function buildDialogState(
  status: "confirming" | "closing",
  source: Pick<
    PendingConfirmation,
    "message" | "variant" | "initialFocus" | "confirmLabel" | "secondaryLabel" | "onSecondaryAction"
  >,
): ConfirmDialogState {
  return {
    status,
    message: source.message,
    variant: source.variant,
    initialFocus: source.initialFocus,
    ...(source.confirmLabel === undefined ? {} : { confirmLabel: source.confirmLabel }),
    ...(source.secondaryLabel === undefined ? {} : { secondaryLabel: source.secondaryLabel }),
    ...(source.onSecondaryAction === undefined
      ? {}
      : { onSecondaryAction: source.onSecondaryAction }),
  };
}

function publish(next: ConfirmDialogState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function resolvePendingConfirmations(): void {
  if (activeConfirmation) {
    activeConfirmation.cleanupAbort?.();
    activeConfirmation.cleanupAbort = undefined;
    activeConfirmation.resolveChoice(undefined);
  }
  for (const confirmation of queuedConfirmations) {
    confirmation.cleanupAbort?.();
    confirmation.cleanupAbort = undefined;
    confirmation.resolveChoice(undefined);
  }
  activeConfirmation = null;
  queuedConfirmations = [];
}

export function readConfirmDialogState(): ConfirmDialogState {
  return state;
}

/**
 * Only themed hosts subscribe, so a subscriber is a mounted host. When the last
 * one leaves, pending confirmations resolve as cancelled.
 */
export function subscribeConfirmDialogHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    resolvePendingConfirmations();
    publish(idleState);
  };
}

function enqueueChoiceConfirmation(
  message: string,
  options: {
    readonly variant: ConfirmDialogVariant;
    readonly initialFocus: ConfirmDialogOptions["initialFocus"];
    readonly confirmLabel?: string;
    readonly secondaryLabel?: string;
    readonly onSecondaryAction?: () => void;
    readonly signal?: AbortSignal;
  },
): Promise<ConfirmDialogChoiceResult | undefined> {
  if (options.signal?.aborted) {
    return Promise.resolve(undefined);
  }

  return new Promise<ConfirmDialogChoiceResult | undefined>((resolveChoice) => {
    const pending: PendingConfirmation = {
      message,
      variant: options.variant,
      initialFocus: options.initialFocus,
      ...(options.confirmLabel === undefined ? {} : { confirmLabel: options.confirmLabel }),
      ...(options.secondaryLabel === undefined ? {} : { secondaryLabel: options.secondaryLabel }),
      ...(options.onSecondaryAction === undefined
        ? {}
        : { onSecondaryAction: options.onSecondaryAction }),
      resolveChoice,
    };

    if (options.signal) {
      const signal = options.signal;
      const onAbort = () => {
        pending.cleanupAbort = undefined;
        if (activeConfirmation === pending) {
          activeConfirmation = null;
          pending.resolveChoice(undefined);
          if (state.status === "confirming") {
            publish(buildDialogState("closing", state));
          }
          return;
        }
        const queuedIndex = queuedConfirmations.indexOf(pending);
        if (queuedIndex >= 0) {
          queuedConfirmations.splice(queuedIndex, 1);
          pending.resolveChoice(undefined);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.cleanupAbort = () => signal.removeEventListener("abort", onAbort);
    }

    if (activeConfirmation || state.status === "closing") {
      queuedConfirmations.push(pending);
      return;
    }

    activeConfirmation = pending;
    publish(buildDialogState("confirming", pending));
  });
}

/** Undefined means no themed host is available. */
export function requestConfirmDialog(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> | undefined {
  if (listeners.size === 0) return undefined;

  return enqueueChoiceConfirmation(message, {
    variant: options?.variant ?? "default",
    initialFocus: options?.initialFocus,
  }).then((choice) => choice === "confirm");
}

/** Undefined means no themed host is available. */
export function requestChoiceConfirmDialog(
  message: string,
  options: ChoiceConfirmDialogOptions,
): Promise<ConfirmDialogChoiceResult | undefined> | undefined {
  if (listeners.size === 0) return undefined;

  return enqueueChoiceConfirmation(message, {
    variant: options.variant ?? "default",
    initialFocus: options.initialFocus,
    ...(options.confirmLabel === undefined ? {} : { confirmLabel: options.confirmLabel }),
    ...(options.secondaryLabel === undefined ? {} : { secondaryLabel: options.secondaryLabel }),
    ...(options.onSecondaryAction === undefined
      ? {}
      : { onSecondaryAction: options.onSecondaryAction }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

export function isConfirmDialogActive(): boolean {
  return state.status !== "idle" || activeConfirmation !== null || queuedConfirmations.length > 0;
}

export function respondToConfirmDialogChoice(choice: ConfirmDialogChoiceResult): void {
  if (state.status !== "confirming" || !activeConfirmation) return;

  const confirmation = activeConfirmation;
  activeConfirmation = null;
  confirmation.cleanupAbort?.();
  confirmation.cleanupAbort = undefined;
  confirmation.resolveChoice(choice);
  publish(buildDialogState("closing", state));
}

export function respondToConfirmDialog(confirmed: boolean): void {
  respondToConfirmDialogChoice(confirmed ? "confirm" : "cancel");
}

export function completeConfirmDialogClose(): void {
  if (state.status !== "closing") return;

  const next = queuedConfirmations.shift();
  if (!next) {
    publish(idleState);
    return;
  }

  activeConfirmation = next;
  publish(buildDialogState("confirming", next));
}

export function resetConfirmDialogForTests(): void {
  listeners.clear();
  resolvePendingConfirmations();
  publish(idleState);
}
