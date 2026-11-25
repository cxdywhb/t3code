import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  IssueAutomationPlatformKind,
  type IssueAutomationPlatformDescriptor,
  type IssueAutomationWriteKind,
} from "@t3tools/contracts";

import { McpConnectionError } from "../../IssueAutomationMcp.ts";
import type {
  IssuePlatformPlugin,
  PlatformIssueSummary,
} from "../../plugin/IssuePlatformPlugin.ts";
import {
  buildZenTaoBugWebUrl,
  cleanUserDisplayName,
  decodeHtmlEntities,
  markdownToZenTaoHtml,
  normalizeZenTaoBaseUrl,
  sortZenTaoScopesDesc,
  zenTaoBugStatusLabel,
  zenTaoHtmlToMarkdown,
} from "./ZenTaoClient.ts";

const platform = IssueAutomationPlatformKind.make("zentao");

const descriptor: IssueAutomationPlatformDescriptor = {
  platform,
  displayName: "禅道 (MCP)",
  description: "通过兼容的禅道 MCP 服务读取产品和 Bug，并按服务权限写回",
  implemented: true,
  scopeNoun: "产品",
  issueNoun: "Bug",
  authFields: [
    {
      key: "mcpUrl",
      label: "MCP 服务地址",
      placeholder: "https://mcp.example.com/zentao/mcp",
      kind: "url",
      required: true,
    },
  ],
};

const readTools = ["list_products", "search_bugs", "get_bug"];
const writeTools = {
  comment: "add_bug_comment",
  confirm: "confirm_bug",
  resolve: "resolve_bug",
  close: "close_bug",
  activate: "activate_bug",
  create: "create_bug",
} satisfies Record<IssueAutomationWriteKind, string>;

const writeKinds = Object.keys(writeTools) as IssueAutomationWriteKind[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown) {
  return (Array.isArray(value) ? value : Object.values(record(value))).map(record);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function entries(value: unknown) {
  return Object.entries(record(value)).flatMap(([id, name]) =>
    id && id !== "_empty_" && typeof name === "string"
      ? [{ id, name: decodeHtmlEntities(name) }]
      : [],
  );
}

function normalizeZenTaoWebUrl(value: string): string {
  if (!value.trim()) return "";
  const url = URL.parse(value.trim());
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw McpConnectionError.create("请输入有效的禅道网页地址。");
  }
  return normalizeZenTaoBaseUrl(url.href);
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const block = records(result.content).find((item) => item.type === "text");
  let body: Record<string, unknown>;
  try {
    body = record(
      result.structuredContent ?? (typeof block?.text === "string" ? JSON.parse(block.text) : {}),
    );
  } catch {
    throw McpConnectionError.create("禅道 MCP 返回了无法识别的数据。");
  }
  const data = record(body.data ?? body);
  const errorCode = text(body.code ?? body.error ?? data.code ?? data.error);
  if (errorCode === "MCP_AUTH_INVALID" || errorCode === "401") {
    throw McpConnectionError.create("禅道 MCP 授权已失效，请重新授权。", true);
  }
  if (
    result.isError ||
    body.ok === false ||
    data.ok === false ||
    [body.status, body.result, data.status, data.result].some(
      (value) => value === "fail" || value === "error",
    )
  ) {
    throw McpConnectionError.create(
      `禅道 MCP 无法完成操作（${name}），请检查当前账号权限或工具参数。`,
    );
  }
  return data;
}

function parseId(value: string): number {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id < 1) {
    throw McpConnectionError.create("禅道 Bug 或产品编号无效。");
  }
  return id;
}

function issueUrl(baseUrl: string, issueId: string, supplied?: unknown): string {
  const url = URL.parse(text(supplied));
  if (url && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
    return url.href;
  }
  return baseUrl ? buildZenTaoBugWebUrl(baseUrl, issueId) : "";
}

