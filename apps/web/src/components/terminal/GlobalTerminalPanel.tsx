import { useAtomValue } from "@effect/atom-react";
import {
  AuthTerminalOperateScope,
  GLOBAL_TERMINAL_THREAD_ID,
  ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { T, useGT } from "gt-react";
import { PinIcon, PinOffIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useEnvironmentScope } from "../../state/session";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { confirmTerminalClose } from "../../lib/terminalCloseConfirm";

const globalThreadId = ThreadId.make(GLOBAL_TERMINAL_THREAD_ID);

export function GlobalTerminalPanel({
  environmentId,
  terminalId,
}: {
  environmentId: EnvironmentId;
  terminalId?: string | undefined;
}) {
  const gt = useGT();
  const [selected, setSelected] = useState(terminalId);
  const [requested, setRequested] = useState(terminalId);
  if (requested !== terminalId) {
    setRequested(terminalId);
    setSelected(terminalId);
  }
  const [pinned, setPinned] = useState(true);
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const tabs = useKnownTerminalSessions({ environmentId, threadId: globalThreadId }) ?? [];
  const active = tabs.find((tab) => tab.target.terminalId === selected) ?? tabs[0];
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const open = useAtomCommand(terminalEnvironment.openGlobal);
  const close = useAtomCommand(terminalEnvironment.close);
  const newTab = async () => {
    const result = await open({ environmentId, input: {} });
    if (result._tag === "Success") setSelected(result.value.terminalId);
  };
  const closeTab = async (id: string) => {
    if (await confirmTerminalClose([id]))
      await close({
        environmentId,
        input: { threadId: globalThreadId, terminalId: id, deleteHistory: true },
      });
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={gt("Global terminal")}
    >
      <header className="flex shrink-0 items-center gap-1 border-b p-1">
        <div
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          role="tablist"
          aria-label={gt("Global terminal tabs")}
        >
          {tabs.map((tab, index) => (
            <div key={tab.target.terminalId} className="flex shrink-0 items-center">
              <button
                type="button"
                role="tab"
                aria-selected={active === tab}
                aria-controls="global-terminal-content"
                id={`global-terminal-tab-${index}`}
                tabIndex={active === tab ? 0 : -1}
                onKeyDown={(event) => {
                  const offset =
                    event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (offset === 0 && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index + offset + tabs.length) % tabs.length;
                  setSelected(tabs[next]!.target.terminalId);
                  document.getElementById(`global-terminal-tab-${next}`)?.focus();
                }}
                onClick={() => setSelected(tab.target.terminalId)}
                className="rounded px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-accent aria-selected:text-foreground"
              >
                {tab.target.terminalId}
              </button>
              {canOperate ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Close terminal {name}", { name: tab.target.terminalId })}
                  onClick={() => {
                    void closeTab(tab.target.terminalId);
                  }}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {canOperate ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("New terminal")}
            onClick={() => {
              void newTab();
            }}
          >
            <PlusIcon />
          </Button>
        ) : null}
        {window.desktopBridge?.setGlobalTerminalPinned ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={pinned ? gt("Unpin terminal window") : gt("Keep terminal above other apps")}
            aria-pressed={pinned}
            onClick={() => {
              void window.desktopBridge!.setGlobalTerminalPinned!(!pinned)
                .then(() => setPinned(!pinned))
                .catch(() =>
                  toastManager.add({
                    type: "error",
                    title: gt("Could not change terminal window pin"),
                  }),
                );
            }}
          >
            {pinned ? <PinIcon /> : <PinOffIcon />}
          </Button>
        ) : null}
      </header>
      <div
        id="global-terminal-content"
        role="tabpanel"
        aria-labelledby={active ? `global-terminal-tab-${tabs.indexOf(active)}` : undefined}
        className="relative min-h-0 flex-1"
      >
        {active ? (
          <TerminalViewport
            key={active.target.terminalId}
            advancedTypography={false}
            threadRef={scopeThreadRef(environmentId, globalThreadId)}
            threadId={globalThreadId}
            terminalId={active.target.terminalId}
            terminalLabel={active.target.terminalId}
            cwd={active.state.summary!.cwd}
            visible
            autoFocus
            keybindings={keybindings}
            onSessionExited={() => {}}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
            <p>
              <T>Share terminals across projects and conversations.</T>
            </p>
            {canOperate ? (
              <Button
                variant="outline"
                onClick={() => {
                  void newTab();
                }}
              >
                <T>New terminal</T>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
