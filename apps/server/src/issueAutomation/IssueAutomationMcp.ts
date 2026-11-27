// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off
import * as NodeDns from "node:dns";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ISSUE_AUTOMATION_OAUTH_CALLBACK_PATH } from "@t3tools/contracts";
import {
  isLocalLoopbackHost,
  isPublicFaviconHost,
  normalizeHostname,
} from "@t3tools/shared/hostClassification";
import { oauthCallbackUrl } from "@t3tools/shared/oauthCallback";
import type * as Undici from "undici";
import * as Schema from "effect/Schema";

const { Agent } = NodeModule.createRequire(import.meta.url)("undici") as typeof Undici;

const manualCallbackUri = "http://127.0.0.1:37139/issue-automation/oauth/callback";
const timeoutMs = 20_000;

export class McpConnectionError extends Schema.TaggedError<
  McpConnectionError,
  { readonly brand: unique symbol }
>()("McpConnectionError", { message: Schema.String, needsAuthorization: Schema.Boolean }) {
  static create(message: string, needsAuthorization = false) {
    return new McpConnectionError({ message, needsAuthorization });
  }
}

export function parseMcpUrl(value: string): URL {
  const url = URL.parse(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw McpConnectionError.create(
      "请输入完整的 HTTPS MCP 服务地址，地址中不能含凭据、查询参数或片段。",
    );
  }
  return url;
}

export function automaticMcpCallback(baseUrl: string | undefined): URL | undefined {
  const base = baseUrl && URL.parse(baseUrl);
  if (!base || base.username || base.password) return undefined;
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && isLocalLoopbackHost(base.hostname))
  ) {
    return undefined;
  }
  return new URL(ISSUE_AUTOMATION_OAUTH_CALLBACK_PATH, base);
}

export function parseMcpCallback(
  value: string,
  state: string,
  redirectUri = manualCallbackUri,
): string | null {
  try {
    return oauthCallbackUrl(value, redirectUri, state).searchParams.get("code");
  } catch {
    throw McpConnectionError.create("授权未完成或回跳地址不匹配，请检查地址或重新发起授权。");
  }
}

const publicDispatcher = new Agent({
  connect: {
    lookup(host, options, callback) {
      NodeDns.lookup(host, { ...options, all: true }, (error, addresses) => {
        const allowed = addresses?.filter(({ address }) => isPublicFaviconHost(address)) ?? [];
        if (error || allowed.length === 0) {
          callback(error ?? new Error("OAuth discovery cannot reach a private address."), "", 0);
        } else if (options.all) {
          callback(null, allowed);
        } else {
          callback(null, allowed[0]!.address, allowed[0]!.family);
        }
      });
    },
  },
});

type McpFetch = NonNullable<
  ConstructorParameters<typeof StreamableHTTPClientTransport>[1]
>["fetch"];

function isOAuthMetadataUrl(url: URL): boolean {
  return /(?:^|\/)\.well-known\/(?:oauth-authorization-server|oauth-protected-resource|openid-configuration)(?:\/|$)/.test(
    url.pathname,
  );
}

function mcpFetch(endpoint: URL, signal: AbortSignal): NonNullable<McpFetch> {
  return async (input, init) => {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw McpConnectionError.create("MCP 及 OAuth 服务必须使用 HTTPS。");
    }
    const external = url.origin !== endpoint.origin;
    const host = normalizeHostname(url.hostname);
    if (external && !isPublicFaviconHost(host)) {
      throw McpConnectionError.create("MCP 授权服务指向了未经配置的内网地址。");
    }
    const requestInit = {
      ...init,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(timeoutMs),
        ...(init?.signal ? [init.signal] : []),
      ]),
      ...(external && !NodeNet.isIP(host)
        ? { dispatcher: publicDispatcher as unknown as NonNullable<RequestInit["dispatcher"]> }
        : {}),
    };
    const headers = new Headers(init?.headers);
    if (
      (init?.method ?? "GET").toUpperCase() !== "GET" ||
      !isOAuthMetadataUrl(url) ||
      headers.has("authorization") ||
      headers.has("cookie")
    ) {
      return fetch(url, { ...requestInit, redirect: "error" });
    }

    let metadataUrl = url;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(metadataUrl, {
        ...requestInit,
        credentials: "omit",
        redirect: "manual",
      });
      const location = response.headers.get("location");
      if (!location || ![301, 302, 303, 307, 308].includes(response.status)) return response;
      await response.body?.cancel();
      const next = URL.parse(location, metadataUrl.href);
      if (
        !next ||
        next.origin !== url.origin ||
        next.username ||
        next.password ||
        !isOAuthMetadataUrl(next)
      ) {
        throw McpConnectionError.create("MCP OAuth 元数据重定向地址无效。");
      }
      metadataUrl = next;
    }
    throw McpConnectionError.create("MCP OAuth 元数据重定向次数过多。");
  };
}

