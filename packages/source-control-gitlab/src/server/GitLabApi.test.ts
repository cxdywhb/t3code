import { DEFAULT_SERVER_SETTINGS, SourceControlProviderKind } from "@t3tools/contracts";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import * as GitLabApi from "./GitLabApi.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabCredentials from "./GitLabCredentials.ts";
import * as GitLabSourceControlProvider from "./GitLabSourceControlProvider.ts";

const isGitLabApiAuthenticationError = Schema.is(GitLabApi.GitLabApiAuthenticationError);

function jsonResponse(
  body: unknown,
  options?: { readonly status?: number; readonly headers?: Record<string, string> },
) {
  return new Response(JSON.stringify(body), {
    status: options?.status ?? 200,
    headers: { "content-type": "application/json", ...options?.headers },
  });
}

function makeGitLabHarness(input: {
  readonly tokens?: Record<string, string>;
  readonly hosts?: Record<string, { readonly enabled: boolean }>;
  readonly respond: (request: HttpClientRequest.HttpClientRequest, url: URL) => Response;
}) {
  const requests: Array<{ readonly url: string; readonly token: string | undefined }> = [];
  const httpLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        requests.push({
          url: url.toString(),
          token: request.headers["private-token"],
        });
        return HttpClientResponse.fromWeb(request, input.respond(request, url));
      }),
    ),
  );
  const hostLayer = TestSourceControlHost.layer({
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlHosts: {
        gitlab: {
          tokens: input.tokens ?? {},
          hosts: input.hosts ?? {},
        },
      },
    },
    process: {
      // Simulate `glab` CLI missing from PATH to prove self-hosted token auth works without it.
      run: () =>
        Effect.succeed(
          TestSourceControlHost.processOutput("glab: command not found", {
            exitCode: ChildProcessSpawner.ExitCode(127),
          }),
        ),
    },
  });
  const cliLayer = Layer.mock(GitLabCli.GitLabCli)({
    execute: () =>
      Effect.fail(
        new GitLabCli.GitLabCliUnavailableError({
          operation: "execute",
          command: "glab",
          cwd: ".",
          cause: new Error("glab missing"),
        }),
      ),
  });
  const credentialsLayer = GitLabCredentials.layer.pipe(Layer.provide(hostLayer));
  const apiLayer = GitLabApi.layer.pipe(
    Layer.provide(httpLayer),
    Layer.provide(credentialsLayer),
    Layer.provide(cliLayer),
  );
  const fullLayer = Layer.mergeAll(hostLayer, httpLayer, cliLayer, credentialsLayer, apiLayer);
  return { requests, fullLayer };
}

it("normalizes self-hosted GitLab URLs and hostnames", () => {
  assert.strictEqual(
    GitLabCredentials.normalizeGitLabHost("https://gitlab.example.test/"),
    "gitlab.example.test",
  );
  assert.strictEqual(
    GitLabCredentials.normalizeGitLabHost("https://GITLAB.EXAMPLE.TEST:8443/dashboard/groups"),
    "gitlab.example.test:8443",
  );
  assert.strictEqual(
    GitLabCredentials.normalizeGitLabHost("  gitlab.example.test  "),
    "gitlab.example.test",
  );
});

it.effect(
  "lists paginated GitLab groups and personal namespace using a saved self-hosted PAT",
  () =>
    Effect.gen(function* () {
      const { requests, fullLayer } = makeGitLabHarness({
        tokens: { "gitlab.example.test": "glpat-secret-token" },
        respond: (_req, url) => {
          if (url.pathname === "/api/v4/user") {
            return jsonResponse({
              id: 42,
              username: "example-user",
              name: "Example User",
              web_url: "https://gitlab.example.test/example-user",
              avatar_url: null,
            });
          }
          if (url.pathname === "/api/v4/groups" && url.searchParams.get("page") === "1") {
            return jsonResponse(
              [
                {
                  id: 10,
                  name: "acme",
                  full_path: "acme",
                  parent_id: null,
                  description: "Acme engineering",
                  web_url: "https://gitlab.example.test/acme",
                },
              ],
              { headers: { "x-next-page": "2" } },
            );
          }
          if (url.pathname === "/api/v4/groups" && url.searchParams.get("page") === "2") {
            return jsonResponse(
              [
                {
                  id: 11,
                  name: "platform",
                  full_path: "acme/platform",
                  parent_id: 10,
                  description: null,
                  web_url: "https://gitlab.example.test/acme/platform",
                },
              ],
              { headers: { "x-next-page": "" } },
            );
          }
          return jsonResponse({ message: "not found" }, { status: 404 });
        },
      });

      const provider = yield* GitLabSourceControlProvider.make.pipe(Effect.provide(fullLayer));
      const result = yield* provider.listNamespaces!({});

      assert.strictEqual(result.host, "gitlab.example.test");
      assert.deepStrictEqual(
        result.namespaces.map((ns) => ({
          id: ns.id,
          kind: ns.kind,
          path: ns.path,
          parentId: ns.parentId,
        })),
        [
          { id: "personal", kind: "user", path: "example-user", parentId: null },
          { id: "10", kind: "group", path: "acme", parentId: null },
          { id: "11", kind: "group", path: "acme/platform", parentId: "10" },
        ],
      );
      assert.isTrue(requests.every((req) => req.token === "glpat-secret-token"));
    }),
);

