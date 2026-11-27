import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";
import { launchSharedMcp } from "./SharedMcpLauncher.ts";

it.effect(
  "launches in the plugin directory with literal arguments and cleans bridge-only environment",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-shared-launch-" });
      const file = path.join(root, "observed.json");
      const code =
        "require('node:fs').writeFileSync('observed.json', JSON.stringify({cwd:process.cwd(),arg:process.argv[1],key:process.env.KEY,launch:process.env.T3_SHARED_MCP_LAUNCH,electron:process.env.ELECTRON_RUN_AS_NODE}))";
      const status = yield* launchSharedMcp(
        JSON.stringify({
          command: process.execPath,
          args: ["-e", code, "literal $value with spaces"],
          cwd: root,
        }),
        {
          KEY: "fixture",
          T3_SHARED_MCP_LAUNCH: "internal",
          ELECTRON_RUN_AS_NODE: "1",
        },
      );
      expect(status).toBe(0);
      expect(JSON.parse(yield* fs.readFileString(file))).toEqual({
        cwd: yield* fs.realPath(root),
        arg: "literal $value with spaces",
        key: "fixture",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
);
