import { useAtomValue } from "@effect/atom-react";
import { AuthTerminalReadScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { SquareTerminalIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useEffectEvent, useRef } from "react";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { toastManager } from "../ui/toast";
import { ToolbarButton } from "../ui/toggle";
import { showGlobalTerminal, useGlobalTerminalStore } from "./globalTerminalStore";

import { useGlobalTerminalEnvironmentId } from "./globalTerminalTarget";

const GlobalTerminalPanel = lazy(() =>
  import("./GlobalTerminalPanel").then((module) => ({ default: module.GlobalTerminalPanel })),
);

export function GlobalTerminalButton() {
  const gt = useGT();
  const environmentId = useGlobalTerminalEnvironmentId();
  const label = gt("Global terminal");
  return (
    <SharedTooltipTrigger render={<span className="flex shrink-0" />} label={label} side="bottom">
      <ToolbarButton
        disabled={!environmentId}
        aria-label={label}
        onClick={() => {
          if (environmentId)
            void showGlobalTerminal(environmentId).catch(() =>
              toastManager.add({ type: "error", title: gt("Could not open the global terminal") }),
            );
        }}
      >
        <SquareTerminalIcon className="size-4" />
      </ToolbarButton>
    </SharedTooltipTrigger>
  );
}

function GlobalTerminalReveal({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const feed = useAtomValue(terminalEnvironment.metadataFeed({ environmentId, input: null }));
  const request = AsyncResult.isSuccess(feed) ? feed.value.revealRequest : undefined;
  const lastRequest = useRef<string | undefined>(undefined);
  const reportFailure = useEffectEvent(() =>
    toastManager.add({ type: "error", title: gt("Could not open the global terminal") }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals the native window when the server publishes an agent's open request
  useEffect(() => {
    if (request === undefined || request.id === lastRequest.current) return;
    lastRequest.current = request.id;
    void showGlobalTerminal(environmentId, request.terminalId).catch(reportFailure);
  }, [environmentId, request]);
  return null;
}

export function GlobalTerminalHost() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthTerminalReadScope);
  const target = useGlobalTerminalStore((state) => state.target);
  return (
    <>
      {[...readable].map((environmentId) => (
        <GlobalTerminalReveal key={environmentId} environmentId={environmentId} />
      ))}
      {target ? (
        <div className="fixed bottom-4 right-4 z-50 flex h-96 max-h-[90dvh] w-[min(54rem,95vw)] min-w-72 resize flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-1">
            <span className="text-sm font-medium">
              <T>Global terminal</T>
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={gt("Hide global terminal")}
              onClick={() => useGlobalTerminalStore.setState({ target: null })}
            >
              <XIcon />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={null}>
              <GlobalTerminalPanel key={target.environmentId} {...target} />
            </Suspense>
          </div>
        </div>
      ) : null}
    </>
  );
}