function summarize(
  bug: Record<string, unknown>,
  data: Record<string, unknown>,
  scopeId: string,
  baseUrl: string,
): PlatformIssueSummary {
  const key = text(bug.id);
  const status = text(bug.status);
  const createdAt = text(bug.openedDate);
  const editedAt = text(bug.lastEditedDate);
  const moduleId = text(bug.module);
  const author = text(bug.openedBy);
  const assignee = text(bug.assignedTo);
  const users = record(data.users);
  const moduleName = text(bug.moduleName ?? record(data.modules)[moduleId]);
  return {
    key,
    displayKey: `#${key}`,
    scopeId: text(bug.product) || scopeId,
    scopeName: decodeHtmlEntities(text(data.productName ?? bug.productName)) || `产品 #${scopeId}`,
    title: decodeHtmlEntities(text(bug.title)),
    url: issueUrl(baseUrl, key, bug.url),
    moduleId: moduleId && moduleId !== "0" ? moduleId : null,
    moduleName: moduleName && moduleName !== "/" ? decodeHtmlEntities(moduleName) : null,
    severity: Number(text(bug.severity)) || null,
    priority: Number(text(bug.pri)) || null,
    status,
    statusLabel: text(bug.statusName) || zenTaoBugStatusLabel(status),
    confirmed: text(bug.confirmed) === "1",
    author: author ? cleanUserDisplayName(users[author], author) : null,
    assignee:
      assignee === "closed"
        ? "Closed"
        : assignee
          ? `${cleanUserDisplayName(users[assignee], assignee)} (${assignee})`
          : null,
    createdAt,
    updatedAt: editedAt && !editedAt.startsWith("0000-00-00") ? editedAt : createdAt,
  };
}

function downloadLinks(downloads: unknown): string[] {
  return records(downloads).flatMap((item) => {
    const url = URL.parse(text(item.downloadUrl ?? item.url));
    return url?.protocol === "https:" && !url.username && !url.password ? [url.href] : [];
  });
}

