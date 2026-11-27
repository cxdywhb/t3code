import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { DraftId } from "../../composerDraftStore";
import { render } from "../../../test/render";
import type { ThreadRouteTarget } from "../../threadRoutes";

const state = vi.hoisted(() => ({
  target: null as ThreadRouteTarget | null,
  allowed: true,
  draftEnvironmentId: null as EnvironmentId | null,
}));
const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
vi.mock(import("../../hooks/useThreadRouteTarget"), () => ({
  useThreadRouteTarget: () => state.target,
}));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironmentId: () => local,
  readPrimaryEnvironmentId: () => local,
}));
vi.mock(import("../../state/session"), () => ({
  useEnvironmentScope: () => state.allowed,
  readEnvironmentScope: () => state.allowed,
}));
vi.mock(
  import("./globalTerminalStore"),
  () => ({ showGlobalTerminal: vi.fn().mockResolvedValue(undefined) }) as never,
);

import { GlobalTerminalButton } from "./GlobalTerminal";
import { showGlobalTerminal } from "./globalTerminalStore";
import { readGlobalTerminalEnvironmentId } from "./globalTerminalTarget";
import { useComposerDraftStore } from "../../composerDraftStore";

it("opens the viewed remote environment and stays disabled without its terminal permission", async () => {
  state.target = {
    kind: "server",
    threadRef: { environmentId: remote, threadId: ThreadId.make("thread") },
  };
  state.allowed = true;
  vi.mocked(showGlobalTerminal).mockClear();
  await using screen = await render(<GlobalTerminalButton />);
  using _draft = vi
    .spyOn(useComposerDraftStore.getState(), "getDraftSession")
    .mockImplementation(() =>
      state.draftEnvironmentId ? ({ environmentId: state.draftEnvironmentId } as never) : null,
    );
  const button = screen.getByRole("button", { name: "Global terminal" });
  await button.click();
  expect(showGlobalTerminal).toHaveBeenCalledWith(remote);
  expect(readGlobalTerminalEnvironmentId(state.target)).toBe(remote);
  state.allowed = false;
  await screen.rerender(<GlobalTerminalButton />);
  await expect.element(button).toBeDisabled();
  expect(readGlobalTerminalEnvironmentId(state.target)).toBeNull();
  state.allowed = true;
  state.target = { kind: "draft", draftId: DraftId.make("draft") };
  state.draftEnvironmentId = remote;
  await screen.rerender(<GlobalTerminalButton />);
  await button.click();
  expect(showGlobalTerminal).toHaveBeenLastCalledWith(remote);
  expect(readGlobalTerminalEnvironmentId(state.target)).toBe(remote);
  state.draftEnvironmentId = null;
  await screen.rerender(<GlobalTerminalButton />);
  await expect.element(button).toBeDisabled();
  expect(readGlobalTerminalEnvironmentId(state.target)).toBeNull();
  state.target = null;
  state.allowed = true;
  await screen.rerender(<GlobalTerminalButton />);
  await button.click();
  expect(showGlobalTerminal).toHaveBeenLastCalledWith(local);
  expect(readGlobalTerminalEnvironmentId(state.target)).toBe(local);
});
