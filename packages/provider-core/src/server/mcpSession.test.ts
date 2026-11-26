import { describe, expect, it } from "vite-plus/test";
import { sharedMcpStdio, sharedSkillsContext, withAgentDeviceEnvironment } from "./mcpSession.ts";

it("bridges working directories and HTTP without placing credentials in arguments or skill context", () => {
  const self = { command: "/t3", entrypoint: undefined };
  const launch = sharedMcpStdio(
    {
      type: "stdio",
      command: "node",
      args: ["file with spaces.js"],
      cwd: "/plugin with spaces",
      env: { KEY: "fixture-secret" },
    },
    self,
  );
  expect(launch.args).toEqual(["shared-mcp-launch"]);
  expect(JSON.parse(launch.env.T3_SHARED_MCP_LAUNCH!)).toEqual({
    command: "node",
    args: ["file with spaces.js"],
    cwd: "/plugin with spaces",
  });
  const server = {
    type: "http" as const,
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer fixture-secret" },
  };
  const bridge = sharedMcpStdio(server, self);
  expect(bridge.args).toEqual(["acp-mcp-bridge"]);
  expect(JSON.parse(bridge.env.T3_ACP_MCP_HEADERS!)).toEqual(server.headers);
  const context = sharedSkillsContext({
    skills: [{ name: "demo", path: "/plugin/SKILL.md", enabled: true }],
    mcpServers: { demo: server },
    warnings: [],
  });
  expect(context).toContain("/plugin/SKILL.md");
  expect(context).not.toContain("fixture-secret");
});

describe("device CLI environment", () => {
  it("preserves provider credentials and commands while routing devices to the owned daemon", () => {
    const environment = withAgentDeviceEnvironment(
      { PATH: "/provider/bin:/usr/bin", PROVIDER_KEY: "fixture" },
      {
        agentDeviceEnvironment: {
          PATH: "/t3/device/bin",
          PATH_SEPARATOR: ":",
          AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
          AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
        },
      },
    );
    expect(environment).toEqual({
      PATH: "/t3/device/bin:/provider/bin:/usr/bin",
      PROVIDER_KEY: "fixture",
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
    });
  });

  it("does not grant CLI access when device access was not supplied", () => {
    const environment = { PATH: "/usr/bin", PROVIDER_KEY: "fixture" };
    expect(withAgentDeviceEnvironment(environment, undefined)).toBe(environment);
    expect(withAgentDeviceEnvironment(environment, {})).toBe(environment);
  });
});
