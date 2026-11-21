import {
  PositiveInt,
  type SourceControlNamespace,
  type SourceControlNamespaceKind,
  type SourceControlRepositoryCloneUrls,
  type SourceControlRepositorySummary,
  type SourceControlRepositoryVisibilityLevel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabCredentials from "./GitLabCredentials.ts";
import { isValidGitLabHost, normalizeGitLabHost } from "./GitLabCredentials.ts";

const DEFAULT_TIMEOUT = Duration.seconds(15);
const MAX_NAMESPACE_PAGES = 20;
const NAMESPACE_PAGE_SIZE = 100;
const DEFAULT_REPOSITORIES_PER_PAGE = 50;
const MAX_REPOSITORIES_PER_PAGE = 100;

export class GitLabApiAuthenticationError extends Schema.TaggedError<GitLabApiAuthenticationError>()(
  "GitLabApiAuthenticationError",
  {
    host: Schema.String,
    status: Schema.Number,
    operation: Schema.String,
  },
) {
  get userFacingDetail(): string {
    return this.status === 403
      ? `GitLab token for ${this.host} lacks required API permission (grant \`read_api\` in GitLab Personal Access Tokens).`
      : `GitLab refused authentication for ${this.host}. Check your Personal Access Token in Settings → Source control & issues.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export class GitLabApiNotFoundError extends Schema.TaggedError<GitLabApiNotFoundError>()(
  "GitLabApiNotFoundError",
  {
    host: Schema.String,
    operation: Schema.String,
  },
) {
  get userFacingDetail(): string {
    return `The requested GitLab resource was not found on ${this.host}.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export class GitLabApiRateLimitError extends Schema.TaggedError<GitLabApiRateLimitError>()(
  "GitLabApiRateLimitError",
  {
    host: Schema.String,
    operation: Schema.String,
  },
) {
  get userFacingDetail(): string {
    return `GitLab API rate limit exceeded on ${this.host}. Wait a moment and try again.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export class GitLabApiRequestError extends Schema.TaggedError<GitLabApiRequestError>()(
  "GitLabApiRequestError",
  {
    host: Schema.String,
    operation: Schema.String,
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  get userFacingDetail(): string {
    return this.status !== undefined
      ? `GitLab API request failed on ${this.host} (HTTP ${this.status}).`
      : `Could not reach GitLab on ${this.host}. Check network access and hostname.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export class GitLabApiDecodeError extends Schema.TaggedError<GitLabApiDecodeError>()(
  "GitLabApiDecodeError",
  {
    host: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get userFacingDetail(): string {
    return `GitLab returned an unexpected response from ${this.host}.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

const isGitLabApiRequestError = Schema.is(GitLabApiRequestError);

export type GitLabApiError =
  | GitLabCredentials.GitLabCredentialLookupError
  | GitLabCredentials.GitLabNotSignedInError
  | GitLabApiAuthenticationError
  | GitLabApiNotFoundError
  | GitLabApiRateLimitError
  | GitLabApiRequestError
  | GitLabApiDecodeError;

const GitLabUserSchema = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeGitLabUser = Schema.decodeUnknownEffect(Schema.fromJsonString(GitLabUserSchema));

const GitLabGroupSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  full_path: Schema.String,
  parent_id: Schema.optional(Schema.NullOr(Schema.Number)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeGitLabGroupItem = Schema.decodeUnknownOption(GitLabGroupSchema);

const GitLabProjectSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  path_with_namespace: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: Schema.optional(Schema.NullOr(Schema.String)),
  ssh_url_to_repo: Schema.optional(Schema.NullOr(Schema.String)),
  http_url_to_repo: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.NullOr(Schema.Boolean)),
  empty_repo: Schema.optional(Schema.NullOr(Schema.Boolean)),
  last_activity_at: Schema.optional(Schema.NullOr(Schema.String)),
  namespace: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        full_path: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});
const decodeGitLabProject = Schema.decodeUnknownEffect(Schema.fromJsonString(GitLabProjectSchema));
const decodeGitLabProjectItem = Schema.decodeUnknownOption(GitLabProjectSchema);

const decodeJsonUnknownArray = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);

export interface GitLabUserProfile {
  readonly id: number;
  readonly username: string;
  readonly name: string | null;
  readonly webUrl: string | null;
  readonly avatarUrl: string | null;
}

export interface GitLabListRepositoriesInput {
  readonly host?: string;
  readonly namespaceId?: string;
  readonly namespaceKind?: SourceControlNamespaceKind;
  readonly includeSubgroups?: boolean;
  readonly includeArchived?: boolean;
  readonly search?: string;
  readonly page?: number;
  readonly perPage?: number;
}

export interface GitLabListRepositoriesResult {
  readonly host: string;
  readonly repositories: ReadonlyArray<SourceControlRepositorySummary>;
  readonly page: number;
  readonly nextPage: number | null;
  readonly totalCount: number | null;
}

export interface GitLabListNamespacesResult {
  readonly host: string;
  readonly namespaces: ReadonlyArray<SourceControlNamespace>;
}

export class GitLabApi extends Context.Service<
  GitLabApi,
  {
    readonly getCurrentUser: (input: {
      readonly host: string;
      readonly token?: Redacted.Redacted<string>;
      readonly timeout?: Duration.Input;
    }) => Effect.Effect<GitLabUserProfile, GitLabApiError>;
    readonly getProject: (input: {
      readonly host?: string;
      readonly projectPath: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, GitLabApiError>;
    readonly listNamespaces: (input: {
      readonly host?: string;
    }) => Effect.Effect<GitLabListNamespacesResult, GitLabApiError>;
    readonly listRepositories: (
      input: GitLabListRepositoriesInput,
    ) => Effect.Effect<GitLabListRepositoriesResult, GitLabApiError>;
  }
>()("@t3tools/source-control-gitlab/server/GitLabApi") {}

function parseHeaderPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseHeaderNonNegativeInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeVisibility(
  value: string | null | undefined,
): SourceControlRepositoryVisibilityLevel | null {
  if (value === "private" || value === "internal" || value === "public") return value;
  return null;
}

function deriveNamespacePath(pathWithNamespace: string): string | null {
  const slash = pathWithNamespace.lastIndexOf("/");
  if (slash <= 0) return null;
  return pathWithNamespace.slice(0, slash);
}

function toRepositorySummary(
  project: typeof GitLabProjectSchema.Type,
): SourceControlRepositorySummary | null {
  const pathWithNamespace = project.path_with_namespace.trim();
  const name = project.name.trim();
  const httpUrl = project.http_url_to_repo?.trim() ?? "";
  const sshUrl = project.ssh_url_to_repo?.trim() ?? "";
  const webUrl = project.web_url?.trim() || httpUrl.replace(/\.git$/i, "");
  if (!pathWithNamespace || !name || (!httpUrl && !sshUrl)) return null;

  const resolvedHttpUrl = httpUrl || sshUrl;
  const resolvedSshUrl = sshUrl || httpUrl;
  const namespacePath =
    project.namespace?.full_path?.trim() || deriveNamespacePath(pathWithNamespace);

  return {
    id: String(project.id),
    name,
    pathWithNamespace,
    namespacePath,
    description: project.description?.trim() ? project.description.trim() : null,
    defaultBranch: project.default_branch?.trim() ? project.default_branch.trim() : null,
    visibility: normalizeVisibility(project.visibility),
    sshUrl: resolvedSshUrl,
    httpUrl: resolvedHttpUrl,
    webUrl: webUrl || resolvedHttpUrl,
    archived: project.archived === true,
    ...(project.empty_repo === true ? { emptyRepo: true } : {}),
    lastActivityAt: project.last_activity_at?.trim() ? project.last_activity_at.trim() : null,
  };
}

function apiBaseUrl(host: string): string {
  return `https://${host}/api/v4`;
}

/** @public */
export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const credentials = yield* GitLabCredentials.GitLabCredentials;
  const gitlabCli = yield* GitLabCli.GitLabCli;

  const resolveHost = Effect.fn("GitLabApi.resolveHost")(function* (rawHost?: string) {
    if (rawHost !== undefined && rawHost.trim().length > 0) {
      const normalized = normalizeGitLabHost(rawHost);
      if (isValidGitLabHost(normalized)) return normalized;
      return yield* new GitLabApiRequestError({
        host: rawHost.trim(),
        operation: "resolveHost",
      });
    }
    const configured = yield* credentials.defaultHost;
    return configured ?? "gitlab.com";
  });

  const requestWithToken = Effect.fn("GitLabApi.requestWithToken")(function* (input: {
    readonly host: string;
    readonly token: Redacted.Redacted<string>;
    readonly path: string;
    readonly operation: string;
    readonly timeout?: Duration.Input;
  }) {
    const url = `${apiBaseUrl(input.host)}/${input.path.replace(/^\/+/, "")}`;
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.setHeader("private-token", Redacted.value(input.token)),
    );
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* httpClient.execute(request).pipe(
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new GitLabApiRequestError({
                  host: input.host,
                  operation: input.operation,
                }),
              ),
          }),
          Effect.mapError((cause) =>
            isGitLabApiRequestError(cause)
              ? cause
              : new GitLabApiRequestError({
                  host: input.host,
                  operation: input.operation,
                  cause,
                }),
          ),
        );

        const body = yield* response.text.pipe(
          Effect.mapError(
            (cause) =>
              new GitLabApiRequestError({
                host: input.host,
                operation: input.operation,
                status: response.status,
                cause,
              }),
          ),
        );

        if (response.status === 401 || response.status === 403) {
          return yield* new GitLabApiAuthenticationError({
            host: input.host,
            status: response.status,
            operation: input.operation,
          });
        }
        if (response.status === 404) {
          return yield* new GitLabApiNotFoundError({
            host: input.host,
            operation: input.operation,
          });
        }
        if (response.status === 429) {
          return yield* new GitLabApiRateLimitError({
            host: input.host,
            operation: input.operation,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* new GitLabApiRequestError({
            host: input.host,
            operation: input.operation,
            status: response.status,
          });
        }

        return {
          body,
          headers: response.headers as Readonly<Record<string, string | undefined>>,
        };
      }),
    );
  });

  const requestWithFallback = Effect.fn("GitLabApi.requestWithFallback")(function* (input: {
    readonly host: string;
    readonly path: string;
    readonly operation: string;
    readonly token?: Redacted.Redacted<string>;
    readonly timeout?: Duration.Input;
  }) {
    if (input.token !== undefined) {
      return yield* requestWithToken({
        host: input.host,
        token: input.token,
        path: input.path,
        operation: input.operation,
        ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
      });
    }

    const credential = yield* credentials.get(input.host);
    if (Option.isSome(credential)) {
      return yield* requestWithToken({
        host: input.host,
        token: credential.value.token,
        path: input.path,
        operation: input.operation,
        ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
      });
    }

    // No saved/env token for this host: fall back to `glab api` so existing CLI logins also work.
    const cliResult = yield* gitlabCli
      .execute({
        cwd: ".",
        callerNamedHost: input.host,
        args: ["api", "--hostname", input.host, input.path],
        maxOutputBytes: 4 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError((error) => {
          if (error._tag === "GitLabCliUnavailableError") {
            return new GitLabCredentials.GitLabNotSignedInError({ host: input.host });
          }
          if (error._tag === "GitLabCliAuthenticationError") {
            return new GitLabApiAuthenticationError({
              host: input.host,
              status: 401,
              operation: input.operation,
            });
          }
          if (error._tag === "GitLabCliRateLimitError") {
            return new GitLabApiRateLimitError({
              host: input.host,
              operation: input.operation,
            });
          }
          return new GitLabApiRequestError({
            host: input.host,
            operation: input.operation,
            cause: error,
          });
        }),
      );

    return {
      body: cliResult.stdout.trim(),
      headers: {} as Readonly<Record<string, string | undefined>>,
    };
  });

  const getCurrentUser: GitLabApi["Service"]["getCurrentUser"] = Effect.fn(
    "GitLabApi.getCurrentUser",
  )(function* (input) {
    const host = yield* resolveHost(input.host);
    const response = yield* requestWithFallback({
      host,
      path: "user",
      operation: "getCurrentUser",
      ...(input.token !== undefined ? { token: input.token } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
    });
    const decoded = yield* decodeGitLabUser(response.body).pipe(
      Effect.mapError(
        (cause) =>
          new GitLabApiDecodeError({
            host,
            operation: "getCurrentUser",
            cause,
          }),
      ),
    );
    return {
      id: decoded.id,
      username: decoded.username.trim(),
      name: decoded.name?.trim() ? decoded.name.trim() : null,
      webUrl: decoded.web_url?.trim() ? decoded.web_url.trim() : null,
      avatarUrl: decoded.avatar_url?.trim() ? decoded.avatar_url.trim() : null,
    } satisfies GitLabUserProfile;
  });

  const getProject: GitLabApi["Service"]["getProject"] = Effect.fn("GitLabApi.getProject")(
    function* (input) {
      const host = yield* resolveHost(input.host);
      const encoded = encodeURIComponent(input.projectPath.trim().replace(/\.git$/i, ""));
      const response = yield* requestWithFallback({
        host,
        path: `projects/${encoded}`,
        operation: "getProject",
      });
      const decoded = yield* decodeGitLabProject(response.body).pipe(
        Effect.mapError(
          (cause) =>
            new GitLabApiDecodeError({
              host,
              operation: "getProject",
              cause,
            }),
        ),
      );
      const httpUrl = decoded.http_url_to_repo?.trim() ?? "";
      const sshUrl = decoded.ssh_url_to_repo?.trim() ?? "";
      if (!httpUrl && !sshUrl) {
        return yield* new GitLabApiDecodeError({
          host,
          operation: "getProject",
          cause: new Error("GitLab project response had no clone URLs."),
        });
      }
      return {
        nameWithOwner: decoded.path_with_namespace.trim(),
        url: httpUrl || sshUrl,
        sshUrl: sshUrl || httpUrl,
      } satisfies SourceControlRepositoryCloneUrls;
    },
  );

  const listNamespaces: GitLabApi["Service"]["listNamespaces"] = Effect.fn(
    "GitLabApi.listNamespaces",
  )(function* (input) {
    const host = yield* resolveHost(input.host);

    const userResult = yield* Effect.result(getCurrentUser({ host }));
    const groups: SourceControlNamespace[] = [];

    for (let page = 1; page <= MAX_NAMESPACE_PAGES; page += 1) {
      const params = new URLSearchParams({
        membership: "true",
        per_page: String(NAMESPACE_PAGE_SIZE),
        page: String(page),
        order_by: "name",
        sort: "asc",
      });
      const response = yield* requestWithFallback({
        host,
        path: `groups?${params.toString()}`,
        operation: "listNamespaces",
      });
      const rawItems = yield* decodeJsonUnknownArray(response.body).pipe(
        Effect.mapError(
          (cause) =>
            new GitLabApiDecodeError({
              host,
              operation: "listNamespaces",
              cause,
            }),
        ),
      );

      for (const rawItem of rawItems) {
        const parsed = decodeGitLabGroupItem(rawItem);
        if (Option.isNone(parsed)) continue;
        const group = parsed.value;
        const name = group.name.trim();
        const fullPath = group.full_path.trim();
        if (!name || !fullPath) continue;
        groups.push({
          id: String(group.id),
          kind: "group",
          name,
          path: fullPath,
          parentId:
            group.parent_id !== null && group.parent_id !== undefined
              ? String(group.parent_id)
              : null,
          description: group.description?.trim() ? group.description.trim() : null,
          webUrl: group.web_url?.trim() ? group.web_url.trim() : null,
          avatarUrl: group.avatar_url?.trim() ? group.avatar_url.trim() : null,
        });
      }

      const nextPage = parseHeaderPositiveInt(response.headers["x-next-page"]);
      if (nextPage === null) {
        // When falling back to `glab api`, response headers are unavailable: stop when a page is short.
        if (Object.keys(response.headers).length > 0 || rawItems.length < NAMESPACE_PAGE_SIZE) {
          break;
        }
      }
    }

    const namespaces: SourceControlNamespace[] = [];
    if (Result.isSuccess(userResult) && userResult.success.username) {
      const user = userResult.success;
      namespaces.push({
        id: "personal",
        kind: "user",
        name: user.name ?? user.username,
        path: user.username,
        parentId: null,
        description: null,
        webUrl: user.webUrl,
        avatarUrl: user.avatarUrl,
      });
    }
    namespaces.push(...groups);

    return { host, namespaces } satisfies GitLabListNamespacesResult;
  });

  const listRepositories: GitLabApi["Service"]["listRepositories"] = Effect.fn(
    "GitLabApi.listRepositories",
  )(function* (input) {
    const host = yield* resolveHost(input.host);
    const page = PositiveInt.make(Math.max(1, input.page ?? 1));
    const perPage = Math.min(
      MAX_REPOSITORIES_PER_PAGE,
      Math.max(1, input.perPage ?? DEFAULT_REPOSITORIES_PER_PAGE),
    );
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      order_by: "last_activity_at",
      sort: "desc",
    });

    if (input.includeArchived !== true) {
      params.set("archived", "false");
    }

    const search = input.search?.trim();
    if (search) {
      params.set("search", search);
    }

    let endpoint: string;
    const namespaceId = input.namespaceId?.trim();
    if (input.namespaceKind === "user" || namespaceId === "personal") {
      const user = yield* getCurrentUser({ host });
      endpoint = `users/${user.id}/projects?${params.toString()}`;
    } else if (namespaceId) {
      params.set("include_subgroups", input.includeSubgroups === false ? "false" : "true");
      endpoint = `groups/${encodeURIComponent(namespaceId)}/projects?${params.toString()}`;
    } else {
      params.set("membership", "true");
      endpoint = `projects?${params.toString()}`;
    }

    const response = yield* requestWithFallback({
      host,
      path: endpoint,
      operation: "listRepositories",
    });

    const rawItems = yield* decodeJsonUnknownArray(response.body).pipe(
      Effect.mapError(
        (cause) =>
          new GitLabApiDecodeError({
            host,
            operation: "listRepositories",
            cause,
          }),
      ),
    );

    const repositories: SourceControlRepositorySummary[] = [];
    for (const rawItem of rawItems) {
      const parsed = decodeGitLabProjectItem(rawItem);
      if (Option.isNone(parsed)) continue;
      const summary = toRepositorySummary(parsed.value);
      if (summary !== null) repositories.push(summary);
    }

    const headerNextPage = parseHeaderPositiveInt(response.headers["x-next-page"]);
    const nextPage =
      headerNextPage ??
      (Object.keys(response.headers).length === 0 && rawItems.length >= perPage ? page + 1 : null);
    const totalCount = parseHeaderNonNegativeInt(response.headers["x-total"]);

    return {
      host,
      repositories,
      page,
      nextPage,
      totalCount,
    } satisfies GitLabListRepositoriesResult;
  });

  return GitLabApi.of({
    getCurrentUser,
    getProject,
    listNamespaces,
    listRepositories,
  });
});

export const layer = Layer.effect(GitLabApi, make);
