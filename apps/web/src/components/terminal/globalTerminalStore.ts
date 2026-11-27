import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

export const useGlobalTerminalStore = create<{
  target: { environmentId: EnvironmentId; terminalId?: string } | null;
}>(() => ({ target: null }));

export async function showGlobalTerminal(environmentId: EnvironmentId, terminalId?: string) {
  const target = { environmentId, ...(terminalId === undefined ? {} : { terminalId }) };
  if (window.desktopBridge?.openGlobalTerminal) {
    await window.desktopBridge.openGlobalTerminal(target);
  } else {
    useGlobalTerminalStore.setState({ target });
  }
}

export const isGlobalTerminalWindow = () => window.location.hash.startsWith("#/global-terminal/");
