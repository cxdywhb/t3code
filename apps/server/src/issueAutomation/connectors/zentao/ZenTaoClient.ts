// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off globalDate:off globalFetchInEffect:off globalTimersInEffect:off
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  IssueAutomationError,
  type IssueAutomationBrowseFilter,
  type IssueAutomationRemoteComment,
  type IssueAutomationRemoteScope,
  type IssueAutomationWriteBackAction,
  type IssueAutomationWriteBackResult,
} from "@t3tools/contracts";

import type {
  PlatformCredentials,
  PlatformDownloadedAsset,
  PlatformIssueDetail,
  PlatformIssuePage,
  PlatformIssueSummary,
  PlatformProbeResult,
} from "../../plugin/IssuePlatformPlugin.ts";

interface ZenTaoServerConfig {
  readonly version: string | null;
  readonly requestType: "PATH_INFO" | "GET";
  readonly requestFix: string;
  readonly sessionName: string;
  readonly sessionID: string;
  readonly rand: number;
}

interface CachedSession {
  readonly baseUrl: string;
  readonly account: string;
  readonly secretHash: string;
  readonly config: ZenTaoServerConfig;
  readonly viewerName: string;
  readonly expiresAtMs: number;
}

const SESSION_TTL_MS = 25 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const DISCOVERY_FALLBACK_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_PROBES = 10;
const COMMON_ZENTAO_SUBPATHS = ["/zentao", "/pro", "/biz", "/max", "/pms"] as const;

function md5Hex(input: string): string {
  return NodeCrypto.createHash("md5").update(input).digest("hex");
}

function hasExplicitHttpScheme(rawUrl: string): boolean {
  return /^https?:\/\//i.test(rawUrl.trim());
}

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function inferDefaultScheme(hostWithoutScheme: string): "http" | "https" {
  const authority = hostWithoutScheme.split(/[/?#]/, 1)[0] ?? "";
  // Parse with `https://` so an explicit `:80` is preserved on `parsed.port`.
  const parsed = parseHttpUrl(`https://${authority}`);
  if (!parsed) return "https";
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.port === "80" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return "http";
  }
  return "https";
}

/**
 * Normalizes any ZenTao page URL (e.g. `https://zentao.example.com/zentao/bug-browse.html` or
 * `http://pms.example.internal/index.php?m=bug&f=browse`) into its clean base root (`https://zentao.example.com/zentao`).
 */
export function normalizeZenTaoBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withoutProtoRelative = trimmed.replace(/^\/\/+/, "");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(withoutProtoRelative)
    ? withoutProtoRelative
    : `${inferDefaultScheme(withoutProtoRelative)}://${withoutProtoRelative}`;
  const parsed = parseHttpUrl(candidate);
  if (!parsed) {
    return trimmed.replace(/\/+$/, "");
  }

  let pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  // Strip known ZenTao controller pages like /bug-browse.html, /my.html, /user-login-<b64>.html, /index.php/..., /api.php/v1
  pathname = pathname
    .replace(/\/(?:index|api)\.php(?:\/.*)?$/i, "")
    .replace(/\/[^/]+\.(?:html?|json|php)$/i, "")
    .replace(/\/+$/, "");

  return `${parsed.origin}${pathname}`;
}

