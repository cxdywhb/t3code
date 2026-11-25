import type { IssueAutomationRemoteScope } from "@t3tools/contracts";

/**
 * Normalizes any ZenTao page URL (e.g. `https://zentao.example.com/zentao/bug-browse.html` or
 * `http://pms.example.internal/index.php?m=bug&f=browse`) into its clean base root (`https://zentao.example.com/zentao`).
 */
export function normalizeZenTaoBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return trimmed.replace(/\/+$/, "");
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  // Strip known ZenTao controller pages like /bug-browse.html, /my-index.html, /user-login.html, /index.php, /api.php/v1
  pathname = pathname
    .replace(/\/api\.php(?:\/.*)?$/i, "")
    .replace(/\/index\.php$/i, "")
    .replace(/\/[a-z0-9_]+-[a-z0-9_-]+\.(?:html|json|php)$/i, "");

  return `${parsed.origin}${pathname}`;
}

export function buildZenTaoBugWebUrl(baseUrl: string, bugId: string): string {
  return `${baseUrl}/bug-view-${encodeURIComponent(bugId)}.html`;
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/** Converts ZenTao's rich HTML steps/comments into clean, readable Markdown for LLM context. */
export function zenTaoHtmlToMarkdown(html: string, baseUrl: string, embedImages = true): string {
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
      const resolved = embedImages ? resolveZenTaoImageUrl(String(rawSrc), baseUrl, origin) : null;
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

export function cleanUserDisplayName(raw: unknown, fallbackAccount: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallbackAccount;
  // ZenTao prefixes user maps with an initial letter like `A:Alice`
  return raw.replace(/^[A-Za-z]:/, "").trim() || fallbackAccount;
}

export function zenTaoBugStatusLabel(status: string): string {
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
