import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as TerminalManager from "../../../terminal/Manager.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { TerminalToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(TerminalToolkit, {
  global_terminal_list: McpToolAccess.readsAsCaller(() =>
    Effect.flatMap(TerminalManager.TerminalManager, (manager) => manager.listGlobal),
  ),
  global_terminal_open: McpToolAccess.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      const manager = yield* TerminalManager.TerminalManager;
      yield* check;
      return yield* manager
        .openGlobal(input)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
    }),
  ),
  global_terminal_read: McpToolAccess.readsAsCaller((input) =>
    Effect.flatMap(TerminalManager.TerminalManager, (manager) => manager.readGlobal(input)).pipe(
      Effect.mapError(
        (error) => new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
      ),
    ),
  ),
});
