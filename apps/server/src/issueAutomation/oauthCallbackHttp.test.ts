import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { IssueAutomationPlatformKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { vi } from "vite-plus/test";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { McpAuthorization } from "./IssueAutomationMcp.ts";
import * as IssueAutomationRepository from "./IssueAutomationRepository.ts";
import * as IssueAutomationService from "./IssueAutomationService.ts";
import * as OAuthCallbackHttp from "./oauthCallbackHttp.ts";
import type { IssuePlatformPlugin } from "./plugin/IssuePlatformPlugin.ts";
import * as PluginRegistry from "./plugin/PluginRegistry.ts";

it.effect("returns through the HTTP callback and saves the connection only once", () =>
  Effect.gen(function* () {
    const platform = IssueAutomationPlatformKind.make("zentao");
    const scope = { id: "5", name: "Example App" };
    const plugin = {
      kind: platform,
      descriptor: {
        platform,
        displayName: "ZenTao",
        description: "",
        implemented: true,
        scopeNoun: "Product",
        issueNoun: "Bug",
        authFields: [],
      },
      normalizeBaseUrl: (url) => url,
      probeAndListScopes: ({ withClient }) =>
        withClient("fixture.probe", async () => ({ writeActions: [], scopes: [scope] })),
      listIssues: () => Effect.die("unexpected issue listing"),
      getIssueDetail: () => Effect.die("unexpected issue detail"),
      writeBack: () => Effect.die("unexpected write-back"),
    } satisfies IssuePlatformPlugin;

    const grant = vi.fn();
    const client = new Client({ name: "fixture", version: "1" });
    using _exchange = vi
      .spyOn(McpAuthorization.prototype, "withClient")
      .mockImplementation(async function <A>(
        this: McpAuthorization,
        _signal: AbortSignal,
        run: (client: Client) => Promise<A>,
        code?: string,
      ) {
        if (code === undefined) {
          const authorization = new URL("https://mcp.example.test/authorize");
          authorization.searchParams.set("redirect_uri", this.redirectUri);
          this.authorizationUrl = authorization.href;
          throw new Error("The MCP service requires authorization");
        }
        grant(code);
        return run(client);
      });
    using _credential = vi.spyOn(McpAuthorization.prototype, "credentials", "get").mockReturnValue({
      client: { client_id: "fixture" },
      tokens: { access_token: "fixture-access", token_type: "Bearer" },
    });

    const dependencies = Layer.mergeAll(
      IssueAutomationRepository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
      Layer.succeed(PluginRegistry.IssuePlatformPluginRegistry, {
        descriptors: [plugin.descriptor],
        get: () => plugin,
        requirePlugin: () => Effect.succeed(plugin),
      }),
      ServerSecretStore.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-issue-oauth-" })),
        Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
      ),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(GitWorkflow.GitWorkflowService)({}),
      Layer.mock(ThreadIssueService.ThreadIssueService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      FetchHttpClient.layer,
    );

    yield* Effect.gen(function* () {
      const service = yield* IssueAutomationService.IssueAutomationService;
      const { handler } = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            OAuthCallbackHttp.layer.pipe(
              Layer.provide(Layer.succeed(IssueAutomationService.IssueAutomationService, service)),
            ),
            { disableLogger: true },
          ),
        ),
        ({ dispose }) => Effect.promise(dispose),
      );
      const request = (url: URL) => new Request(url, { headers: { host: url.host } });
      const start = service.startConnectorAuth({
        name: "Fixture",
        platform,
        mcpUrl: "https://mcp.example.test/zentao/mcp",
        baseUrl: "",
        callbackBaseUrl: "http://127.0.0.1:5734",
      });
      const attempt = yield* start;
      const callback = new URL(new URL(attempt.authorizationUrl).searchParams.get("redirect_uri")!);
      expect(attempt.automatic).toBe(true);
      expect(callback.origin).toBe("http://127.0.0.1:5734");
      expect(callback.pathname).toBe("/oauth/issue-automation/callback");
      callback.searchParams.set("state", attempt.attemptId);
      callback.searchParams.set("code", "fixture-code");

      const foreign = new URL(callback.href);
      foreign.port = "5735";
      expect((yield* Effect.promise(() => handler(request(foreign)))).status).toBe(400);
      const response = yield* Effect.promise(() => handler(request(callback)));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(yield* Effect.promise(() => response.text())).not.toContain("fixture-code");
      const connector = yield* service.finishConnectorAuth({ attemptId: attempt.attemptId });
      expect(connector).toMatchObject({ status: "connected", scopes: [scope] });
      expect((yield* service.getState).connectors).toEqual([connector]);
      expect((yield* Effect.promise(() => handler(request(callback)))).status).toBe(400);
      expect(grant).toHaveBeenCalledExactlyOnceWith("fixture-code");

      const denied = yield* start;
      const pending = yield* service
        .finishConnectorAuth({ attemptId: denied.attemptId })
        .pipe(Effect.result, Effect.forkChild);
      callback.searchParams.delete("code");
      callback.searchParams.set("state", denied.attemptId);
      callback.searchParams.set("error", "access_denied");
      expect((yield* Effect.promise(() => handler(request(callback)))).status).toBe(400);
      expect(yield* Fiber.join(pending)).toMatchObject({
        _tag: "Failure",
        failure: { detail: "已取消禅道授权，请重新授权。" },
      });
      expect((yield* service.getState).connectors).toEqual([connector]);
    }).pipe(Effect.provide(IssueAutomationService.layer.pipe(Layer.provide(dependencies))));
  }),
);
