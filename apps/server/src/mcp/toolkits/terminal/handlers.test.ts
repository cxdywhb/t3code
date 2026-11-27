import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  GLOBAL_TERMINAL_THREAD_ID,
  ProviderInstanceId,
  ThreadId,
  type RuntimeMode,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TerminalManager from "../../../terminal/Manager.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as TerminalHandlers from "./handlers.ts";
import { TerminalToolkit } from "./tools.ts";

const terminal: TerminalSummary = {
  threadId: GLOBAL_TERMINAL_THREAD_ID,
  terminalId: "build-logs",
  cwd: "/workspace",
  worktreePath: null,
  status: "running",
  pid: 123,
  exitCode: null,
  exitSignal: null,
  hasRunningSubprocess: false,
  label: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

it.effect.each(["full-access", "approval-required"] satisfies RuntimeMode[])(
  "reads a shared tab from another thread and gates opening in %s",
  (runtimeMode) => {
    const threadId = ThreadId.make("thread:another-project");
    const opened: unknown[] = [];
    const read: unknown[] = [];
    const dependencies = Layer.mergeAll(
      ThreadCommandExecutor.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:terminal"),
        requestNamespace: "provider:terminal",
        thread: {
          threadId,
          providerSessionId: "provider:terminal",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId, { runtimeMode })),
      }),
      Layer.mock(TerminalManager.TerminalManager)({
        listGlobal: Effect.succeed([terminal]),
        readGlobal: (input) =>
          Effect.sync(() => {
            read.push(input);
            return { terminal, text: "build complete", truncated: true };
          }),
        openGlobal: (input) =>
          Effect.sync(() => {
            opened.push(input);
            return terminal;
          }),
      }),
    );
    return Effect.gen(function* () {
      const toolkit = yield* TerminalToolkit;
      const result = <A, E, R>(effect: Effect.Effect<Stream.Stream<A, E, R>, E, R>) =>
        effect.pipe(Stream.unwrap, Stream.runCollect);
      const listed = yield* result(toolkit.handle("global_terminal_list", {}));
      expect(listed.at(-1)?.result).toEqual([terminal]);
      const output = yield* result(
        toolkit.handle("global_terminal_read", {
          terminalId: "build-logs",
          maxChars: 32,
        }),
      );
      expect(output.at(-1)?.result).toEqual({ terminal, text: "build complete", truncated: true });
      expect(read).toEqual([{ terminalId: "build-logs", maxChars: 32 }]);
      const openedResult = yield* result(
        toolkit.handle("global_terminal_open", {
          terminalId: "build-logs",
        }),
      );
      if (runtimeMode === "full-access") {
        expect(openedResult.at(-1)?.result).toEqual(terminal);
        expect(opened).toEqual([{ terminalId: "build-logs" }]);
      } else {
        expect(openedResult.at(-1)?.result).toMatchObject({ code: "capability_denied" });
        expect(opened).toEqual([]);
      }
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(TerminalHandlers.layer).pipe(
          Layer.provideMerge(dependencies),
        ),
      ),
    );
  },
);
