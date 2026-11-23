import { SourceControlProviderKind } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  SourceControlProviderError,
  type ChangeRequest,
  type SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import {
  parseGitRemoteHost,
  unknownRemoteProvider as unknownHostProvider,
} from "@t3tools/source-control-core/shared/definition";

import * as GitLabApi from "./GitLabApi.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabCredentials from "./GitLabCredentials.ts";
import * as GitLabChangeRequestTemplate from "./gitLabChangeRequestTemplate.ts";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import {
  combinedAuthOutput,
  firstSafeAuthLine,
  matchFirst,
  parseCliHost,
  probeSourceControlProvider,
  providerAuth,
  type SourceControlAuthProbeInput,
  type SourceControlCliDiscoverySpec,
  type SourceControlManagedCliDiscoverySpec,
  type SourceControlUnknownRemoteRefinementInput,
} from "@t3tools/source-control-core/server/discovery";
import { findAuthenticatedGitLabHost, parseGitLabAuthStatusHosts } from "./gitLabAuthStatus.ts";

const decodeLinkSubject = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ title: Schema.String, description: Schema.NullOr(Schema.String) }),
  ),
);

function toChangeRequest(summary: GitLabCli.GitLabMergeRequestSummary): ChangeRequest {
  return {
    provider: SourceControlProviderKind.make("gitlab"),
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    ...(summary.headSha !== undefined ? { headSha: summary.headSha } : {}),
    state: summary.state ?? "open",
    ...(summary.isDraft === true ? { isDraft: true } : {}),
    closedAt: summary.closedAt ?? null,
    mergedAt: summary.mergedAt ?? null,
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function parseGitLabAuth(input: SourceControlAuthProbeInput) {
  const output = combinedAuthOutput(input);
  const authenticatedHost = findAuthenticatedGitLabHost(parseGitLabAuthStatusHosts(output));
  const account =
    authenticatedHost?.account ??
    matchFirst(output, [
      /Logged in to .* as\s+([^\s(]+)/iu,
      /Logged in to .* account\s+([^\s(]+)/iu,
      /account:\s*([^\s(]+)/iu,
    ]);
  const host = authenticatedHost?.host ?? parseCliHost(output);

  if (account) {
    return providerAuth({ status: "authenticated", account, host });
  }

  if (input.exitCode !== 0) {
    return providerAuth({
      status: "unauthenticated",
      host,
      detail: firstSafeAuthLine(output) ?? "Run `glab auth login` to authenticate GitLab CLI.",
    });
  }

  return providerAuth({
    status: "unknown",
    host,
    detail: firstSafeAuthLine(output) ?? "GitLab CLI auth status could not be parsed.",
  });
}

const GITLAB_HOST_NOT_LOGGED_IN_PATTERN =
  /\bnot (?:been )?authenticated with glab\b|\bno gitlab instances? ha(?:s|ve) been authenticated\b/iu;

function refineUnknownGitLabRemote(input: SourceControlUnknownRemoteRefinementInput) {
  const host = input.context.provider.name.toLowerCase();
  const output = combinedAuthOutput(input.auth);
  const authenticated = parseGitLabAuthStatusHosts(output).some(
    (entry) => entry.account !== null && entry.host === host,
  );

  if (!authenticated) {
    return GITLAB_HOST_NOT_LOGGED_IN_PATTERN.test(output) ? null : undefined;
  }

  return {
    kind: SourceControlProviderKind.make("gitlab"),
    name: "GitLab Self-Hosted",
    baseUrl: input.context.provider.baseUrl,
  } as const;
}

/** The caller refines only an identity no host recognised, so its remote is on an unknown host. */
function unknownRemoteProvider(remoteUrl: string) {
  const remote = parseGitRemoteHost(remoteUrl);
  return remote === null ? null : unknownHostProvider(remote);
}

// A glab login confirms a self-hosted GitLab whose hostname does not identify its provider.
const refineRepositoryIdentity: NonNullable<
  SourceControlProvider.SourceControlProvider["Service"]["refineRepositoryIdentity"]
> = Effect.fn("GitLabSourceControlProvider.refineRepositoryIdentity")(function* ({
  identity,
  resolveContext,
}) {
  if (!identity.rootPath || (identity.provider !== undefined && identity.provider !== "unknown"))
    return identity;
  const provider = unknownRemoteProvider(identity.locator.remoteUrl);
  if (!provider) return identity;
  const context = yield* resolveContext({
    cwd: identity.rootPath,
    context: {
      provider,
      remoteName: identity.locator.remoteName,
      remoteUrl: identity.locator.remoteUrl,
    },
  });
  return context?.provider.kind === "gitlab"
    ? { ...identity, provider: SourceControlProviderKind.make("gitlab") }
    : identity;
});

export const discovery = {
  type: "cli",
  kind: SourceControlProviderKind.make("gitlab"),
  label: "GitLab",
  executable: "glab",
  versionArgs: ["--version"],
  // Without --all, glab 1.79+ checks only the current host unless that is gitlab.com; older
  // glab lists every host and rejects --all. --all waits on every host, so ask it only after
  // the current host reports signed out.
  authArgs: ["auth", "status"],
  authRetryArgs: ["auth", "status", "--all"],
  // glab host matching requires the remote's exact spelling.
  remoteRefinementArgs: ({ provider, remoteUrl }) => {
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)/iu.exec(remoteUrl.trim())?.[1];
    const remoteHost = authority
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : remoteUrl.trim().replace(/^[^@:/]+@/u, "");
    const host = remoteHost.toLowerCase().startsWith(provider.name.toLowerCase())
      ? remoteHost.slice(0, provider.name.length)
      : provider.name;
    return ["auth", "status", "--hostname", host];
  },
  parseAuth: parseGitLabAuth,
  refineUnknownRemote: refineUnknownGitLabRemote,
  installHint:
    "Add a GitLab Personal Access Token in Settings (works with self-hosted GitLab without `glab`), or install GitLab CLI (`glab`) from https://gitlab.com/gitlab-org/cli.",
} satisfies SourceControlCliDiscoverySpec;

const DISCOVERY_API_TIMEOUT = Duration.seconds(5);

function parseRepositoryHostAndPath(
  repository: string,
  explicitHost?: string,
): { readonly host: string | null; readonly projectPath: string } {
  const trimmed = repository.trim();
  const explicit = explicitHost ? GitLabCredentials.normalizeGitLabHost(explicitHost) : "";
  if (explicit && GitLabCredentials.isValidGitLabHost(explicit)) {
    return { host: explicit, projectPath: trimmed.replace(/^\/+/, "").replace(/\.git$/i, "") };
  }
  const parsedUrl = URL.parse(trimmed);
  if (parsedUrl && (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:")) {
    const path = parsedUrl.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
    if (path.includes("/")) {
      return { host: parsedUrl.host.toLowerCase(), projectPath: path };
    }
  }
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0]!.includes(".")) {
    const host = GitLabCredentials.normalizeGitLabHost(segments[0]!);
    if (GitLabCredentials.isValidGitLabHost(host)) {
      return {
        host,
        projectPath: segments
          .slice(1)
          .join("/")
          .replace(/\.git$/i, ""),
      };
    }
  }
  return { host: null, projectPath: trimmed.replace(/^\/+/, "").replace(/\.git$/i, "") };
}

function toGitLabApiProviderError(
  operation: string,
  error: GitLabApi.GitLabApiError,
  repository?: string,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: SourceControlProviderKind.make("gitlab"),
    operation,
    cwd: ".",
    ...(repository
      ? { repository: SourceControlProvider.transportSafeSourceControlErrorValue(repository) }
      : {}),
    detail: error.message,
    cause: error,
  });
}

export const makeDiscovery = Effect.gen(function* () {
  const sourceControlHost = yield* SourceControlHost.SourceControlHost;
  const credentials = yield* GitLabCredentials.GitLabCredentials;
  const api = yield* GitLabApi.GitLabApi;

  return {
    type: "managed-cli",
    kind: discovery.kind,
    label: discovery.label,
    installHint: discovery.installHint,
    probe: Effect.fn("GitLabSourceControlProvider.discovery")(function* (cwd: string) {
      const [cli, configured] = yield* Effect.all(
        [
          probeSourceControlProvider({
            cwd,
            process: sourceControlHost.process,
            spec: discovery,
          }),
          credentials.configuredHosts,
        ],
        { concurrency: "unbounded" },
      );

      const enabledConfigured = configured.filter((entry) => entry.enabled);
      if (enabledConfigured.length === 0) {
        return cli;
      }

      const checked = yield* Effect.forEach(
        enabledConfigured,
        (entry) => {
          if (Option.isNone(entry.token)) {
            return Effect.succeed({
              host: entry.host,
              source: entry.source,
              status: "error" as const,
              detail: entry.error ?? `Token for ${entry.host} could not be resolved.`,
            });
          }
          return api
            .getCurrentUser({
              host: entry.host,
              token: entry.token.value,
              timeout: DISCOVERY_API_TIMEOUT,
            })
            .pipe(
              Effect.map((user) => ({
                host: entry.host,
                source: entry.source,
                status: "authenticated" as const,
                account: user.username,
              })),
              Effect.catch((error) =>
                Effect.succeed({
                  host: entry.host,
                  source: entry.source,
                  status:
                    error._tag === "GitLabApiAuthenticationError"
                      ? ("unauthenticated" as const)
                      : ("error" as const),
                  detail: error.message,
                }),
              ),
            );
        },
        { concurrency: 4 },
      );

      const cliAccounts = cli.auth.accounts ?? [];
      const tokenHosts = new Set(checked.map((item) => item.host));
      const mergedAccounts = [
        ...checked.map((item) =>
          item.status === "authenticated"
            ? {
                host: item.host,
                account: item.account,
                active: true,
                authenticated: true,
                ...(item.source === "env" ? { environmentVariable: "GITLAB_TOKEN" } : {}),
              }
            : {
                host: item.host,
                account: "token",
                active: true,
                authenticated: false,
                error: item.detail,
                ...(item.source === "env" ? { environmentVariable: "GITLAB_TOKEN" } : {}),
              },
        ),
        ...cliAccounts.filter((account) => !tokenHosts.has(account.host.toLowerCase())),
      ];

      const primaryAuthenticated = checked.find((item) => item.status === "authenticated");
      if (primaryAuthenticated && primaryAuthenticated.status === "authenticated") {
        const additionalHosts = checked.filter(
          (item) => item.status === "authenticated" && item.host !== primaryAuthenticated.host,
        ).length;
        return {
          ...cli,
          status: "available" as const,
          auth: {
            ...providerAuth({
              status: "authenticated",
              account: primaryAuthenticated.account,
              host: primaryAuthenticated.host,
              detail:
                primaryAuthenticated.source === "settings"
                  ? additionalHosts > 0
                    ? `Using token saved in Settings for ${primaryAuthenticated.host} (+${additionalHosts} more).`
                    : `Using the token saved in Settings for ${primaryAuthenticated.host}.`
                  : `Using GITLAB_TOKEN from the server environment for ${primaryAuthenticated.host}.`,
            }),
            accounts: mergedAccounts,
          },
        } satisfies SourceControlProviderDiscoveryItem;
      }

      if (cli.status === "available" && cli.auth.status === "authenticated") {
        return {
          ...cli,
          auth: {
            ...cli.auth,
            accounts: mergedAccounts,
          },
        } satisfies SourceControlProviderDiscoveryItem;
      }

      const firstFailed = checked[0];
      return {
        ...cli,
        status: "available" as const,
        auth: {
          ...providerAuth({
            status: firstFailed?.status === "unauthenticated" ? "unauthenticated" : "unknown",
            host: firstFailed?.host,
            detail: firstFailed?.status === "authenticated" ? undefined : firstFailed?.detail,
          }),
          accounts: mergedAccounts,
        },
      } satisfies SourceControlProviderDiscoveryItem;
    }),
    refineUnknownRemote: Effect.fn("GitLabSourceControlProvider.refineUnknownRemote")(function* ({
      cwd,
      context,
    }) {
      const parsed = URL.parse(context.provider.baseUrl);
      const host = GitLabCredentials.normalizeGitLabHost(parsed?.host || context.provider.name);
      if (host && (yield* credentials.hasConfiguredHost(host))) {
        return {
          kind: SourceControlProviderKind.make("gitlab"),
          name: host === "gitlab.com" ? "GitLab" : "GitLab Self-Hosted",
          baseUrl: context.provider.baseUrl,
        } as const;
      }
      const cliAuth = yield* sourceControlHost.process
        .run({
          operation: "source-control.discovery.refine-unknown-remote",
          command: discovery.executable,
          args: discovery.remoteRefinementArgs(context),
          cwd,
          allowNonZeroExit: true,
          timeoutMs: 5_000,
          maxOutputBytes: 8_000,
          appendTruncationMarker: true,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (cliAuth === null) return null;
      return refineUnknownGitLabRemote({ cwd, context, auth: cliAuth }) ?? null;
    }),
  } satisfies SourceControlManagedCliDiscoverySpec;
});

export const make = Effect.gen(function* () {
  const gitlab = yield* GitLabCli.GitLabCli;
  const api = yield* GitLabApi.GitLabApi;
  const credentials = yield* GitLabCredentials.GitLabCredentials;
  const { git } = yield* SourceControlHost.SourceControlHost;

  const readLinkSubject = Effect.fn("GitLabSourceControlProvider.readLinkSubject")(function* (
    input: { readonly cwd: string; readonly url: URL },
    endpoint: string,
  ) {
    const result = yield* gitlab
      .execute({
        cwd: input.cwd,
        callerNamedHost: input.url.host,
        args: ["api", "--hostname", input.url.host, endpoint],
        timeoutMs: 3_000,
        maxOutputBytes: 32_000,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlProviderError({
              provider: SourceControlProviderKind.make("gitlab"),
              operation: "resolveLink",
              cwd: input.cwd,
              detail: "The linked subject could not be read.",
              cause,
            }),
        ),
      );
    const subject = yield* decodeLinkSubject(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new SourceControlProviderError({
            provider: SourceControlProviderKind.make("gitlab"),
            operation: "resolveLink.decode",
            cwd: input.cwd,
            detail: "The linked subject could not be read.",
            cause,
          }),
      ),
    );
    return { title: subject.title, body: subject.description };
  });

  return SourceControlProvider.SourceControlProvider.of({
    kind: SourceControlProviderKind.make("gitlab"),
    // GitLab lists fork merge requests by source branch with no owner filter, so read a full page
    // once per branch. The first selector wins: GitManager puts `owner:branch` first for a fork
    // head, which tells the list to name fork source projects.
    headBranchProbe: ({ headSelectors }) => {
      const byBranch = new Map<string, string>();
      for (const selector of headSelectors) {
        const branch = SourceControlProvider.sourceBranch({ headSelector: selector });
        if (!byBranch.has(branch)) byBranch.set(branch, selector);
      }
      return { headSelectors: [...byBranch.values()], limit: 100 };
    },
    readChangeRequestTemplate: Effect.fn("GitLabSourceControlProvider.readChangeRequestTemplate")(
      function ({ cwd, treeish }) {
        return GitLabChangeRequestTemplate.detect(cwd, treeish, git.execute);
      },
    ),
    refineRepositoryIdentity,
    resolveLink: (input) => {
      // Automatic enrichment must not send ambient CLI credentials to a host from message text.
      if (input.url.host !== "gitlab.com") return undefined;
      const match = /^\/(.+)\/-\/(merge_requests|issues)\/([1-9]\d*)(?:\/.*)?$/.exec(
        input.url.pathname,
      );
      if (!match) return undefined;
      return readLinkSubject(
        input,
        `projects/${encodeURIComponent(match[1]!)}/${match[2]}/${match[3]}`,
      );
    },
    listChangeRequests: Effect.fn("GitLabSourceControlProvider.listChangeRequests")(
      function (input) {
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        return gitlab
          .listMergeRequests({
            cwd: input.cwd,
            headSelector: input.headSelector,
            ...(source ? { source } : {}),
            state: input.state,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: SourceControlProviderKind.make("gitlab"),
                  operation: "listChangeRequests",
                  command: error.command,
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: error.detail,
                  cause: error,
                }),
            ),
          );
      },
    ),
    getChangeRequest: Effect.fn("GitLabSourceControlProvider.getChangeRequest")(function (input) {
      return gitlab.getMergeRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: SourceControlProviderKind.make("gitlab"),
              operation: "getChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      );
    }),
    createsDraftChangeRequests: true,
    createChangeRequest: Effect.fn("GitLabSourceControlProvider.createChangeRequest")(
      function (input) {
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        return gitlab
          .createMergeRequest({
            cwd: input.cwd,
            baseBranch: input.baseRefName,
            headSelector: input.headSelector,
            ...(source ? { source } : {}),
            ...(input.target ? { target: input.target } : {}),
            title: input.title,
            bodyFile: input.bodyFile,
            ...(input.draft === true ? { draft: true } : {}),
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: SourceControlProviderKind.make("gitlab"),
                  operation: "createChangeRequest",
                  command: error.command,
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: error.detail,
                  cause: error,
                }),
            ),
          );
      },
    ),
    getRepositoryCloneUrls: Effect.fn("GitLabSourceControlProvider.getRepositoryCloneUrls")(
      function* (input) {
        const parsed = parseRepositoryHostAndPath(input.repository, input.host);
        const targetHost = parsed.host ?? (yield* credentials.defaultHost);
        if (targetHost !== null) {
          const token = yield* credentials
            .get(targetHost)
            .pipe(
              Effect.mapError((error) =>
                toGitLabApiProviderError("getRepositoryCloneUrls", error, input.repository),
              ),
            );
          if (Option.isSome(token)) {
            return yield* api
              .getProject({
                host: targetHost,
                projectPath: parsed.projectPath,
              })
              .pipe(
                Effect.mapError((error) =>
                  toGitLabApiProviderError("getRepositoryCloneUrls", error, input.repository),
                ),
              );
          }
        }
        return yield* gitlab.getRepositoryCloneUrls(input).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: SourceControlProviderKind.make("gitlab"),
                operation: "getRepositoryCloneUrls",
                command: error.command,
                cwd: input.cwd,
                repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.repository,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        );
      },
    ),
    listNamespaces: Effect.fn("GitLabSourceControlProvider.listNamespaces")(function (input) {
      return api
        .listNamespaces(input)
        .pipe(Effect.mapError((error) => toGitLabApiProviderError("listNamespaces", error)));
    }),
    listRepositories: Effect.fn("GitLabSourceControlProvider.listRepositories")(function (input) {
      return api
        .listRepositories(input)
        .pipe(Effect.mapError((error) => toGitLabApiProviderError("listRepositories", error)));
    }),
    getCloneHttpAuth: Effect.fn("GitLabSourceControlProvider.getCloneHttpAuth")(function* (input) {
      const credential = yield* credentials
        .get(input.host)
        .pipe(Effect.orElseSucceed(() => Option.none<GitLabCredentials.GitLabCredential>()));
      if (Option.isNone(credential)) return null;
      // GitLab accepts `oauth2` as the HTTP Basic username for PATs, project tokens, and group tokens.
      return {
        username: "oauth2",
        token: credential.value.token,
      };
    }),
    createRepository: Effect.fn("GitLabSourceControlProvider.createRepository")(function (input) {
      return gitlab.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: SourceControlProviderKind.make("gitlab"),
              operation: "createRepository",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      );
    }),
    getDefaultBranch: Effect.fn("GitLabSourceControlProvider.getDefaultBranch")(function (input) {
      return gitlab.getDefaultBranch(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: SourceControlProviderKind.make("gitlab"),
              operation: "getDefaultBranch",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      );
    }),
    checkoutChangeRequest: Effect.fn("GitLabSourceControlProvider.checkoutChangeRequest")(
      function (input) {
        return gitlab.checkoutMergeRequest(input).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: SourceControlProviderKind.make("gitlab"),
                operation: "checkoutChangeRequest",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.reference,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        );
      },
    ),
  });
});
