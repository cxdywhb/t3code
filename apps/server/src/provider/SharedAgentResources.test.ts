import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";
import { readPortableResources } from "./SharedAgentResources.ts";

it.effect(
  "shares enabled global resources, resolves plugin paths and respects explicit overrides",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-shared-plugin-" });
      yield* fs.makeDirectory(path.join(root, ".codex-plugin"));
      yield* fs.writeFileString(
        path.join(root, ".codex-plugin/plugin.json"),
        JSON.stringify({ mcpServers: "./.mcp.json" }),
      );
      yield* fs.writeFileString(
        path.join(root, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            plugin: {
              command: "node",
              args: ["${CODEX_PLUGIN_ROOT}/server.js"],
              cwd: "${CODEX_PLUGIN_ROOT}",
              env: { PLUGIN_ROOT: "${CODEX_PLUGIN_ROOT}" },
            },
            disabled: { command: "node" },
            override: { command: "old-command" },
          },
        }),
      );
      const resources = yield* readPortableResources({
        pluginRoots: [root],
        environment: { KEY: "fixture-token", HOME: root },
        skills: [
          { name: "shared", path: "/skills/shared/SKILL.md", enabled: true, scope: "user" },
          { name: "disabled", path: "/skills/disabled/SKILL.md", enabled: false },
          { name: "project", path: "/project/SKILL.md", enabled: true, scope: "repo" },
        ],
        config: {
          mcp_servers: {
            disabled: { enabled: false },
            override: { command: "new-command", env_vars: ["KEY"] },
            remote: { url: "https://example.com/mcp", bearer_token_env_var: "KEY" },
            "t3-code": { command: "do-not-copy-credentials" },
            codex_apps: { url: "https://example.com/host-tools" },
            missing: { command: "fixture-token", env: { KEY: "${MISSING}" } },
            restricted: { command: "node", enabled_tools: ["read"] },
          },
        },
      });
      expect(resources.skills.map((skill) => skill.name)).toEqual(["shared"]);
      expect(resources.mcpServers).toEqual({
        plugin: {
          type: "stdio",
          command: "node",
          args: [`${root}/server.js`],
          cwd: root,
          env: { PLUGIN_ROOT: root },
        },
        override: {
          type: "stdio",
          command: "new-command",
          args: [],
          env: { KEY: "fixture-token" },
        },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer fixture-token" },
        },
      });
      expect(resources.warnings).toHaveLength(2);
      expect(resources.warnings[0]).toContain("missing");
      expect(resources.warnings[1]).toContain("tool restrictions");
      expect(resources.warnings.join("\n")).not.toContain("fixture-token");
    }).pipe(Effect.provide(NodeServices.layer)),
);
