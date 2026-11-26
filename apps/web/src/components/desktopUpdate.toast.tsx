import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { msg, T } from "gt-react";
import { ArrowRightIcon, FolderOpenIcon } from "lucide-react";

import { requestChoiceConfirmDialog } from "../confirmDialog";
import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateInstallConfirmationMessage,
  getDesktopUpdateReleaseUrl,
} from "./desktopUpdate.logic";
import { m } from "../i18n/messages";
import { ensureLocalApi } from "../localApi";
import { toastManager } from "./ui/toast";

type DesktopUpdateShell = Pick<DesktopBridge, "openExternal" | "revealDownloadedUpdate">;

export async function openDesktopUpdateReleaseNotes(
  shell: Pick<DesktopBridge, "openExternal"> | undefined,
  releaseUrl: string,
): Promise<void> {
  try {
    if (shell && (await shell.openExternal(releaseUrl))) return;
  } catch {}
  toastManager.add({ type: "error", title: m(msg("Unable to open release notes")) });
}

export async function revealDesktopUpdateFolder(
  shell: Pick<DesktopBridge, "revealDownloadedUpdate"> | undefined,
): Promise<void> {
  try {
    if (shell?.revealDownloadedUpdate && (await shell.revealDownloadedUpdate())) return;
  } catch {}
  toastManager.add({ type: "error", title: m(msg("Unable to open update folder")) });
}

export async function confirmDesktopUpdateInstall(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  bridge: Pick<DesktopBridge, "revealDownloadedUpdate"> | undefined,
): Promise<boolean> {
  const message = getDesktopUpdateInstallConfirmationMessage(state);
  const canReveal =
    state.downloadedVersion !== null && typeof bridge?.revealDownloadedUpdate === "function";
  if (canReveal && bridge) {
    const choicePromise = requestChoiceConfirmDialog(message, {
      initialFocus: "confirm",
      secondaryLabel: m(msg("Open local folder")),
      onSecondaryAction: () => {
        void revealDesktopUpdateFolder(bridge);
      },
    });
    if (choicePromise !== undefined) {
      return (await choicePromise) === "confirm";
    }
  }
  return ensureLocalApi().dialogs.confirm(message, { initialFocus: "confirm" });
}

function ReleaseNotesLink({
  shell,
  releaseUrl,
}: {
  shell: Pick<DesktopBridge, "openExternal">;
  releaseUrl: string;
}) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void openDesktopUpdateReleaseNotes(shell, releaseUrl);
      }}
      type="button"
    >
      <T>Read more</T>
      <ArrowRightIcon
        aria-hidden
        className="ml-1 inline size-3 -rotate-45 align-[-0.125em]"
        strokeWidth={2.25}
      />
    </button>
  );
}

function OpenUpdateFolderLink({ shell }: { shell: Pick<DesktopBridge, "revealDownloadedUpdate"> }) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void revealDesktopUpdateFolder(shell);
      }}
      type="button"
    >
      <FolderOpenIcon aria-hidden className="mr-1 inline size-3 align-[-0.125em]" strokeWidth={2} />
      <T>Open local folder</T>
    </button>
  );
}

export function showDesktopUpdateDownloadedToast(
  shell: DesktopUpdateShell,
  state: DesktopUpdateState,
): void {
  const downloadedVersion = getDesktopUpdateDownloadedVersion(state);
  const releaseUrl = getDesktopUpdateReleaseUrl(downloadedVersion);
  const canReveal =
    downloadedVersion !== null && typeof shell.revealDownloadedUpdate === "function";
  toastManager.add({
    type: "success",
    title: m(msg("Update downloaded")),
    description: (
      <>
        <T>Restart the app from the update button to install it.</T>
        {canReveal ? <OpenUpdateFolderLink shell={shell} /> : null}
        {releaseUrl ? <ReleaseNotesLink releaseUrl={releaseUrl} shell={shell} /> : null}
      </>
    ),
  });
}
