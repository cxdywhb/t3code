import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import {
  automaticMcpCallback,
  McpAuthorization,
  parseMcpCallback,
  parseMcpUrl,
  readStoredOAuth,
} from "./IssueAutomationMcp.ts";
import { makeZenTaoPlatformPlugin } from "./connectors/zentao/ZenTaoPlatformPlugin.ts";
import { IssueAutomationError } from "@t3tools/contracts";

it.effect(
  "authorizes a user-supplied service, uses ZenTao tools and refreshes a persisted grant",
  () =>
    Effect.gen(function* () {
      const endpoint = parseMcpUrl("https://mcp.example.test/zentao/mcp");
      const nonce = "authorization-state";
      let challenge = "";
      let grant = "first-token";
      const toolsCalled: string[] = [];
      const grants: string[] = [];

      using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, endpoint.origin);
        if ((init?.method ?? "GET") !== "GET" || !url.pathname.includes("/.well-known/")) {
          assert.equal(init?.redirect, "error");
        }
        switch (url.pathname) {
          case "/.well-known/oauth-protected-resource/zentao/mcp":
            return Response.json({
              resource: endpoint.href,
              authorization_servers: [`${endpoint.origin}/zentao`],
            });
          case "/.well-known/oauth-authorization-server/zentao":
            if (init?.redirect === "error")
              throw new TypeError("fetch failed: unexpected redirect");
            return new Response(null, {
              status: 302,
              headers: { location: "/zentao/.well-known/oauth-authorization-server" },
            });
          case "/zentao/.well-known/oauth-authorization-server":
            return Response.json({
              issuer: `${endpoint.origin}/zentao`,
              authorization_endpoint: `${endpoint.origin}/authorize`,
              token_endpoint: `${endpoint.origin}/token`,
              registration_endpoint: `${endpoint.origin}/register`,
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
              token_endpoint_auth_methods_supported: ["none"],
            });
          case "/register":
            return Response.json({
              ...JSON.parse(String(init?.body)),
              client_id: "registered-client",
            });
          case "/token": {
            const form = new URLSearchParams(String(init?.body));
            const type = form.get("grant_type");
            grants.push(type ?? "");
            if (type === "authorization_code") {
              assert.equal(form.get("code"), "user-approved");
              const verifier = new TextEncoder().encode(form.get("code_verifier") ?? "");
              const digest = await crypto.subtle.digest("SHA-256", verifier);
              assert.equal(Buffer.from(digest).toString("base64url"), challenge);
            } else {
              assert.equal(form.get("refresh_token"), "refresh-token");
            }
            return Response.json({
              access_token: grant,
              token_type: "Bearer",
              refresh_token: "refresh-token",
            });
          }
          case "/zentao/mcp": {
            if (new Headers(init?.headers).get("authorization") !== `Bearer ${grant}`) {
              return new Response(null, {
                status: 401,
                headers: {
                  "www-authenticate": `Bearer resource_metadata="${endpoint.origin}/.well-known/oauth-protected-resource/zentao/mcp"`,
                },
              });
            }
            if (init?.method !== "POST") return new Response(null, { status: 405 });
            const request = JSON.parse(String(init?.body));
            if (request.id === undefined) return new Response(null, { status: 202 });
            let result: unknown;
            switch (request.method) {
              case "initialize":
                result = {
                  protocolVersion: request.params.protocolVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: "ZenTao fixture", version: "1" },
                };
                break;
              case "tools/list":
                result = {
                  tools: ["list_products", "search_bugs", "get_bug", "add_bug_comment"].map(
                    (name) => ({
                      name,
                      inputSchema: { type: "object" },
                    }),
                  ),
                };
                break;
              case "tools/call": {
                const { name, arguments: args } = request.params;
                toolsCalled.push(name);
                if (name === "search_bugs") assert.equal(args.productID, 5);
                const data =
                  name === "list_products"
                    ? {
                        products: args.page === 1 ? { 5: "App" } : { 60: "Newer product" },
                        pager: { pageTotal: 2 },
                      }
                    : {
                        bugs: [
                          { id: "9", product: "5", title: "Something broke", status: "active" },
                        ],
                        productName: "App",
                        pager: { recTotal: 1 },
                      };
                result = {
                  content: [{ type: "text", text: JSON.stringify({ source: "fixture", data }) }],
                };
                break;
              }
              default:
                throw new Error("Unexpected MCP method");
            }
            return Response.json({ jsonrpc: "2.0", id: request.id, result });
          }
          default:
            throw new Error("Unexpected OAuth route");
        }
      });

      const redirectUri = automaticMcpCallback("http://127.0.0.1:5734");
      if (!redirectUri) throw new Error("Missing test callback URI");
      const session = new McpAuthorization(endpoint, nonce, undefined, redirectUri);
      const signal = yield* Effect.abortSignal;
      yield* Effect.promise(() =>
        expect(session.withClient(signal, (client) => client.listTools())).rejects.toThrow(),
      );
      assert.isDefined(session.authorizationUrl);
      const authorization = new URL(session.authorizationUrl!);
      assert.equal(authorization.pathname, "/authorize");
      assert.equal(authorization.searchParams.get("state"), nonce);
      challenge = authorization.searchParams.get("code_challenge") ?? "";
      assert.notEqual(challenge, "");
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      assert.equal(callback.href, redirectUri.href);
      callback.searchParams.set("code", "user-approved");
      callback.searchParams.set("state", "wrong");
      assert.throws(() => parseMcpCallback(callback.href, nonce, redirectUri.href));
      callback.searchParams.set("state", nonce);
      const code = parseMcpCallback(callback.href, nonce, redirectUri.href);
      if (code === null) throw new Error("Missing test authorization code");

      const adapter = makeZenTaoPlatformPlugin();
      const baseUrl = "https://bugs.example.test/zentao";
      const probe = yield* adapter.probeAndListScopes({
        baseUrl,
        withClient: (operation, run) =>
          Effect.tryPromise({
            try: (signal) => session.withClient(signal, run, code),
            catch: (cause) => new IssueAutomationError({ operation, detail: String(cause) }),
          }),
      });
      assert.deepEqual(
        probe.scopes.map((scope) => scope.id),
        ["60", "5"],
      );
      assert.deepEqual(probe.writeActions, ["comment"]);

      const serialized = JSON.stringify({ mcpUrl: endpoint.href, ...session.credentials });
      assert.isUndefined(readStoredOAuth(serialized, "https://other.example.test/mcp"));
      const stored = readStoredOAuth(serialized, endpoint.href);
      assert.equal(stored?.tokens.issuer, `${endpoint.origin}/zentao`);
      assert.equal(stored?.redirectUri, redirectUri.href);
      grant = "renewed-token";
      const renewedSession = new McpAuthorization(endpoint, "new-state", stored);
      const page = yield* adapter.listIssues({
        scopeId: "5",
        browseType: "all",
        page: 1,
        pageSize: 25,
        credentials: {
          baseUrl,
          withClient: (operation, run) =>
            Effect.tryPromise({
              try: (signal) => renewedSession.withClient(signal, run),
              catch: (cause) => new IssueAutomationError({ operation, detail: String(cause) }),
            }),
        },
      });
      assert.equal(page.items[0]?.url, `${baseUrl}/bug-view-9.html`);
      assert.deepEqual(grants, ["authorization_code", "refresh_token"]);
      assert.deepEqual(toolsCalled, ["list_products", "list_products", "search_bugs"]);
      assert.equal(renewedSession.credentials?.tokens.access_token, "renewed-token");
    }),
);

it("accepts a full HTTPS endpoint without exposing credentials in its URL", () => {
  assert.equal(parseMcpUrl("https://example.test/nested/mcp/").pathname, "/nested/mcp/");
  for (const url of [
    "http://example.test/mcp",
    "https://name:password@example.test/mcp",
    "https://example.test/mcp?token=secret",
    "https://example.test/mcp#fragment",
  ]) {
    assert.throws(() => parseMcpUrl(url));
  }
});

it("uses automatic callbacks for HTTPS and loopback, with manual callbacks for plain remote HTTP", () => {
  assert.equal(
    automaticMcpCallback("https://t3.example.test/")?.href,
    "https://t3.example.test/oauth/issue-automation/callback",
  );
  assert.isUndefined(automaticMcpCallback("http://192.168.1.10:3773"));
  assert.equal(
    parseMcpCallback(
      "127.0.0.1:37139/issue-automation/oauth/callback?state=fixture&code=manual",
      "fixture",
    ),
    "manual",
  );
});
