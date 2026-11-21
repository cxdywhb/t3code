import { DEFAULT_SERVER_SETTINGS, PositiveInt } from "@t3tools/contracts";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabCredentials from "./GitLabCredentials.ts";
import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import * as GitLabPullRequestProvider from "./GitLabPullRequestProvider.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeHttpPrHarness(input: {
  readonly tokens: Record<string, string>;
  readonly respond: (
    request: HttpClientRequest.HttpClientRequest,
    url: URL,
    bodyText: string,
  ) => Response;
}) {
  const requests: Array<{
    readonly method: string;
    readonly url: string;
    readonly token: string | undefined;
    readonly body: string;
  }> = [];

  const httpLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        let bodyText = "";
        if (request.body._tag === "Uint8Array") {
          bodyText = new TextDecoder().decode(request.body.body);
        }
        requests.push({
          method: request.method,
          url: url.toString(),
          token: request.headers["private-token"],
          body: bodyText,
        });
        return HttpClientResponse.fromWeb(request, input.respond(request, url, bodyText));
      }),
    ),
  );

  const hostLayer = TestSourceControlHost.layer({
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlHosts: {
        gitlab: {
          tokens: input.tokens,
          hosts: {},
        },
      },
    },
    process: {
      // Simulate `glab` missing from PATH to prove all PR/MR operations run directly over HTTP PAT.
      run: () =>
        Effect.succeed(
          TestSourceControlHost.processOutput("glab: command not found", {
            exitCode: ChildProcessSpawner.ExitCode(127),
          }),
        ),
    },
  });

  const cliSubprocessLayer = Layer.mock(GitLabCli.GitLabCli)({
    execute: () =>
      Effect.fail(
        new GitLabCli.GitLabCliUnavailableError({
          operation: "execute",
          command: "glab",
          cwd: ".",
          cause: new Error("glab must not be called when PAT is configured"),
        }),
      ),
  });

  const credentialsLayer = GitLabCredentials.layer.pipe(Layer.provide(hostLayer));
  const prCliLayer = GitLabPullRequestCli.layer.pipe(
    Layer.provide(cliSubprocessLayer),
    Layer.provide(httpLayer),
    Layer.provide(credentialsLayer),
  );
  const fullLayer = Layer.mergeAll(
    hostLayer,
    httpLayer,
    cliSubprocessLayer,
    credentialsLayer,
    prCliLayer,
  );
  return { requests, fullLayer };
}

const SAMPLE_MR = {
  iid: 18,
  title: "feat: support multi-model fusion review",
  description: "Adds parallel model consensus review.",
  web_url: "https://gitlab.example.test/platform/backend/core-api/-/merge_requests/18",
  references: {
    short: "!18",
    relative: "!18",
    full: "platform/backend/core-api!18",
  },
  state: "opened",
  draft: false,
  work_in_progress: false,
  source_branch: "feat/fusion-review",
  target_branch: "main",
  sha: "abcdef1234567890abcdef1234567890abcdef12",
  diff_refs: {
    base_sha: "1111111111111111111111111111111111111111",
    start_sha: "1111111111111111111111111111111111111111",
    head_sha: "abcdef1234567890abcdef1234567890abcdef12",
  },
  author: {
    id: 7,
    username: "alex",
    name: "Alex",
    avatar_url: null,
  },
  reviewers: [],
  labels: [],
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-21T12:00:00Z",
  merged_at: null,
  closed_at: null,
  detailed_merge_status: "mergeable",
  changes_count: "2",
  user: {
    can_merge: true,
  },
};

