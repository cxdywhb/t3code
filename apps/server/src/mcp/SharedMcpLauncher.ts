import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const Launch = Schema.fromJsonString(
  Schema.Struct({
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
  }),
);

const decodeLaunch = Schema.decodeEffect(Launch);

export const launchSharedMcp = Effect.fn("SharedMcpLauncher.launch")(function* (
  configuration: string,
  environment: NodeJS.ProcessEnv,
) {
  const launch = yield* decodeLaunch(configuration);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { T3_SHARED_MCP_LAUNCH: _launch, ELECTRON_RUN_AS_NODE: _electron, ...env } = environment;
  const command = yield* resolveSpawnCommand(launch.command, launch.args, {
    env,
    extendEnv: false,
  });
  return yield* spawner.exitCode(
    ChildProcess.make(command.command, command.args, {
      shell: command.shell,
      cwd: launch.cwd,
      env,
      extendEnv: false,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
});

export async function runSharedMcpLauncher(): Promise<void> {
  // 凭据和参数经环境传递，错误输出不得回显配置。
  process.exitCode = await Effect.runPromise(
    launchSharedMcp(process.env.T3_SHARED_MCP_LAUNCH ?? "", process.env).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer),
      Effect.catch(() =>
        Effect.sync(() => {
          process.stderr.write(
            "Could not start shared MCP server. Check its command and working directory.\n",
          );
          return 1;
        }),
      ),
    ),
  );
}