export interface StoredOAuth {
  readonly client: OAuthClientInformationMixed;
  readonly tokens: OAuthTokens;
  readonly redirectUri?: string;
}

export function readStoredOAuth(raw: string, endpoint: string): StoredOAuth | undefined {
  try {
    const { mcpUrl, client, tokens, redirectUri } = JSON.parse(raw);
    if (mcpUrl !== endpoint) return;
    return {
      client: OAuthClientInformationSchema.parse(client),
      tokens: OAuthTokensSchema.parse(tokens),
      ...(typeof redirectUri === "string" ? { redirectUri } : {}),
    };
  } catch {
    return undefined;
  }
}

export class McpAuthorization {
  private readonly endpoint: URL;
  private readonly state: string;
  readonly redirectUri: string;
  private client: OAuthClientInformationMixed | undefined;
  private tokens: OAuthTokens | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private verifier = "";
  authorizationUrl: string | undefined;
  tokensChanged = false;

  constructor(endpoint: URL, state: string, stored?: StoredOAuth, callbackUrl?: URL) {
    this.endpoint = endpoint;
    this.state = state;
    this.redirectUri = callbackUrl?.href ?? stored?.redirectUri ?? manualCallbackUri;
    this.client = stored?.client;
    this.tokens = stored?.tokens;
    this.provider = this.makeProvider();
  }

  private readonly provider: OAuthClientProvider;

  private makeProvider(): OAuthClientProvider {
    return {
      redirectUrl: this.redirectUri,
      clientMetadata: {
        client_name: "T3 Code",
        redirect_uris: [this.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      state: () => this.state,
      clientInformation: () => this.client,
      saveClientInformation: (client) => {
        this.client = client;
      },
      tokens: () => this.tokens,
      saveTokens: (tokens) => {
        this.tokens =
          tokens.refresh_token || !this.tokens?.refresh_token
            ? tokens
            : { ...tokens, refresh_token: this.tokens.refresh_token };
        this.tokensChanged = true;
      },
      redirectToAuthorization: (url) => {
        if (url.protocol !== "https:" || url.username || url.password) {
          throw McpConnectionError.create("MCP 授权页面必须使用 HTTPS。");
        }
        this.authorizationUrl = url.href;
      },
      saveCodeVerifier: (verifier) => {
        this.verifier = verifier;
      },
      codeVerifier: () => this.verifier,
      discoveryState: () => this.discovery,
      saveDiscoveryState: (discovery) => {
        this.discovery = discovery;
      },
    };
  }

  get credentials(): StoredOAuth | undefined {
    return this.client && this.tokens
      ? { client: this.client, tokens: this.tokens, redirectUri: this.redirectUri }
      : undefined;
  }

  async withClient<A>(
    signal: AbortSignal,
    run: (client: Client) => Promise<A>,
    authorizationCode?: string,
  ): Promise<A> {
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      authProvider: this.provider,
      fetch: mcpFetch(this.endpoint, signal),
    });
    const client = new Client({ name: "t3-code", version: "1" });
    try {
      if (authorizationCode !== undefined) await transport.finishAuth(authorizationCode);
      await client.connect(transport);
      return await run(client);
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        (this.authorizationUrl !== undefined && this.tokens)
      ) {
        throw McpConnectionError.create("禅道 MCP 授权已失效，请重新授权。", true);
      }
      throw error;
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }
}