export function makeZenTaoPlatformPlugin(): IssuePlatformPlugin {
  return {
    kind: platform,
    descriptor,
    normalizeBaseUrl: normalizeZenTaoWebUrl,
    probeAndListScopes: ({ withClient }) =>
      withClient("zentao.probe", async (client) => {
        const names = new Set<string>();
        const cursors = new Set<string>();
        let nextCursor: string | undefined;
        do {
          const page = await client.listTools(
            nextCursor === undefined ? undefined : { cursor: nextCursor },
          );
          for (const tool of page.tools) names.add(tool.name);
          nextCursor = page.nextCursor;
          if (nextCursor !== undefined) {
            if (cursors.has(nextCursor) || cursors.size >= 100) {
              throw McpConnectionError.create("禅道 MCP 工具列表分页无效。");
            }
            cursors.add(nextCursor);
          }
        } while (nextCursor !== undefined);
        if (readTools.some((name) => !names.has(name))) {
          throw McpConnectionError.create("该 MCP 服务缺少禅道产品、搜索或详情工具。");
        }
        const scopes = new Map<string, { id: string; name: string }>();
        let totalPages = 1;
        for (let page = 1; page <= totalPages; page += 1) {
          const products = await callTool(client, "list_products", { page, pageSize: 100 });
          if (!isRecord(products.products)) {
            throw McpConnectionError.create("该 MCP 服务未返回兼容的禅道产品列表。");
          }
          for (const scope of entries(products.products)) scopes.set(scope.id, scope);
          if (page === 1) {
            const reported = Number(record(products.pager).pageTotal);
            if (reported > 100) {
              throw McpConnectionError.create("禅道 MCP 产品列表超过可验证的分页范围。");
            }
            if (Number.isInteger(reported) && reported > 0) totalPages = reported;
          }
        }
        return {
          scopes: sortZenTaoScopesDesc([...scopes.values()]),
          writeActions: writeKinds.filter((kind) => names.has(writeTools[kind])),
        };
      }),
    listIssues: ({ credentials, scopeId, browseType, keyword, page, pageSize }) =>
      credentials.withClient("zentao.listIssues", async (client) => {
        const unresolved = browseType === "unresolved";
        const data = await callTool(client, "search_bugs", {
          productID: parseId(scopeId),
          browseType: unresolved ? "all" : browseType,
          ...(unresolved ? { filters: [{ field: "status", operator: "=", value: "active" }] } : {}),
          page,
          pageSize,
          orderBy: "id_desc",
        });
        if (!Array.isArray(data.bugs) && (typeof data.bugs !== "object" || data.bugs === null)) {
          throw McpConnectionError.create("禅道 MCP 未返回兼容的 Bug 列表。");
        }
        const needle = keyword?.toLowerCase().trim() ?? "";
        const items = records(data.bugs)
          .map((bug) => summarize(bug, data, scopeId, credentials.baseUrl))
          .filter(
            (item) =>
              item.key &&
              item.scopeId === scopeId &&
              (!needle ||
                [item.title, item.key, item.moduleName].some((value) =>
                  value?.toLowerCase().includes(needle),
                )),
          );
        const total = Number(data.total ?? record(data.pager).recTotal);
        return {
          items,
          total: Number.isSafeInteger(total) && total >= 0 ? total : items.length,
          page,
          pageSize,
        };
      }),
    getIssueDetail: ({ credentials, scopeId, issueKey }) =>
      credentials.withClient("zentao.getIssueDetail", async (client) => {
        const data = await callTool(client, "get_bug", { bugID: parseId(issueKey) });
        const bug = record(data.bug);
        const issue = summarize(bug, data, scopeId, credentials.baseUrl);
        if (issue.key !== issueKey || issue.scopeId !== scopeId) {
          throw McpConnectionError.create("禅道 MCP 返回的 Bug 或产品编号与请求不符。");
        }
        const stepsHtml = text(bug.steps);
        const builds = entries(data.builds);
        const modulePath = records(data.modulePath)
          .map((item) => text(item.name))
          .filter(Boolean);
        return {
          ...issue,
          moduleName: modulePath.length ? modulePath.join(" / ") : issue.moduleName,
          stepsHtml,
          stepsMarkdown: zenTaoHtmlToMarkdown(stepsHtml, credentials.baseUrl, false),
          imageUrls: downloadLinks(record(data.imageDownloads).steps),
          openedBuild: text(bug.openedBuild) || "trunk",
          availableBuilds: builds.length ? builds : [{ id: "trunk", name: "Trunk" }],
          availableUsers: entries(data.users)
            .slice(0, 200)
            .map(({ id, name }) => ({
              account: id,
              name: cleanUserDisplayName(name, id),
            })),
          comments: records(data.actions)
            .map((action) => ({
              id: text(action.id) || "0",
              actor:
                text(action.actorName) ||
                cleanUserDisplayName(record(data.users)[text(action.actor)], text(action.actor)),
              action: text(action.action),
              createdAt: text(action.date),
              body: zenTaoHtmlToMarkdown(text(action.comment), credentials.baseUrl, false),
            }))
            .filter((action) => action.body || action.action !== "edited"),
        };
      }),
    writeBack: ({ credentials, action }) =>
      credentials.withClient("zentao.writeBack", async (client) => {
        const tool = writeTools[action.kind];
        if (action.kind === "create") {
          if (action.assignedTo) {
            throw McpConnectionError.create("请在创建后通过禅道指派 Bug。");
          }
          const created = await callTool(client, tool, {
            productID: parseId(action.scopeId),
            ...(action.moduleId && action.moduleId !== "0"
              ? { moduleID: parseId(action.moduleId) }
              : {}),
            title: action.title,
            steps: markdownToZenTaoHtml(action.steps),
            openedBuild: action.openedBuild || "trunk",
            severity: action.severity ?? 3,
            pri: action.priority ?? 3,
            type: "codeerror",
          });
          const id = text(created.bugID ?? created.bugId ?? created.id ?? record(created.bug).id);
          const url = id ? issueUrl(credentials.baseUrl, id, created.url) : "";
          return {
            ok: true,
            ...(id ? { createdIssueKey: id } : {}),
            ...(url ? { createdIssueUrl: url } : {}),
          };
        }
        if (action.kind === "activate" && action.assignedTo) {
          throw McpConnectionError.create("请在激活后通过禅道指派 Bug。");
        }
        const bugID = parseId(action.issueKey);
        const comment = action.comment ? markdownToZenTaoHtml(action.comment) : undefined;
        await callTool(client, tool, {
          bugID,
          ...(comment ? { comment } : {}),
          ...((action.kind === "confirm" || action.kind === "resolve") && action.assignedTo
            ? { assignedTo: action.assignedTo }
            : {}),
          ...(action.kind === "resolve"
            ? {
                resolution: action.resolution,
                ...(action.resolution === "fixed"
                  ? { resolvedBuild: action.resolvedBuild || "trunk" }
                  : {}),
              }
            : {}),
        });
        return { ok: true };
      }),
  };
}
