import type { McpAppToolApprovalDecision } from "@t3tools/client-runtime/mcp-apps/tool-approval";
import { msg } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";

export function confirmToolApproval(
  title: string,
  message: string,
  signal: AbortSignal,
  allowSession: boolean,
): Promise<McpAppToolApprovalDecision | undefined> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(undefined);
      return;
    }
    const settle = (decision?: McpAppToolApprovalDecision) => {
      signal.removeEventListener("abort", onDismiss);
      resolve(decision);
    };
    const onDismiss = () => settle();
    signal.addEventListener("abort", onDismiss, { once: true });
    Dialog.alert(
      title,
      message,
      [
        { text: m(msg("Cancel")), style: "cancel", onPress: () => settle("decline") },
        ...(allowSession
          ? [{ text: m(msg("Always allow this session")), onPress: () => settle("allow-session") }]
          : []),
        { text: m(msg("Allow once")), onPress: () => settle("allow-once") },
      ],
      { cancelable: true, onDismiss },
    );
  });
}
