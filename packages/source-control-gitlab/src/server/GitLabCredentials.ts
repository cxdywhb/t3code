import {
  requireSettingsSecretLiteral,
  type ServerSettings,
  type SettingsSecretUnresolvedError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/shared/definition";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as GitLabClient from "../shared/definition.ts";

export const GitLabCredentialSource = Schema.Literals(["settings", "env"]);
export type GitLabCredentialSource = typeof GitLabCredentialSource.Type;

export interface GitLabCredential {
  readonly host: string;
  readonly token: Redacted.Redacted<string>;
  readonly source: GitLabCredentialSource;
}

export interface GitLabConfiguredHostEntry {
  readonly host: string;
  readonly source: GitLabCredentialSource;
  readonly enabled: boolean;
  readonly token: Option.Option<Redacted.Redacted<string>>;
  readonly error?: string;
}

export class GitLabHostDisabledError extends Schema.TaggedError<GitLabHostDisabledError>()(
  "GitLabHostDisabledError",
  { host: Schema.String },
) {
  get userFacingDetail(): string {
    return `GitLab host ${this.host} is turned off in Settings → Source control & issues.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export class GitLabNotSignedInError extends Schema.TaggedError<GitLabNotSignedInError>()(
  "GitLabNotSignedInError",
  { host: Schema.String },
) {
  get userFacingDetail(): string {
    return `No GitLab token configured for ${this.host}. Add a Personal Access Token in Settings → Source control & issues, or authenticate with \`glab auth login\`.`;
  }

  override get message(): string {
    return this.userFacingDetail;
  }
}

export type GitLabCredentialLookupError = GitLabHostDisabledError | SettingsSecretUnresolvedError;

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

/** Normalize a bare hostname or pasted URL such as `https://gitlab.example.com/` to `gitlab.example.com`. */
export function normalizeGitLabHost(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) {
    const parsed = URL.parse(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (parsed?.host) return parsed.host.toLowerCase();
  }
  return trimmed.replace(/\/+$/u, "").toLowerCase();
}

export function isValidGitLabHost(host: string): boolean {
  return HOSTNAME_PATTERN.test(host);
}

/**
 * Restrict `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` to `GITLAB_HOST` (or `gitlab.com` when unset)
 * so ambient tokens are never sent to arbitrary remote hostnames.
 */
function environmentGitLabToken(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (!isValidGitLabHost(host)) return null;
  const envHost = normalizeGitLabHost(env.GITLAB_HOST ?? "") || "gitlab.com";
  if (host !== envHost) return null;
  for (const name of ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function environmentGitLabHost(
  env: Readonly<Record<string, string | undefined>>,
): { readonly host: string; readonly token: string } | null {
  const host = normalizeGitLabHost(env.GITLAB_HOST ?? "") || "gitlab.com";
  if (!isValidGitLabHost(host)) return null;
  const token = environmentGitLabToken(host, env);
  return token ? { host, token } : null;
}

export class GitLabCredentials extends Context.Service<
  GitLabCredentials,
  {
    readonly get: (
      host: string,
    ) => Effect.Effect<Option.Option<GitLabCredential>, GitLabCredentialLookupError>;
    readonly configuredHosts: Effect.Effect<ReadonlyArray<GitLabConfiguredHostEntry>>;
    readonly defaultHost: Effect.Effect<string | null>;
    readonly hasConfiguredHost: (host: string) => Effect.Effect<boolean>;
  }
>()("@t3tools/source-control-gitlab/server/GitLabCredentials") {}

/** @public */
export const make = Effect.gen(function* () {
  const sourceControlHost = yield* SourceControlHost.SourceControlHost;
  const environment = yield* HostProcess.Environment;

  const readSettings = (settings: ServerSettings) =>
    readSourceControlHostSettings(
      GitLabClient.settings,
      settings.sourceControlHosts[GitLabClient.definition.kind],
    );

  const loadSettingsWithSecrets = sourceControlHost.settings
    .getWithSecrets(GitLabClient.definition.kind)
    .pipe(Effect.orElseSucceed(() => undefined));

  const findHostChoice = (settings: GitLabClient.GitLabSettings, normalizedHost: string) => {
    for (const [rawKey, choice] of Object.entries(settings.hosts)) {
      if (normalizeGitLabHost(rawKey) === normalizedHost) return choice;
    }
    return undefined;
  };

  const findSavedTokenEntry = (settings: GitLabClient.GitLabSettings, normalizedHost: string) => {
    for (const [rawKey, value] of Object.entries(settings.tokens)) {
      if (normalizeGitLabHost(rawKey) === normalizedHost) return value;
    }
    return undefined;
  };

  const get: GitLabCredentials["Service"]["get"] = Effect.fn("GitLabCredentials.get")(function* (
    rawHost: string,
  ) {
    const host = normalizeGitLabHost(rawHost);
    if (!isValidGitLabHost(host)) return Option.none<GitLabCredential>();

    const current = yield* loadSettingsWithSecrets;
    const settings = readSettings(
      current ?? ({ sourceControlHosts: {}, secretProviders: {} } as unknown as ServerSettings),
    );
    if (findHostChoice(settings, host)?.enabled === false) {
      return yield* new GitLabHostDisabledError({ host });
    }

    const rawSavedToken = findSavedTokenEntry(settings, host);
    if (rawSavedToken !== undefined) {
      const literal = yield* requireSettingsSecretLiteral(
        rawSavedToken,
        current?.secretProviders ?? {},
      );
      const trimmed = literal.trim();
      if (trimmed.length > 0) {
        return Option.some<GitLabCredential>({
          host,
          token: Redacted.make(trimmed),
          source: "settings",
        });
      }
    }

    const fromEnv = environmentGitLabToken(host, environment);
    if (fromEnv !== null) {
      return Option.some<GitLabCredential>({
        host,
        token: Redacted.make(fromEnv),
        source: "env",
      });
    }

    return Option.none<GitLabCredential>();
  });

  const configuredHosts: GitLabCredentials["Service"]["configuredHosts"] = Effect.gen(function* () {
    const current = yield* loadSettingsWithSecrets;
    const settings = readSettings(
      current ?? ({ sourceControlHosts: {}, secretProviders: {} } as unknown as ServerSettings),
    );
    const byHost = new Map<string, GitLabConfiguredHostEntry>();

    for (const [rawKey, rawToken] of Object.entries(settings.tokens)) {
      const host = normalizeGitLabHost(rawKey);
      if (!isValidGitLabHost(host)) continue;
      const enabled = findHostChoice(settings, host)?.enabled !== false;
      const resolved = yield* Effect.result(
        requireSettingsSecretLiteral(rawToken, current?.secretProviders ?? {}),
      );
      if (Result.isFailure(resolved)) {
        byHost.set(host, {
          host,
          source: "settings",
          enabled,
          token: Option.none(),
          error: resolved.failure.message,
        });
        continue;
      }
      const trimmed = resolved.success.trim();
      if (trimmed.length === 0) continue;
      byHost.set(host, {
        host,
        source: "settings",
        enabled,
        token: Option.some(Redacted.make(trimmed)),
      });
    }

    const envEntry = environmentGitLabHost(environment);
    if (envEntry !== null && !byHost.has(envEntry.host)) {
      const enabled = findHostChoice(settings, envEntry.host)?.enabled !== false;
      byHost.set(envEntry.host, {
        host: envEntry.host,
        source: "env",
        enabled,
        token: Option.some(Redacted.make(envEntry.token)),
      });
    }

    return Array.from(byHost.values());
  });

  const defaultHost: GitLabCredentials["Service"]["defaultHost"] = configuredHosts.pipe(
    Effect.map((entries) => {
      const active = entries.find((entry) => entry.enabled && Option.isSome(entry.token));
      return active?.host ?? null;
    }),
  );

  const hasConfiguredHost: GitLabCredentials["Service"]["hasConfiguredHost"] = Effect.fn(
    "GitLabCredentials.hasConfiguredHost",
  )(function* (rawHost: string) {
    const host = normalizeGitLabHost(rawHost);
    if (!isValidGitLabHost(host)) return false;
    const entries = yield* configuredHosts;
    return entries.some((entry) => entry.host === host);
  });

  return GitLabCredentials.of({
    get,
    configuredHosts,
    defaultHost,
    hasConfiguredHost,
  });
});

export const layer = Layer.effect(GitLabCredentials, make);