it.effect("lists repositories inside a group with subgroup toggle, search, and pagination", () =>
  Effect.gen(function* () {
    const { requests, fullLayer } = makeGitLabHarness({
      tokens: { "gitlab.example.test": "glpat-repo-token" },
      respond: (_req, url) => {
        if (url.pathname === "/api/v4/groups/10/projects") {
          return jsonResponse(
            [
              {
                id: 101,
                name: "example-web",
                path_with_namespace: "acme/platform/example-web",
                description: "Example web app",
                default_branch: "main",
                visibility: "private",
                ssh_url_to_repo: "git@gitlab.example.test:acme/platform/example-web.git",
                http_url_to_repo: "https://gitlab.example.test/acme/platform/example-web.git",
                web_url: "https://gitlab.example.test/acme/platform/example-web",
                archived: false,
                last_activity_at: "2026-11-20T10:00:00Z",
                namespace: { full_path: "acme/platform" },
              },
            ],
            { headers: { "x-next-page": "2", "x-total": "25" } },
          );
        }
        return jsonResponse([], { status: 404 });
      },
    });

    const provider = yield* GitLabSourceControlProvider.make.pipe(Effect.provide(fullLayer));
    const result = yield* provider.listRepositories!({
      host: "gitlab.example.test",
      namespaceId: "10",
      includeSubgroups: true,
      includeArchived: false,
      search: "example",
      page: 1,
      perPage: 20,
    });

    assert.strictEqual(result.host, "gitlab.example.test");
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.nextPage, 2);
    assert.strictEqual(result.totalCount, 25);
    assert.strictEqual(result.repositories.length, 1);
    assert.strictEqual(result.repositories[0]!.pathWithNamespace, "acme/platform/example-web");
    assert.strictEqual(
      result.repositories[0]!.sshUrl,
      "git@gitlab.example.test:acme/platform/example-web.git",
    );
    const requestedUrl = new URL(requests[0]!.url);
    assert.strictEqual(requestedUrl.searchParams.get("include_subgroups"), "true");
    assert.strictEqual(requestedUrl.searchParams.get("archived"), "false");
    assert.strictEqual(requestedUrl.searchParams.get("search"), "example");
  }),
);

it.effect(
  "authenticates self-hosted GitLab in discovery and refines unknown remotes without glab CLI",
  () =>
    Effect.gen(function* () {
      const { fullLayer } = makeGitLabHarness({
        tokens: { "gitlab.example.test": "glpat-live-token" },
        respond: (_req, url) => {
          if (url.pathname === "/api/v4/user") {
            return jsonResponse({ id: 7, username: "alice", name: "Alice" });
          }
          return jsonResponse({}, { status: 404 });
        },
      });

      const discovery = yield* GitLabSourceControlProvider.makeDiscovery.pipe(
        Effect.provide(fullLayer),
      );
      const item = yield* discovery.probe(".");
      assert.strictEqual(item.status, "available");
      assert.strictEqual(item.auth.status, "authenticated");
      assert.deepStrictEqual(item.auth.account, Option.some("alice"));
      assert.deepStrictEqual(item.auth.host, Option.some("gitlab.example.test"));

      const refined = yield* discovery.refineUnknownRemote({
        cwd: ".",
        context: {
          provider: {
            kind: SourceControlProviderKind.make("unknown"),
            name: "gitlab.example.test",
            baseUrl: "https://gitlab.example.test",
          },
          remoteName: "origin",
          remoteUrl: "git@gitlab.example.test:acme/repo.git",
        },
      });
      assert.deepStrictEqual(refined, {
        kind: SourceControlProviderKind.make("gitlab"),
        name: "GitLab Self-Hosted",
        baseUrl: "https://gitlab.example.test",
      });

      const provider = yield* GitLabSourceControlProvider.make.pipe(Effect.provide(fullLayer));
      const httpAuth = yield* provider.getCloneHttpAuth!({ host: "gitlab.example.test" });
      assert.ok(httpAuth);
      assert.strictEqual(httpAuth.username, "oauth2");
      assert.strictEqual(Redacted.value(httpAuth.token), "glpat-live-token");
    }),
);

it.effect("surfaces clear auth error when GitLab rejects the saved PAT", () =>
  Effect.gen(function* () {
    const { fullLayer } = makeGitLabHarness({
      tokens: { "gitlab.example.test": "glpat-bad-token" },
      respond: () => jsonResponse({ message: "401 Unauthorized" }, { status: 401 }),
    });

    const provider = yield* GitLabSourceControlProvider.make.pipe(Effect.provide(fullLayer));
    const error = yield* Effect.flip(provider.listRepositories!({ host: "gitlab.example.test" }));
    assert.isTrue(isGitLabApiAuthenticationError(error.cause));
    assert.include(error.detail, "gitlab.example.test");
  }),
);
