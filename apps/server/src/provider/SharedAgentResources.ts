import {
  CodexSettings,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { OpenCodeSettings } from "@t3tools/provider-opencode/settings";
import {
  sharedMcpStdio,
  type SharedAgentResources as Resources,
  type SharedMcpServer,
} from "@t3tools/provider-core/server/mcpSession";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerSettings from "../serverSettings.ts";
import { makeCodexResourcesProbe } from "./CodexProvider.ts";

const Strings = Schema.Record(Schema.String, Schema.String);
const McpConfig = Schema.Struct({
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Strings),
  env_vars: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Strings),
  http_headers: Schema.optional(Strings),
  env_http_headers: Schema.optional(Strings),
  bearer_token_env_var: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  disabled: Schema.optional(Schema.Boolean),
  enabled_tools: Schema.optional(Schema.Array(Schema.String)),
  disabled_tools: Schema.optional(Schema.Array(Schema.String)),
});
const decodeConfig = Schema.decodeUnknownSync(McpConfig);
const CodexConfig = Schema.Struct({
  mcp_servers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const PluginManifest = Schema.Struct({
  mcpServers: Schema.optional(
    Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]),
  ),
});
const McpFile = Schema.Struct({ mcpServers: Schema.Record(Schema.String, Schema.Unknown) });
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodePlugin = Schema.decodeUnknownEffect(PluginManifest);
const decodeMcpFile = Schema.decodeUnknownEffect(McpFile);
const decodeCodexConfig = Schema.decodeUnknownEffect(CodexConfig);
const decodeCodexSettings = Schema.decodeEffect(CodexSettings);
const decodeOpenCodeSettings = Schema.decodeEffect(OpenCodeSettings);
const empty: Resources = { skills: [], mcpServers: {}, warnings: [] };

export class SharedAgentResources extends Context.Service<
  SharedAgentResources,
  {
    readonly read: Effect.Effect<Resources>;
    readonly skillsFor: (
      provider: Pick<ServerProvider, "instanceId" | "driver">,
    ) => Effect.Effect<ReadonlyArray<ServerProviderSkill>>;
    readonly changes: Stream.Stream<boolean>;
  }
>()("t3/provider/SharedAgentResources") {}

export const readPortableResources = Effect.fn("SharedAgentResources.readPortable")(
  function* (input: {
    readonly skills: ReadonlyArray<ServerProviderSkill>;
    readonly config: unknown;
    readonly pluginRoots: ReadonlyArray<string>;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mcpServers: Record<string, SharedMcpServer> = {};
    const warnings: string[] = [];
    const add = (name: string, value: unknown, root?: string) => {
      // T3 的凭据仅属于当前会话；宿主工具与 OAuth 会话也不能跨 Agent 复制。
      if (
        name === "t3-code" ||
        name === "t3_code_direct" ||
        name === "codex_apps" ||
        name.startsWith("t3-code-")
      )
        return;
      delete mcpServers[name];
      try {
        const config = decodeConfig(value);
        if (config.enabled === false || config.disabled === true) return;
        if (config.enabled_tools !== undefined || (config.disabled_tools?.length ?? 0) > 0) {
          warnings.push(
            `MCP ${name} has tool restrictions that must be configured in the target agent before sharing.`,
          );
          return;
        }
        const expand = (value: string): string =>
          value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, key: string) => {
            const resolved = ["CODEX_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT"].includes(
              key,
            )
              ? root
              : input.environment[key];
            if (resolved === undefined) throw new Error("Missing environment variable");
            return resolved;
          });
        if (config.command) {
          const env = Object.fromEntries(
            Object.entries(config.env ?? {}).map(([key, value]) => [key, expand(value)]),
          );
          for (const key of config.env_vars ?? []) {
            const value = input.environment[key];
            if (value === undefined) throw new Error("Missing environment variable");
            env[key] = value;
          }
          mcpServers[name] = {
            type: "stdio",
            command: expand(config.command),
            args: (config.args ?? []).map(expand),
            env,
            ...(config.cwd
              ? { cwd: path.resolve(root ?? input.environment.HOME ?? ".", expand(config.cwd)) }
              : {}),
          };
        } else if (config.url && config.type !== "sse") {
          const url = expand(config.url);
          if (!["https:", "http:"].includes(new URL(url).protocol))
            throw new Error("Unsupported URL");
          const headers = Object.fromEntries(
            Object.entries(config.http_headers ?? config.headers ?? {}).map(([key, value]) => [
              key,
              expand(value),
            ]),
          );
          for (const [key, variable] of Object.entries(config.env_http_headers ?? {})) {
            const value = input.environment[variable];
            if (value === undefined) throw new Error("Missing HTTP credential");
            headers[key] = value;
          }
          if (config.bearer_token_env_var) {
            const token = input.environment[config.bearer_token_env_var];
            if (token === undefined) throw new Error("Missing bearer token");
            headers.Authorization = `Bearer ${token}`;
          }
          mcpServers[name] = { type: "http", url, headers };
        } else {
          warnings.push(`MCP ${name} uses a transport that cannot be shared.`);
        }
      } catch {
        // 配置可能含密钥，诊断仅保留名称，不输出解析器携带的原始值。
        warnings.push(
          `MCP ${name} could not be shared. Check its configuration and environment variables.`,
        );
      }
    };
    for (const root of input.pluginRoots) {
      const readJson = (file: string) => fs.readFileString(file).pipe(Effect.flatMap(decodeJson));
      const result = yield* Effect.gen(function* () {
        const manifest = yield* readJson(path.join(root, ".codex-plugin", "plugin.json")).pipe(
          Effect.flatMap(decodePlugin),
        );
        const source = manifest.mcpServers;
        if (typeof source === "object") return source;
        const configPath = path.resolve(root, source ?? ".mcp.json");
        const relative = path.relative(root, configPath);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          return {};
        if (!(yield* fs.exists(configPath))) return {};
        return (yield* readJson(configPath).pipe(Effect.flatMap(decodeMcpFile))).mcpServers;
      }).pipe(
        Effect.catch(() => {
          warnings.push(
            `Plugin ${path.basename(path.dirname(root))} MCP configuration could not be read.`,
          );
          return Effect.succeed({});
        }),
      );
      for (const [name, value] of Object.entries(result)) add(name, value, root);
    }
    const config = yield* decodeCodexConfig(input.config);
    for (const [name, value] of Object.entries(config.mcp_servers ?? {})) add(name, value);
    return {
      skills: input.skills.filter((skill) => skill.enabled && skill.scope !== "repo"),
      mcpServers,
      warnings,
    } satisfies Resources;
  },
);