function extractZenTaoRedirectCandidates(html: string, pageUrl: string): string[] {
  const originUrl = parseHttpUrl(pageUrl);
  if (!originUrl || !html) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (rawTarget: string) => {
    const target = rawTarget.trim();
    if (
      !target ||
      target.startsWith("#") ||
      target.startsWith("?") ||
      /^(?:javascript|mailto|data|tel):/i.test(target)
    ) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(target, originUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (resolved.hostname.toLowerCase() !== originUrl.hostname.toLowerCase()) return;
    const normalized = normalizeZenTaoBaseUrl(resolved.toString());
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  for (const match of html.matchAll(
    /\b(?:(?:window|self|top)\.)?location\.(?:replace|assign)\(\s*['"]([^'"]+)['"]\s*\)/gi,
  )) {
    if (match[1]) pushCandidate(match[1]);
  }

  for (const match of html.matchAll(
    /\b(?:(?:window|self|top)\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/gi,
  )) {
    if (match[1]) pushCandidate(match[1]);
  }

  for (const match of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*['"]?refresh['"]?[^>]*>/gi)) {
    const contentMatch = /\bcontent\s*=\s*['"]([^'"]+)['"]/i.exec(match[0]);
    if (!contentMatch?.[1]) continue;
    const urlMatch = /(?:^|;)\s*url\s*=\s*['"]?([^'";\s]+)['"]?/i.exec(contentMatch[1]);
    if (urlMatch?.[1]) pushCandidate(urlMatch[1]);
  }

  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    if (!/\bid\s*=\s*['"](?:zentao|zentaopro|zentaobiz|zentaomax)['"]/i.test(attrs)) continue;
    const hrefMatch = /\bhref\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    if (hrefMatch?.[1]) pushCandidate(hrefMatch[1]);
  }

  for (const match of html.matchAll(
    /\b(?:href|src)\s*=\s*['"]([^'"]*?)(?:\/theme\/zui\/|\/js\/jquery\/lib\.js)[^'"]*['"]/gi,
  )) {
    pushCandidate(match[1] || "/");
  }

  return candidates;
}

function buildZenTaoEndpoint(
  baseUrl: string,
  config: Pick<ZenTaoServerConfig, "requestType" | "requestFix" | "sessionName" | "sessionID">,
  moduleName: string,
  methodName: string,
  params: ReadonlyArray<string> = [],
): string {
  const sidQuery = `${encodeURIComponent(config.sessionName)}=${encodeURIComponent(config.sessionID)}`;
  if (config.requestType === "GET") {
    const paramPairs = params.length > 0 ? `&params=${encodeURIComponent(params.join(","))}` : "";
    return `${baseUrl}/index.php?m=${encodeURIComponent(moduleName)}&f=${encodeURIComponent(methodName)}&t=json${paramPairs}&${sidQuery}`;
  }
  const fix = config.requestFix || "-";
  const suffix = params.length > 0 ? `${fix}${params.join(fix)}` : "";
  return `${baseUrl}/${moduleName}${fix}${methodName}${suffix}.json?${sidQuery}`;
}

function buildZenTaoBugWebUrl(baseUrl: string, bugId: string): string {
  return `${baseUrl}/bug-view-${encodeURIComponent(bugId)}.html`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/** Converts ZenTao's rich HTML steps/comments into clean, readable Markdown for LLM context. */
export function zenTaoHtmlToMarkdown(html: string, baseUrl: string): string {
  if (!html || html.trim().length === 0) return "";
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return baseUrl;
    }
  })();

  const converted = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
      const hashes = "#".repeat(Number(level));
      return `\n${hashes} ${content.replace(/<[^>]+>/g, "").trim()}\n`;
    })
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code) => {
      const text = decodeHtmlEntities(String(code).replace(/<[^>]+>/g, ""));
      return `\n\`\`\`\n${text.trim()}\n\`\`\`\n`;
    })
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, rawSrc) => {
      const resolved = resolveZenTaoImageUrl(String(rawSrc), baseUrl, origin);
      return resolved ? `\n![截图](${resolved})\n` : "";
    })
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(converted)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveZenTaoImageUrl(rawSrc: string, baseUrl: string, origin: string): string | null {
  const trimmed = rawSrc.trim();
  if (!trimmed) return null;
  // Classic ZenTao inline placeholder `{10001.png}` -> `${baseUrl}/file-read-10001.png`
  const braceMatch = /^\{(\d+)\.([a-z0-9]+)\}$/i.exec(trimmed);
  if (braceMatch) {
    return `${baseUrl}/file-read-${braceMatch[1]}.${braceMatch[2]}`;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${origin}${trimmed}`;
  return `${baseUrl}/${trimmed}`;
}

export function extractZenTaoImageUrls(html: string, baseUrl: string): string[] {
  if (!html) return [];
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return baseUrl;
    }
  })();
  const urls = new Set<string>();
  const regex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const resolved = resolveZenTaoImageUrl(match[1] ?? "", baseUrl, origin);
    if (resolved) urls.add(resolved);
  }
  return [...urls];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formats Markdown diagnosis reports into clean ZenTao-compatible HTML comments. */
export function markdownToZenTaoHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (trimmed.startsWith("<p>") || trimmed.startsWith("<div>")) {
    return trimmed;
  }
  const blocks: string[] = [];
  const parts = trimmed.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith("```") && part.endsWith("```")) {
      const lines = part.slice(3, -3).split("\n");
      const codeBody = lines.length > 1 ? lines.slice(1).join("\n") : lines.join("\n");
      blocks.push(`<pre class="prettyprint">${escapeHtml(codeBody.trim())}</pre>`);
      continue;
    }
    for (const rawLine of part.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("### ")) {
        blocks.push(`<p><strong>${escapeHtml(line.slice(4))}</strong></p>`);
      } else if (line.startsWith("## ")) {
        blocks.push(`<p><strong>【${escapeHtml(line.slice(3))}】</strong></p>`);
      } else if (line.startsWith("# ")) {
        blocks.push(`<p><strong>${escapeHtml(line.slice(2))}</strong></p>`);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        const inline = escapeHtml(line.slice(2))
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
        blocks.push(`<p>• ${inline}</p>`);
      } else {
        const inline = escapeHtml(line)
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
        blocks.push(`<p>${inline}</p>`);
      }
    }
  }
  return blocks.join("\n");
}

function cleanUserDisplayName(raw: unknown, fallbackAccount: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallbackAccount;
  // ZenTao prefixes user maps with an initial letter like `A:Alice`
  return raw.replace(/^[A-Za-z]:/, "").trim() || fallbackAccount;
}

function statusLabelOf(status: string): string {
  switch (status) {
    case "active":
      return "激活";
    case "resolved":
      return "已解决";
    case "closed":
      return "已关闭";
    default:
      return status || "未知";
  }
}

function compareZenTaoScopeIdDesc(
  a: Pick<IssueAutomationRemoteScope, "id">,
  b: Pick<IssueAutomationRemoteScope, "id">,
): number {
  const numA = Number(a.id);
  const numB = Number(b.id);
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
    return numB - numA;
  }
  return b.id.localeCompare(a.id, undefined, { numeric: true });
}

export function sortZenTaoScopesDesc(
  scopes: ReadonlyArray<IssueAutomationRemoteScope>,
): IssueAutomationRemoteScope[] {
  return [...scopes].toSorted(compareZenTaoScopeIdDesc);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapZenTaoData(outer: unknown): Record<string, unknown> {
  if (!isRecord(outer)) return {};
  if (typeof outer.data === "string") {
    try {
      const parsed: unknown = JSON.parse(outer.data);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return outer;
    }
  }
  if (isRecord(outer.data)) {
    return outer.data;
  }
  return outer;
}

interface FetchedTextResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly contentType: string;
  readonly text: string;
}

function isZenTaoConfigPayload(cfgObj: Record<string, unknown>): boolean {
  return (
    (typeof cfgObj.sessionID === "string" && cfgObj.sessionID.length > 0) ||
    (typeof cfgObj.sessionName === "string" && cfgObj.sessionName.length > 0) ||
    cfgObj.requestType === "PATH_INFO" ||
    cfgObj.requestType === "GET"
  );
}

async function fetchTextWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<FetchedTextResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        ...init?.headers,
      },
    });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      url: response.url || url,
      contentType: response.headers.get("content-type") ?? "",
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchTextWithTimeout(url, init);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(
      `ZenTao returned non-JSON response (HTTP ${String(res.status)}): ${res.text.slice(0, 180)}`,
    );
  }
}

function buildOriginDiscoveryCandidates(startBaseUrl: string): string[] {
  const parsed = parseHttpUrl(startBaseUrl);
  if (!parsed) return [startBaseUrl];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  add(startBaseUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const prefix = i > 0 ? `/${segments.slice(0, i).join("/")}` : "";
    add(`${parsed.origin}${prefix}`);
  }
  for (const subpath of COMMON_ZENTAO_SUBPATHS) {
    add(`${parsed.origin}${subpath}`);
  }
  return candidates;
}

async function discoverZenTaoServerConfig(rawBaseUrl: string): Promise<{
  readonly baseUrl: string;
  readonly cfgObj: Record<string, unknown>;
}> {
  const primaryBaseUrl = normalizeZenTaoBaseUrl(rawBaseUrl);
  const primaryParsed = parseHttpUrl(primaryBaseUrl);
  if (!primaryParsed) {
    throw new Error(`禅道服务地址格式无效: ${rawBaseUrl.trim() || "(空)"}`);
  }

  const explicitScheme = hasExplicitHttpScheme(rawBaseUrl);
  const roundStarts = [primaryBaseUrl];
  if (!explicitScheme) {
    const flipped = new URL(primaryBaseUrl);
    flipped.protocol = primaryParsed.protocol === "https:" ? "http:" : "https:";
    const flippedNormalized = normalizeZenTaoBaseUrl(flipped.toString());
    if (flippedNormalized && flippedNormalized !== primaryBaseUrl) {
      roundStarts.push(flippedNormalized);
    }
  }

  const queue: string[] = [];
  const queuedSet = new Set<string>();
  const enqueueBack = (urls: ReadonlyArray<string>) => {
    for (const u of urls) {
      if (!queuedSet.has(u)) {
        queuedSet.add(u);
        queue.push(u);
      }
    }
  };
  const promoteFront = (urls: ReadonlyArray<string>) => {
    for (let i = urls.length - 1; i >= 0; i -= 1) {
      const u = urls[i];
      if (!u) continue;
      const existingIdx = queue.indexOf(u);
      if (existingIdx !== -1) {
        queue.splice(existingIdx, 1);
      }
      queuedSet.add(u);
      queue.unshift(u);
    }
  };

  for (const start of roundStarts) {
    enqueueBack(buildOriginDiscoveryCandidates(start));
  }

  const visited = new Set<string>();
  const transportFailedOrigins = new Set<string>();
  let probeCount = 0;
  let primaryFailure: Error | null = null;

  while (queue.length > 0 && probeCount < MAX_DISCOVERY_PROBES) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    const candidateParsed = parseHttpUrl(candidate);
    if (!candidateParsed || transportFailedOrigins.has(candidateParsed.origin)) continue;

    visited.add(candidate);
    probeCount += 1;
    const timeoutMs = probeCount === 1 ? REQUEST_TIMEOUT_MS : DISCOVERY_FALLBACK_TIMEOUT_MS;
    const requestUrl = `${candidate}/index.php?mode=getconfig`;

    let res: FetchedTextResponse;
    try {
      res = await fetchTextWithTimeout(requestUrl, undefined, timeoutMs);
    } catch (cause) {
      transportFailedOrigins.add(candidateParsed.origin);
      primaryFailure ??= cause instanceof Error ? cause : new Error(`请求 ${requestUrl} 失败`);
      continue;
    }

    const effectiveUrl = res.url && parseHttpUrl(res.url) ? res.url : requestUrl;
    const effectiveParsed = parseHttpUrl(effectiveUrl);
    const redirectedBase = normalizeZenTaoBaseUrl(effectiveUrl);

    try {
      const parsedJson: unknown = JSON.parse(res.text);
      const cfgObj = unwrapZenTaoData(parsedJson);
      if (isZenTaoConfigPayload(cfgObj)) {
        return {
          baseUrl: redirectedBase || candidate,
          cfgObj,
        };
      }
      primaryFailure ??= new Error(`ZenTao config payload invalid (HTTP ${String(res.status)})`);
    } catch {
      const snippet = res.text.replace(/\s+/g, " ").trim().slice(0, 140);
      primaryFailure ??= new Error(
        `ZenTao returned non-JSON response (HTTP ${String(res.status)})${snippet ? `: ${snippet}` : ""}`,
      );
    }

    const discovered: string[] = [];
    const seenDiscovered = new Set<string>();
    const addDiscovered = (u: string) => {
      if (u && u !== candidate && !visited.has(u) && !seenDiscovered.has(u)) {
        const parsedU = parseHttpUrl(u);
        if (parsedU && !transportFailedOrigins.has(parsedU.origin)) {
          seenDiscovered.add(u);
          discovered.push(u);
        }
      }
    };

    if (redirectedBase && redirectedBase !== candidate) {
      addDiscovered(redirectedBase);
    }
    for (const extracted of extractZenTaoRedirectCandidates(res.text, effectiveUrl)) {
      addDiscovered(extracted);
    }

    if (
      probeCount === 1 &&
      res.status >= 400 &&
      discovered.length === 0 &&
      candidateParsed.pathname === "/" &&
      probeCount < MAX_DISCOVERY_PROBES
    ) {
      probeCount += 1;
      try {
        const rootRes = await fetchTextWithTimeout(
          `${candidate}/`,
          undefined,
          DISCOVERY_FALLBACK_TIMEOUT_MS,
        );
        const rootEffectiveUrl =
          rootRes.url && parseHttpUrl(rootRes.url) ? rootRes.url : `${candidate}/`;
        const rootRedirectedBase = normalizeZenTaoBaseUrl(rootEffectiveUrl);
        if (rootRedirectedBase && rootRedirectedBase !== candidate) {
          addDiscovered(rootRedirectedBase);
        }
        for (const extracted of extractZenTaoRedirectCandidates(rootRes.text, rootEffectiveUrl)) {
          addDiscovered(extracted);
        }
      } catch {
        // Ignore root probe errors and proceed with subpath candidates.
      }
    }

    if (discovered.length > 0) {
      promoteFront(discovered);
    }

    if (effectiveParsed && effectiveParsed.origin !== candidateParsed.origin) {
      enqueueBack(COMMON_ZENTAO_SUBPATHS.map((subpath) => `${effectiveParsed.origin}${subpath}`));
    }
  }

  throw new Error(
    `无法在 ${primaryBaseUrl} 定位禅道服务入口（${primaryFailure?.message ?? "未找到有效的禅道接口"}），请确认地址是否正确或包含正确的子路径`,
  );
}

const isIssueAutomationError = Schema.is(IssueAutomationError);

function toZenTaoError(operation: string, cause: unknown): IssueAutomationError {
  if (isIssueAutomationError(cause)) return cause;
  const detail =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message.trim()
      : "禅道接口请求失败，请检查内网地址与账号密码";
  return new IssueAutomationError({ operation, detail, cause });
}

export class ZenTaoSessionClient {
  private readonly sessions = new Map<string, CachedSession>();

  private cacheKey(credentials: PlatformCredentials): string {
    return `${normalizeZenTaoBaseUrl(credentials.baseUrl)}::${credentials.account.trim()}`;
  }

  private clearSession(credentials: PlatformCredentials): void {
    const key = this.cacheKey(credentials);
    const existing = this.sessions.get(key);
    this.sessions.delete(key);
    if (existing) {
      this.sessions.delete(`${existing.baseUrl}::${credentials.account.trim()}`);
    }
  }

  private async authenticate(credentials: PlatformCredentials): Promise<CachedSession> {
    const secretHash = md5Hex(credentials.secret);
    const key = this.cacheKey(credentials);
    const existing = this.sessions.get(key);
    if (existing && existing.secretHash === secretHash && existing.expiresAtMs > Date.now()) {
      return existing;
    }

    // Step 1: Discover ZenTao root URL & server config (`index.php?mode=getconfig` works across ZenTao 8.x ~ 21.x)
    const { baseUrl, cfgObj } = await discoverZenTaoServerConfig(credentials.baseUrl);
    const requestType: "PATH_INFO" | "GET" = cfgObj.requestType === "GET" ? "GET" : "PATH_INFO";
    const requestFix = typeof cfgObj.requestFix === "string" ? cfgObj.requestFix : "-";
    let sessionName = typeof cfgObj.sessionName === "string" ? cfgObj.sessionName : "zentaosid";
    let sessionID = typeof cfgObj.sessionID === "string" ? cfgObj.sessionID : "";
    let rand = Number(cfgObj.rand ?? cfgObj.random ?? 0);
    const version = typeof cfgObj.version === "string" ? cfgObj.version : null;

    // Refresh explicit session ID via `api-getsessionid` so `verifyRand` is bound in PHP `$_SESSION`
    try {
      const sidEndpoint = buildZenTaoEndpoint(
        baseUrl,
        { requestType, requestFix, sessionName, sessionID },
        "api",
        "getSessionID",
      );
      const sidOuter = await fetchJsonWithTimeout(sidEndpoint);
      const sidData = unwrapZenTaoData(sidOuter);
      if (typeof sidData.sessionName === "string" && sidData.sessionName) {
        sessionName = sidData.sessionName;
      }
      if (typeof sidData.sessionID === "string" && sidData.sessionID) {
        sessionID = sidData.sessionID;
      }
      if (sidData.rand !== undefined || sidData.random !== undefined) {
        rand = Number(sidData.rand ?? sidData.random ?? rand);
      }
    } catch {
      // Keep getconfig values if api.getSessionID is restricted.
    }

    if (!sessionID) {
      throw new Error(`无法从 ${baseUrl} 获取禅道 Session，请确认地址是否正确`);
    }

    const config: ZenTaoServerConfig = {
      version,
      requestType,
      requestFix,
      sessionName,
      sessionID,
      rand,
    };

    const loginUrl = buildZenTaoEndpoint(baseUrl, config, "user", "login");
    const tryLogin = async (passwordValue: string, includeRand: boolean) => {
      const form = new URLSearchParams();
      form.set("account", credentials.account.trim());
      form.set("password", passwordValue);
      if (includeRand && rand > 0) {
        form.set("verifyRand", String(rand));
      }
      const res = await fetchJsonWithTimeout(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `${sessionName}=${sessionID}`,
        },
        body: form,
      });
      return isRecord(res) ? res : {};
    };

    let loginResult =
      rand > 0
        ? await tryLogin(md5Hex(md5Hex(credentials.secret) + String(rand)), true)
        : await tryLogin(credentials.secret, false);

    if (loginResult.status !== "success" && rand > 0) {
      loginResult = await tryLogin(credentials.secret, false);
    }

    if (loginResult.status !== "success") {
      const reason =
        typeof loginResult.reason === "string" && loginResult.reason.trim().length > 0
          ? loginResult.reason
          : "账号或密码错误";
      throw new Error(`禅道登录失败: ${reason}`);
    }

    const userObj = isRecord(loginResult.user) ? loginResult.user : {};
    const realname = typeof userObj.realname === "string" ? userObj.realname.trim() : "";
    const account =
      typeof userObj.account === "string" ? userObj.account.trim() : credentials.account.trim();
    const viewerName = realname ? `${realname} (${account})` : account;

    const session: CachedSession = {
      baseUrl,
      account,
      secretHash,
      config,
      viewerName,
      expiresAtMs: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(key, session);
    const resolvedKey = `${baseUrl}::${credentials.account.trim()}`;
    if (resolvedKey !== key) {
      this.sessions.set(resolvedKey, session);
    }
    return session;
  }

  private async requestData(
    credentials: PlatformCredentials,
    moduleName: string,
    methodName: string,
    params: ReadonlyArray<string> = [],
    postForm?: URLSearchParams,
  ): Promise<{
    readonly session: CachedSession;
    readonly outer: Record<string, unknown>;
    readonly data: Record<string, unknown>;
  }> {
    const attempt = async (forceRelogin: boolean) => {
      if (forceRelogin) {
        this.clearSession(credentials);
      }
      const session = await this.authenticate(credentials);
      const url = buildZenTaoEndpoint(
        session.baseUrl,
        session.config,
        moduleName,
        methodName,
        params,
      );
      const raw = await fetchJsonWithTimeout(url, {
        method: postForm ? "POST" : "GET",
        headers: {
          Cookie: `${session.config.sessionName}=${session.config.sessionID}`,
          ...(postForm ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(postForm ? { body: postForm } : {}),
      });
      const outer = isRecord(raw) ? raw : {};
      const locate = typeof outer.locate === "string" ? outer.locate : "";
      if (locate.includes("user-login") && !forceRelogin) {
        return null;
      }
      return { session, outer, data: unwrapZenTaoData(outer) };
    };

    const first = await attempt(false);
    if (first !== null) return first;
    const retried = await attempt(true);
    if (retried === null) {
      throw new Error("禅道会话已过期且重新登录失败");
    }
    return retried;
  }

  readonly probeAndListScopes = Effect.fn("ZenTaoSessionClient.probeAndListScopes")(
    (credentials: PlatformCredentials) =>
      Effect.tryPromise({
        try: async (): Promise<PlatformProbeResult> => {
          this.clearSession(credentials);
          const { session, data } = await this.requestData(credentials, "bug", "browse");
          const productsMap = isRecord(data.products) ? data.products : {};
          const scopes: IssueAutomationRemoteScope[] = sortZenTaoScopesDesc(
            Object.entries(productsMap)
              .filter(
                ([id, name]) => id !== "0" && typeof name === "string" && name.trim().length > 0,
              )
              .map(([id, name]) => ({
                id: id.trim(),
                name: decodeHtmlEntities(String(name).trim()),
              })),
          );

          return {
            normalizedBaseUrl: session.baseUrl,
            viewerName: session.viewerName,
            serverVersion: session.config.version,
            scopes,
          };
        },
        catch: (cause) => toZenTaoError("zentao.probe", cause),
      }),
  );

  readonly listIssues = Effect.fn("ZenTaoSessionClient.listIssues")(
    (input: {
      readonly credentials: PlatformCredentials;
      readonly scopeId: string;
      readonly browseType: IssueAutomationBrowseFilter;
      readonly keyword?: string | undefined;
      readonly page: number;
      readonly pageSize: number;
    }) =>
      Effect.tryPromise({
        try: async (): Promise<PlatformIssuePage> => {
          const { session, data } = await this.requestData(input.credentials, "bug", "browse", [
            input.scopeId,
            "0",
            input.browseType,
            "0",
            "id_desc",
            "0",
            String(input.pageSize),
            String(input.page),
          ]);

          const productName =
            typeof data.productName === "string" && data.productName.trim().length > 0
              ? decodeHtmlEntities(data.productName.trim())
              : `产品 #${input.scopeId}`;
          const usersMap = isRecord(data.users) ? data.users : {};
          const modulesMap = isRecord(data.modulePairs)
            ? data.modulePairs
            : isRecord(data.modules)
              ? data.modules
              : {};

          const rawBugs = Array.isArray(data.bugs)
            ? data.bugs
            : isRecord(data.bugs)
              ? Object.values(data.bugs)
              : [];
          const needle = input.keyword?.trim().toLowerCase() ?? "";

          const items: PlatformIssueSummary[] = rawBugs
            .filter(isRecord)
            .map((bug): PlatformIssueSummary => {
              const id = String(bug.id ?? "").trim();
              const moduleIdRaw = String(bug.module ?? "0").trim();
              const moduleNameRaw = modulesMap[moduleIdRaw];
              const moduleName =
                typeof moduleNameRaw === "string" &&
                moduleNameRaw.trim().length > 0 &&
                moduleNameRaw.trim() !== "/"
                  ? decodeHtmlEntities(moduleNameRaw.trim())
                  : null;
              const openedBy = String(bug.openedBy ?? "").trim();
              const assignedTo = String(bug.assignedTo ?? "").trim();
              const status = String(bug.status ?? "active").trim();
              const createdAt = String(bug.openedDate ?? "").trim();
              const editedAt = String(bug.lastEditedDate ?? "").trim();
              const updatedAt =
                editedAt && !editedAt.startsWith("0000-00-00") ? editedAt : createdAt;

              return {
                key: id,
                displayKey: `#${id}`,
                scopeId: String(bug.product ?? input.scopeId).trim() || input.scopeId,
                scopeName: productName,
                title: decodeHtmlEntities(String(bug.title ?? "").trim()),
                url: buildZenTaoBugWebUrl(session.baseUrl, id),
                moduleId: moduleIdRaw === "0" ? null : moduleIdRaw,
                moduleName,
                severity: bug.severity !== undefined ? Number(bug.severity) || null : null,
                priority: bug.pri !== undefined ? Number(bug.pri) || null : null,
                status,
                statusLabel: statusLabelOf(status),
                confirmed: String(bug.confirmed ?? "0") === "1",
                author: openedBy ? cleanUserDisplayName(usersMap[openedBy], openedBy) : null,
                assignee:
                  assignedTo && assignedTo !== "closed"
                    ? `${cleanUserDisplayName(usersMap[assignedTo], assignedTo)} (${assignedTo})`
                    : assignedTo === "closed"
                      ? "Closed"
                      : null,
                createdAt,
                updatedAt,
              };
            })
            .filter(
              (item) =>
                item.key.length > 0 &&
                (input.browseType !== "unresolved" ||
                  (item.status !== "resolved" && item.status !== "closed")) &&
                (needle.length === 0 ||
                  item.title.toLowerCase().includes(needle) ||
                  item.key.includes(needle) ||
                  (item.moduleName ?? "").toLowerCase().includes(needle)),
            );

          const pager = isRecord(data.pager) ? data.pager : {};
          const total = Number(pager.recTotal ?? items.length) || items.length;

          return {
            items,
            total,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        catch: (cause) => toZenTaoError("zentao.listIssues", cause),
      }),
  );

  readonly getIssueDetail = Effect.fn("ZenTaoSessionClient.getIssueDetail")(
    (input: {
      readonly credentials: PlatformCredentials;
      readonly scopeId: string;
      readonly issueKey: string;
    }) =>
      Effect.tryPromise({
        try: async (): Promise<PlatformIssueDetail> => {
          const { session, data } = await this.requestData(input.credentials, "bug", "view", [
            input.issueKey,
          ]);
          const bug = isRecord(data.bug) ? data.bug : null;
          if (!bug || !bug.id) {
            throw new Error(`未找到禅道 Bug #${input.issueKey}`);
          }

          const id = String(bug.id).trim();
          const usersMap = isRecord(data.users) ? data.users : {};
          const buildsMap = isRecord(data.builds) ? data.builds : {};
          const modulePathArr = Array.isArray(data.modulePath) ? data.modulePath : [];
          const moduleNames = modulePathArr
            .filter(isRecord)
            .map((m) => String(m.name ?? "").trim())
            .filter(Boolean);

          const stepsHtml = String(bug.steps ?? "");
          const stepsMarkdown = zenTaoHtmlToMarkdown(stepsHtml, session.baseUrl);
          const imageUrls = extractZenTaoImageUrls(stepsHtml, session.baseUrl);

          const rawActions = Array.isArray(data.actions)
            ? data.actions
            : isRecord(data.actions)
              ? Object.values(data.actions)
              : [];

          const comments: IssueAutomationRemoteComment[] = rawActions
            .filter(isRecord)
            .map((act): IssueAutomationRemoteComment => {
              const actorRaw = String(act.actor ?? "system").trim();
              const commentHtml = String(act.comment ?? "").trim();
              return {
                id: String(act.id ?? "0").trim() || "0",
                actor: cleanUserDisplayName(usersMap[actorRaw], actorRaw),
                action: String(act.action ?? "commented").trim(),
                createdAt: String(act.date ?? "").trim(),
                body: zenTaoHtmlToMarkdown(commentHtml, session.baseUrl),
              };
            })
            .filter((item) => item.body.length > 0 || item.action !== "edited");

          const availableBuilds = Object.entries(buildsMap)
            .filter(([bid, bname]) => bid.trim().length > 0 && typeof bname === "string")
            .map(([bid, bname]) => ({
              id: bid.trim(),
              name: String(bname).trim() || bid.trim(),
            }));

          const availableUsers = Object.entries(usersMap)
            .filter(([uacc, uname]) => uacc.trim().length > 0 && typeof uname === "string")
            .slice(0, 200)
            .map(([uacc, uname]) => ({
              account: uacc.trim(),
              name: cleanUserDisplayName(uname, uacc.trim()),
            }));

          const status = String(bug.status ?? "active").trim();
          const openedBy = String(bug.openedBy ?? "").trim();
          const assignedTo = String(bug.assignedTo ?? "").trim();
          const createdAt = String(bug.openedDate ?? "").trim();
          const editedAt = String(bug.lastEditedDate ?? "").trim();

          return {
            key: id,
            displayKey: `#${id}`,
            scopeId: String(bug.product ?? input.scopeId).trim() || input.scopeId,
            scopeName:
              typeof data.productName === "string" && data.productName.trim().length > 0
                ? decodeHtmlEntities(data.productName.trim())
                : `产品 #${input.scopeId}`,
            title: decodeHtmlEntities(String(bug.title ?? "").trim()),
            url: buildZenTaoBugWebUrl(session.baseUrl, id),
            moduleId: String(bug.module ?? "0") === "0" ? null : String(bug.module),
            moduleName: moduleNames.length > 0 ? moduleNames.join(" / ") : null,
            severity: bug.severity !== undefined ? Number(bug.severity) || null : null,
            priority: bug.pri !== undefined ? Number(bug.pri) || null : null,
            status,
            statusLabel: statusLabelOf(status),
            confirmed: String(bug.confirmed ?? "0") === "1",
            author: openedBy ? cleanUserDisplayName(usersMap[openedBy], openedBy) : null,
            assignee: assignedTo
              ? `${cleanUserDisplayName(usersMap[assignedTo], assignedTo)} (${assignedTo})`
              : null,
            createdAt,
            updatedAt: editedAt && !editedAt.startsWith("0000-00-00") ? editedAt : createdAt,
            stepsHtml,
            stepsMarkdown,
            imageUrls,
            openedBuild: String(bug.openedBuild ?? "trunk").trim() || "trunk",
            availableBuilds:
              availableBuilds.length > 0 ? availableBuilds : [{ id: "trunk", name: "Trunk" }],
            availableUsers,
            comments,
          };
        },
        catch: (cause) => toZenTaoError("zentao.getIssueDetail", cause),
      }),
  );

  readonly downloadAttachment = Effect.fn("ZenTaoSessionClient.downloadAttachment")(
    (input: { readonly credentials: PlatformCredentials; readonly url: string }) =>
      Effect.tryPromise({
        try: async (): Promise<PlatformDownloadedAsset> => {
          const session = await this.authenticate(input.credentials);
          const sidParam = `${encodeURIComponent(session.config.sessionName)}=${encodeURIComponent(session.config.sessionID)}`;
          const separator = input.url.includes("?") ? "&" : "?";
          const authedUrl = `${input.url}${separator}${sidParam}`;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          try {
            const response = await fetch(authedUrl, {
              signal: controller.signal,
              headers: {
                Cookie: `${session.config.sessionName}=${session.config.sessionID}`,
              },
            });
            if (!response.ok) {
              throw new Error(`下载禅道截图失败 (HTTP ${String(response.status)})`);
            }
            const mimeType =
              response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
            const arrayBuffer = await response.arrayBuffer();
            const ext =
              mimeType.includes("jpeg") || mimeType.includes("jpg")
                ? ".jpg"
                : mimeType.includes("gif")
                  ? ".gif"
                  : mimeType.includes("webp")
                    ? ".webp"
                    : ".png";
            const rawName = input.url.split("/").pop()?.split("?")[0] ?? `zentao-img${ext}`;
            const filename = /\.[a-z0-9]{2,5}$/i.test(rawName) ? rawName : `${rawName}${ext}`;
            return {
              filename,
              mimeType,
              bytes: new Uint8Array(arrayBuffer),
            };
          } finally {
            clearTimeout(timer);
          }
        },
        catch: (cause) => toZenTaoError("zentao.downloadAttachment", cause),
      }),
  );

  readonly writeBack = Effect.fn("ZenTaoSessionClient.writeBack")(
    (input: {
      readonly credentials: PlatformCredentials;
      readonly action: IssueAutomationWriteBackAction;
    }) =>
      Effect.tryPromise({
        try: async (): Promise<IssueAutomationWriteBackResult> => {
          const { action } = input;
          switch (action.kind) {
            case "comment": {
              const form = new URLSearchParams();
              form.set("comment", markdownToZenTaoHtml(action.comment));
              const { outer } = await this.requestData(
                input.credentials,
                "action",
                "comment",
                ["bug", action.issueKey],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "写入禅道评论失败"));
              }
              return { ok: true };
            }

            case "confirm": {
              const form = new URLSearchParams();
              if (action.assignedTo) form.set("assignedTo", action.assignedTo);
              if (action.comment) form.set("comment", markdownToZenTaoHtml(action.comment));
              const { outer } = await this.requestData(
                input.credentials,
                "bug",
                "confirmBug",
                [action.issueKey],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "确认禅道 Bug 失败"));
              }
              return { ok: true };
            }

            case "resolve": {
              const form = new URLSearchParams();
              form.set("resolution", action.resolution);
              form.set("resolvedBuild", action.resolvedBuild?.trim() || "trunk");
              if (action.assignedTo) form.set("assignedTo", action.assignedTo);
              if (action.comment) form.set("comment", markdownToZenTaoHtml(action.comment));
              const { outer } = await this.requestData(
                input.credentials,
                "bug",
                "resolve",
                [action.issueKey],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "更新禅道解决状态失败"));
              }
              return { ok: true };
            }

            case "close": {
              const form = new URLSearchParams();
              if (action.comment) form.set("comment", markdownToZenTaoHtml(action.comment));
              const { outer } = await this.requestData(
                input.credentials,
                "bug",
                "close",
                [action.issueKey],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "关闭禅道 Bug 失败"));
              }
              return { ok: true };
            }

            case "activate": {
              const form = new URLSearchParams();
              if (action.assignedTo) form.set("assignedTo", action.assignedTo);
              form.append("openedBuild[]", "trunk");
              if (action.comment) form.set("comment", markdownToZenTaoHtml(action.comment));
              const { outer } = await this.requestData(
                input.credentials,
                "bug",
                "activate",
                [action.issueKey],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "激活禅道 Bug 失败"));
              }
              return { ok: true };
            }

            case "create": {
              const form = new URLSearchParams();
              form.set("product", action.scopeId);
              form.set("module", action.moduleId?.trim() || "0");
              form.set("title", action.title);
              form.append("openedBuild[]", action.openedBuild?.trim() || "trunk");
              form.set("steps", markdownToZenTaoHtml(action.steps));
              form.set("severity", String(action.severity ?? 3));
              form.set("pri", String(action.priority ?? 3));
              form.set("type", "codeerror");
              if (action.assignedTo) form.set("assignedTo", action.assignedTo);

              const { session, outer } = await this.requestData(
                input.credentials,
                "bug",
                "create",
                [action.scopeId, "0", `moduleID=${action.moduleId?.trim() || "0"}`],
                form,
              );
              if (outer.result === "fail" || outer.status === "fail") {
                throw new Error(String(outer.message ?? "创建禅道问题失败"));
              }
              const createdId =
                typeof outer.id === "string" || typeof outer.id === "number"
                  ? String(outer.id)
                  : typeof outer.locate === "string"
                    ? /bug-view-(\d+)/.exec(outer.locate)?.[1]
                    : undefined;
              return {
                ok: true,
                ...(createdId
                  ? {
                      createdIssueKey: createdId,
                      createdIssueUrl: buildZenTaoBugWebUrl(session.baseUrl, createdId),
                    }
                  : {}),
              };
            }
          }
        },
        catch: (cause) => toZenTaoError("zentao.writeBack", cause),
      }),
  );
}
