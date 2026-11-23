import { expect, it, vi } from "vite-plus/test";
import * as Dialog from "../../components/ui/Dialog";
import { confirmToolApproval } from "./confirmToolApproval";

vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));

it("cancels a detached document's approval and ignores its late answer", async () => {
  const document = new AbortController();
  const decision = confirmToolApproval("Write", "details", document.signal, true);
  const buttons = vi.mocked(Dialog.alert).mock.lastCall![2]!;
  document.abort();
  buttons[1]!.onPress?.();
  expect(await decision).toBeUndefined();
});

it("distinguishes a replaced alert from an explicit refusal", async () => {
  const { signal } = new AbortController();
  const replaced = confirmToolApproval("Write", "details", signal, true);
  vi.mocked(Dialog.alert).mock.lastCall![3]!.onDismiss?.();
  expect(await replaced).toBeUndefined();

  const refused = confirmToolApproval("Write", "details", signal, true);
  vi.mocked(Dialog.alert).mock.lastCall![2]![0]!.onPress?.();
  expect(await refused).toBe("decline");
});

it("offers only a single use when the server cannot identify the connection", async () => {
  const decision = confirmToolApproval("Write", "details", new AbortController().signal, false);
  const buttons = vi.mocked(Dialog.alert).mock.lastCall![2]!;
  expect(buttons).toHaveLength(2);
  buttons[1]!.onPress?.();
  expect(await decision).toBe("allow-once");
});