export const layer = Layer.effect(
  SharedAgentResources,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    const environment = yield* HostProcess.Environment;
    const probe = yield* makeCodexResourcesProbe(home);
    const self = yield* resolveSelfInvocation();
    const read = Effect.gen(function* () {
      const current = yield* settings.getSettings;
      if (!current.shareCodexResources) return empty;
      const configured = current.providerInstances[ProviderInstanceId.make("codex")];
      const config = yield* decodeCodexSettings(configured?.config ?? {});
      const codexHome = expandHomePath(
        config.homePath?.trim() || environment.CODEX_HOME || path.join(home, ".codex"),
        home,
      );
      // 用 home 作发现范围，避免把某个工作区的私有插件和凭据分享给其他项目。
      const discovered = yield* probe({
        binaryPath: config.binaryPath,
        homePath: codexHome,
        launchArgs: config.launchArgs,
        cwd: home,
      }).pipe(Effect.timeout("20 seconds"));
      const roots = new Set<string>();
      for (const marketplace of discovered.plugins) {
        for (const plugin of marketplace.plugins) {
          if (!plugin.installed || !plugin.enabled || plugin.availability === "DISABLED_BY_ADMIN")
            continue;
          if (plugin.localVersion) {
            const root = path.join(
              codexHome,
              "plugins",
              "cache",
              marketplace.name,
              plugin.name,
              plugin.localVersion,
            );
            if (yield* fs.exists(path.join(root, ".codex-plugin", "plugin.json"))) roots.add(root);
          }
          if (
            plugin.source.type === "local" &&
            (yield* fs.exists(path.join(plugin.source.path, ".codex-plugin", "plugin.json")))
          )
            roots.add(plugin.source.path);
        }
      }
      // 技能列表给出实际启用版本的路径，也覆盖以内容哈希命名的插件缓存。
      const scanned = new Set<string>();
      for (const skill of discovered.skills.filter((skill) => skill.enabled)) {
        let directory = path.dirname(skill.path);
        while (directory !== path.dirname(directory) && !scanned.has(directory)) {
          scanned.add(directory);
          if (yield* fs.exists(path.join(directory, ".codex-plugin", "plugin.json"))) {
            roots.add(directory);
            break;
          }
          directory = path.dirname(directory);
        }
      }
      const resources = yield* readPortableResources({
        ...discovered,
        pluginRoots: [...roots],
        environment: { ...environment, HOME: home, CODEX_HOME: codexHome },
      });
      return {
        ...resources,
        mcpServers: Object.fromEntries(
          Object.entries(resources.mcpServers).map(([name, server]) => [
            `shared_codex_${name}`,
            server.type === "stdio" && server.cwd !== undefined
              ? sharedMcpStdio(server, self)
              : server,
          ]),
        ),
      };
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.catch(() =>
        Effect.logWarning("Shared Codex resources could not be read").pipe(
          Effect.as({
            ...empty,
            warnings: [
              "Shared Codex skills and MCP servers could not be loaded. Check the source Codex configuration.",
            ],
          }),
        ),
      ),
    );
    return SharedAgentResources.of({
      read,
      changes: settings.streamChanges.pipe(
        Stream.map((settings) => settings.shareCodexResources),
        Stream.changes,
      ),
      skillsFor: Effect.fn("SharedAgentResources.skillsFor")(
        function* (provider) {
          // Codex 保留原生发现；外部 OpenCode 服务无法读取本机技能路径。
          if (provider.driver === "codex") return [];
          const current = yield* settings.getSettings;
          if (!current.shareCodexResources) return [];
          if (provider.driver === "opencode") {
            const config = yield* decodeOpenCodeSettings(
              current.providerInstances[provider.instanceId]?.config ?? {},
            );
            if (config.serverUrl.trim()) return [];
          }
          return (yield* read).skills;
        },
        Effect.catch(() =>
          Effect.logWarning("Shared Codex skill catalog could not be loaded").pipe(Effect.as([])),
        ),
      ),
    });
  }),
);