it.effect(
  "lists cloud account-wide GitLab MRs and executes review & merge actions over HTTP PAT without glab",
  () =>
    Effect.gen(function* () {
      const { requests, fullLayer } = makeHttpPrHarness({
        tokens: { "gitlab.example.test": "glpat-cloud-token" },
        respond: (req, url) => {
          if (url.pathname === "/api/v4/user") {
            return jsonResponse({ id: 7, username: "alex" });
          }
          if (url.pathname === "/api/v4/merge_requests") {
            return jsonResponse([SAMPLE_MR]);
          }
          if (url.pathname === "/api/graphql") {
            return jsonResponse({ data: { project: null } });
          }
          if (
            url.pathname === "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18" &&
            req.method === "GET"
          ) {
            return jsonResponse(SAMPLE_MR);
          }
          if (
            url.pathname ===
            "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18/diffs"
          ) {
            return jsonResponse([
              {
                old_path: "src/index.ts",
                new_path: "src/index.ts",
                a_mode: "100644",
                b_mode: "100644",
                new_file: false,
                renamed_file: false,
                deleted_file: false,
                diff: "@@ -1,2 +1,3 @@\n export const ok = true;\n+export const fusion = true;\n",
              },
            ]);
          }
          if (
            url.pathname ===
              "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18/notes" &&
            req.method === "POST"
          ) {
            return jsonResponse({ id: 901, body: "ok" }, 201);
          }
          if (
            url.pathname ===
              "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18/discussions" &&
            req.method === "POST"
          ) {
            return jsonResponse({ id: "disc-1" }, 201);
          }
          if (
            url.pathname ===
              "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18/approve" &&
            req.method === "POST"
          ) {
            return jsonResponse({ approved: true }, 201);
          }
          if (
            url.pathname ===
              "/api/v4/projects/platform%2Fbackend%2Fcore-api/merge_requests/18/merge" &&
            req.method === "PUT"
          ) {
            return jsonResponse({ ...SAMPLE_MR, state: "merged" });
          }
          return jsonResponse({ message: `Unhandled ${req.method} ${url.pathname}` }, 404);
        },
      });

      yield* Effect.gen(function* () {
        const provider = yield* GitLabPullRequestProvider.make;
        const hosts = yield* provider.configuredHosts ?? Effect.succeed([]);
        assert.deepStrictEqual(hosts, ["gitlab.example.test"]);

        const viewer = yield* provider.getViewer({ cwd: "/tmp", host: "gitlab.example.test" });
        assert.strictEqual(viewer, "alex");

        assert.isDefined(provider.listAccountChangeRequests);
        const cloudBatch = yield* provider.listAccountChangeRequests!({
          cwd: "/tmp",
          host: "gitlab.example.test",
          state: "open",
          involvement: "authored",
          viewer: "alex",
          limit: 20,
        });
        assert.strictEqual(cloudBatch.items.length, 1);
        assert.strictEqual(cloudBatch.items[0]?.repository, "platform/backend/core-api");
        assert.strictEqual(cloudBatch.items[0]?.number, 18);

        const diff = yield* provider.getDiff({
          cwd: "/tmp",
          host: "gitlab.example.test",
          repository: "platform/backend/core-api",
          number: 18,
        });
        assert.include(diff.patch, "+export const fusion = true;");

        yield* provider.submitReview({
          cwd: "/tmp",
          host: "gitlab.example.test",
          repository: "platform/backend/core-api",
          number: 18,
          verdict: "approve",
          body: "LGTM from Multi-Model Fusion",
          comments: [
            {
              path: "src/index.ts",
              body: "Verified clean export.",
              position: { kind: "added", newLine: PositiveInt.make(2) },
            },
          ],
        });

        yield* provider.runAction({
          cwd: "/tmp",
          host: "gitlab.example.test",
          repository: "platform/backend/core-api",
          number: 18,
          action: "merge",
          mergeMethod: "squash",
        });

        assert.isTrue(requests.every((r) => r.token === "glpat-cloud-token"));
        const mergeReq = requests.find((r) => r.url.endsWith("/merge_requests/18/merge"));
        assert.isDefined(mergeReq);
        assert.strictEqual(mergeReq?.method, "PUT");
        assert.include(mergeReq?.body ?? "", '"squash":true');
      }).pipe(Effect.provide(fullLayer));
    }),
);
