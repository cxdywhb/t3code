import type {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  ServerProviderSkill,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import { selfInvocationArgs, type SelfInvocation } from "@t3tools/shared/nodeRuntime";

/**
 * Sent by MCP clients that cannot defer tools themselves. The T3 MCP server then
 * lists only a core set plus `tool_search`, which lists the rest on demand.
 */
export const MCP_TOOL_EXPOSURE_HEADER = "t3-tool-exposure";

export type SharedMcpServer =
  | {
      readonly type: "stdio";
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly type: "http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

export interface SharedAgentResources {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly mcpServers: Readonly<Record<string, SharedMcpServer>>;
  readonly warnings: ReadonlyArray<string>;
}

export function sharedMcpStdio(
  server: SharedMcpServer,
  self: SelfInvocation,
): Extract<SharedMcpServer, { type: "stdio" }> {
  if (server.type === "stdio" && server.cwd === undefined) return server;
  return {
    type: "stdio" as const,
    command: self.command,
    args: selfInvocationArgs(self, [
      server.type === "http" ? "acp-mcp-bridge" : "shared-mcp-launch",
    ]),
    env:
      server.type === "http"
        ? {
            ELECTRON_RUN_AS_NODE: "1",
            T3_ACP_MCP_ENDPOINT: server.url,
            T3_ACP_MCP_AUTHORIZATION: "",
            T3_ACP_MCP_HEADERS: JSON.stringify(server.headers),
          }
        : {
            ...server.env,
            ELECTRON_RUN_AS_NODE: "1",
            T3_SHARED_MCP_LAUNCH: JSON.stringify({
              command: server.command,
              args: server.args,
              cwd: server.cwd,
            }),
          },
  };
}

export function sharedSkillsContext(
  resources: SharedAgentResources | undefined,
): string | undefined {
  if (!resources || (resources.skills.length === 0 && resources.warnings.length === 0))
    return undefined;
  return [
    "## Shared skills",
    "These enabled skills are shared from Codex on this environment. When relevant, read the listed SKILL.md and follow its instructions. Resolve relative resources from that skill directory. Prefer an agent's native skill when the same name exists. Shared MCP servers use the shared_codex_ prefix. Host-specific tools or authorization may still require setup; do not assume they are available.",
    ...resources.skills.map((skill) =>
      JSON.stringify({ name: skill.name, description: skill.description, path: skill.path }),
    ),
    ...resources.warnings,
  ].join("\n");
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /** Omit preview_* instructions when the user withholds agent browser access. */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  readonly sharedResources?: SharedAgentResources;
  /** True while a delegated task this thread started will wake it with its result. */
  readonly hasPendingWake?: Effect.Effect<boolean>;
}

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}
