import {
  COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS,
  PositiveInt,
  PrReviewFinding,
  PrReviewFindingSeverity,
  PrReviewVerdict,
  type OrchestrationMessageContext,
  type PrReviewModelRun,
  type PrReviewRole,
  type PrReviewSkillDescriptor,
  type PullRequestActivity,
  type PullRequestDetail,
  type ReviewCommentContextRecord,
  type SkillContextRecord,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const ROLE_LABELS_ZH: Record<PrReviewRole, string> = {
  comprehensive: "全面深度审查",
  correctness: "逻辑与并发正确性",
  security: "安全与权限边界",
  performance: "性能与资源开销",
  architecture: "架构与可维护性",
};

const ROLE_INSTRUCTIONS: Record<PrReviewRole, string> = {
  comprehensive:
    "从功能正确性、潜在 Bug、边界条件、异常处理、类型与契约一致性、可维护性进行全方位深度代码审查。",
  correctness:
    "重点审查业务逻辑正确性、异步竞态条件、空值/越界防御、状态流转闭环、错误恢复及极端边界场景。",
  security:
    "重点审查鉴权与越权风险、命令/SQL/XSS 注入、SSRF、敏感凭据或 Token 泄露、未校验外部输入及权限边界。",
  performance:
    "重点审查高频路径时间/空间复杂度、不必要的重复请求或锁竞争、内存泄漏、UI 重渲染开销及大数据量分页截断。",
  architecture:
    "重点审查模块职责边界、跨端/前后端契约兼容性、向后兼容风险、代码复用度及关键逻辑的可测试性。",
};

export const FUSION_BOT_SIGNATURE = "[T3-Multi-Model-Fusion-Review]";

const NOISE_OR_GENERATED_FILE_PATTERN =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Podfile\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|flake\.lock|go\.sum)$|(^|\/)(dist|build|coverage|vendor|node_modules|\.next|\.nuxt|__snapshots__|generated)\/|\.(min\.(js|css)|map|snap|pbxproj|lock|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar)$/iu;

type PrReviewPromptDetail = Pick<
  PullRequestDetail,
  | "provider"
  | "repository"
  | "number"
  | "title"
  | "body"
  | "url"
  | "state"
  | "isDraft"
  | "author"
  | "headBranch"
  | "baseBranch"
  | "headSha"
  | "additions"
  | "deletions"
  | "changedFiles"
>;

export interface DiffManifestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  readonly isLikelyGenerated: boolean;
}

export interface DiffFileManifest {
  readonly files: ReadonlyArray<DiffManifestFile>;
  readonly formattedManifest: string;
}

function clampField(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  let end = Math.max(0, maxChars - 1);
  const last = trimmed.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${trimmed.slice(0, end)}…`;
}

function parseDiffHeaderPath(headerLine: string): string | null {
  // Format: diff --git a/path/to/file b/path/to/file
  const bMarkerIndex = headerLine.lastIndexOf(" b/");
  if (bMarkerIndex !== -1) {
    const candidate = headerLine.slice(bMarkerIndex + 3).trim();
    return candidate.replace(/^"|"$/gu, "") || null;
  }
  const rest = headerLine.slice("diff --git ".length).trim();
  const parts = rest.split(/\s+/u);
  const last = parts.at(-1)?.replace(/^[ab]\//u, "") ?? "";
  return last || null;
}

export function parseDiffFileManifest(patch: string): DiffFileManifest {
  if (!patch.trim()) {
    return { files: [], formattedManifest: "（空 Diff）" };
  }

  const files: DiffManifestFile[] = [];
  let currentPath: string | null = null;
  let additions = 0;
  let deletions = 0;
  let isBinary = false;

  const flush = () => {
    if (!currentPath) return;
    files.push({
      path: currentPath,
      additions,
      deletions,
      isBinary,
      isLikelyGenerated: NOISE_OR_GENERATED_FILE_PATTERN.test(currentPath),
    });
  };

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentPath = parseDiffHeaderPath(line);
      additions = 0;
      deletions = 0;
      isBinary = false;
      continue;
    }
    if (!currentPath) continue;
    if (line.startsWith("+++ b/")) {
      const nextPath = line.slice(6).trim();
      if (nextPath && nextPath !== "/dev/null") {
        currentPath = nextPath;
      }
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      isBinary = true;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  flush();

  if (files.length === 0) {
    return {
      files: [],
      formattedManifest: "（未能解析出具体变更文件条目，请直接查看 diff.patch）",
    };
  }

  const formattedManifest = files
    .map((file) => {
      const stats = file.isBinary ? "[binary]" : `+${file.additions}/-${file.deletions}`;
      const noise = file.isLikelyGenerated ? " [generated/lock]" : "";
      return `- \`${file.path}\` (${stats})${noise}`;
    })
    .join("\n");

  return { files, formattedManifest };
}

export function buildPrContextDocument(input: {
  readonly detail: PrReviewPromptDetail;
  readonly activity: PullRequestActivity | null;
  readonly manifestText: string;
}): string {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;

  const commitLines =
    !input.activity || input.activity.commits.length === 0
      ? "（无提交记录摘要）"
      : input.activity.commits
          .slice(0, 30)
          .map((c) => `- \`${c.oid.slice(0, 8)}\` ${c.messageHeadline}`)
          .join("\n");

  const commentLines =
    !input.activity || input.activity.comments.length === 0
      ? "（暂无历史评审评论）"
      : input.activity.comments
          .slice(-20)
          .map(
            (c) =>
              `- **@${c.author?.login ?? "unknown"}** (${c.createdAt}):\n  ${c.body.slice(0, 1000).replace(/\n+/g, "\n  ")}`,
          )
          .join("\n");

  return [
    `# PR / Merge Request 上下文归档：${displayRef} - ${input.detail.title}`,
    "",
    "## 元数据",
    `- **仓库与编号**: \`${displayRef}\``,
    `- **链接**: ${input.detail.url}`,
    `- **作者**: @${input.detail.author?.login ?? "unknown"}`,
    `- **分支**: \`${input.detail.headBranch}\` → \`${input.detail.baseBranch}\`${input.detail.headSha ? ` (Head SHA: \`${input.detail.headSha}\`)` : ""}`,
    `- **规模**: +${input.detail.additions} / -${input.detail.deletions}（${input.detail.changedFiles} files）`,
    "",
    "## 变更说明 (Description)",
    input.detail.body.trim() || "（作者未填写描述）",
    "",
    "## 变更文件清单",
    input.manifestText,
    "",
    "## 提交记录",
    commitLines,
    "",
    "## 近期讨论评论",
    commentLines,
  ].join("\n");
}

function buildCompactManifestPreview(
  manifest: DiffFileManifest,
  contextFilePath: string,
): ReadonlyArray<string> {
  if (manifest.files.length === 0) {
    return ["- （未解析出文件清单，请按需查阅补丁与上下文文件）"];
  }
  if (manifest.files.length <= 20) {
    return manifest.files.map((file) => {
      const stats = file.isBinary ? "binary" : `+${file.additions}/-${file.deletions}`;
      return `- \`${file.path}\` (${stats})${file.isLikelyGenerated ? " [generated/lock]" : ""}`;
    });
  }
  const sourceFiles = manifest.files.filter((f) => !f.isLikelyGenerated);
  const generatedCount = manifest.files.length - sourceFiles.length;
  const shown = (sourceFiles.length > 0 ? sourceFiles : manifest.files).slice(0, 15);
  const omittedCount = manifest.files.length - shown.length;
  return [
    ...shown.map((file) => {
      const stats = file.isBinary ? "binary" : `+${file.additions}/-${file.deletions}`;
      return `- \`${file.path}\` (${stats})${file.isLikelyGenerated ? " [generated/lock]" : ""}`;
    }),
    `- ... 另有 ${omittedCount} 个文件未内联展示${generatedCount > 0 ? `（含 ${generatedCount} 个锁文件/产物/静态资源）` : ""}，完整清单请查看 \`${contextFilePath}\``,
  ];
}

function buildPullRequestContextBundle(input: {
  readonly detail: PrReviewPromptDetail;
  readonly instructionsText: string;
}): {
  readonly record: ReviewCommentContextRecord;
  readonly reference: string;
} {
  const contextId = toKindScopedComposerContextId(
    "review-comment",
    `pull-request-context:${input.detail.url}`,
  );
  const label = sanitizeComposerContextLabel(`#${input.detail.number}`, "review-comment");
  const record: ReviewCommentContextRecord = {
    version: 1,
    contextId,
    kind: "review-comment",
    label,
    sectionId: `pull-request:${input.detail.number}`,
    sectionTitle: `PR #${input.detail.number}`,
    filePath: `PR #${input.detail.number}`,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: clampField(input.detail.title, 500),
    text: clampField(input.instructionsText, COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS),
    diff: "",
    pullRequest: {
      number: PositiveInt.make(input.detail.number),
      title: clampField(input.detail.title, 500),
      url: clampField(input.detail.url, 2_000),
      headBranch: clampField(input.detail.headBranch, 500),
      baseBranch: clampField(input.detail.baseBranch, 500),
      state: input.detail.state,
      isDraft: input.detail.isDraft,
    },
  };
  return {
    record,
    reference: formatComposerContextReference({
      kind: "review-comment",
      contextId,
      label,
    }),
  };
}

function buildSkillContextBundle(skills: ReadonlyArray<PrReviewSkillDescriptor>): {
  readonly records: ReadonlyArray<SkillContextRecord>;
  readonly references: ReadonlyArray<string>;
} {
  const records: SkillContextRecord[] = [];
  const references: string[] = [];
  for (const skill of skills) {
    const contextId = toKindScopedComposerContextId("skill", skill.name);
    const label = sanitizeComposerContextLabel(skill.displayName || skill.name, "skill");
    records.push({
      version: 1,
      contextId,
      kind: "skill",
      label,
      name: skill.name,
    });
    references.push(
      formatComposerContextReference({
        kind: "skill",
        contextId,
        label,
      }),
    );
  }
  return { records, references };
}

export interface BuiltReviewMessage {
  readonly text: string;
  readonly context: OrchestrationMessageContext;
}

export function buildReviewerMessage(input: {
  readonly detail: PrReviewPromptDetail;
  readonly manifest: DiffFileManifest;
  readonly diffFilePath: string;
  readonly contextFilePath: string;
  readonly role: PrReviewRole;
  readonly isLocalCheckout: boolean;
  readonly workspaceRoot: string;
  readonly skills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly customInstructions: string | null;
  readonly interactiveDirectMode: boolean;
}): BuiltReviewMessage {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;
  const skillBundle = buildSkillContextBundle(input.skills);

  const hiddenLines = [
    `审查任务：${displayRef} - ${input.detail.title}`,
    `- 链接: ${input.detail.url}`,
    `- 作者: @${input.detail.author?.login ?? "unknown"} | 分支: ${input.detail.headBranch} -> ${input.detail.baseBranch}${input.detail.headSha ? ` (${input.detail.headSha.slice(0, 12)})` : ""}`,
    `- 变更规模: +${input.detail.additions} / -${input.detail.deletions}（共 ${input.detail.changedFiles} 个文件）`,
    `- 审查视角: ${ROLE_LABELS_ZH[input.role]}：${ROLE_INSTRUCTIONS[input.role]}`,
    "",
    "本地按需检索资料（首轮未内联全量 Diff 与评论，请按需读取以节省上下文 Token）：",
    `- 完整 Unified Diff 文件: ${input.diffFilePath}`,
    `- PR 描述、提交历史与评论归档: ${input.contextFilePath}`,
    input.isLocalCheckout
      ? `- 本地仓库源码目录: ${input.workspaceRoot}（可只读检索上下文类型与调用链，也可用 pull_request_read 工具按需查询）`
      : "- 运行模式: 云端远端仓库审查（本地无完整源码检出，请按需从 diff.patch 与 context.md 分段读取）",
    "",
    "节省 Token 审查策略：",
    "- 严禁修改、新建或删除任何项目源码文件，仅做只读代码分析。",
    "- 请先扫视下方变更文件清单；若 diff.patch 体积较大，切勿一次性全量读入，应跳过 lockfile / 构建产物 / 压缩文件 / 二进制资源，仅用 grep 或分段行号按需读取关键业务逻辑与高风险文件的变更 hunk。",
    "",
    "变更文件摘要：",
    ...buildCompactManifestPreview(input.manifest, input.contextFilePath),
    ...(input.skills.length > 0
      ? [
          "",
          "绑定的专业审查 Skills（请按需先读取以下 SKILL.md 规范后执行审查）：",
          ...input.skills.map(
            (s) =>
              `- ${s.displayName || s.name} (${s.name}): ${s.path}${s.description ? `：${s.description}` : ""}`,
          ),
        ]
      : []),
    ...(input.customInstructions?.trim()
      ? ["", `团队附加审查规范：${input.customInstructions.trim()}`]
      : []),
    "",
    "输出格式要求（请使用中文，每个问题给出准确文件路径、行号与触发机理）：",
    "1. `## 审查结论`：明确给出建议（Approve / Request Changes / Comment）与一句话总结；",
    "2. `## 发现的问题清单`：按严重度（[BLOCKER]、[MAJOR]、[MINOR]、[NIT]）列出 `文件路径:行号`、触发条件与修复建议；",
    "3. `## 风险点与验证建议`：简述潜在回归面与验证方式。",
    ...(input.interactiveDirectMode
      ? ["完成后开发者可能会在当前会话继续与你讨论该 PR/MR 的细节或让你协助回写评审意见。"]
      : []),
  ];

  const prBundle = buildPullRequestContextBundle({
    detail: input.detail,
    instructionsText: hiddenLines.join("\n"),
  });

  const visibleParts = [
    `请以「${ROLE_LABELS_ZH[input.role]}」视角审查 ${prBundle.reference}${skillBundle.references.length > 0 ? `，遵循 ${skillBundle.references.join(" ")}` : ""}。`,
    ...(input.customInstructions?.trim() ? [`附加要求：${input.customInstructions.trim()}`] : []),
  ];

  return {
    text: visibleParts.join("\n"),
    context: {
      version: 1,
      records: [prBundle.record, ...skillBundle.records],
    },
  };
}

export function buildReviewerReportsDocument(input: {
  readonly detail: PrReviewPromptDetail;
  readonly reviewerRuns: ReadonlyArray<PrReviewModelRun>;
}): string {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;
  const sections = input.reviewerRuns.map((run, idx) =>
    [
      `## 模型 #${idx + 1}：\`${run.modelLabel}\`（视角：${ROLE_LABELS_ZH[run.role]}）`,
      `- 状态: ${run.status}`,
      "",
      run.status === "completed" && run.reportMarkdown
        ? run.reportMarkdown.trim()
        : `（该模型执行未产出报告：${run.error ?? run.status}）`,
    ].join("\n"),
  );
  return [`# 并行模型独立审查报告汇总：${displayRef}`, "", ...sections].join("\n\n---\n\n");
}

export function buildSynthesizerMessage(input: {
  readonly detail: PrReviewPromptDetail;
  readonly diffFilePath: string;
  readonly contextFilePath: string;
  readonly reportsFilePath: string;
  readonly isLocalCheckout: boolean;
  readonly workspaceRoot: string;
  readonly reviewerRuns: ReadonlyArray<PrReviewModelRun>;
  readonly skills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly customInstructions: string | null;
}): BuiltReviewMessage {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;
  const skillBundle = buildSkillContextBundle(input.skills);

  const runSummaryLines = input.reviewerRuns.map((run, idx) => {
    const statusText =
      run.status === "completed"
        ? "completed"
        : `${run.status}${run.error ? ` (${run.error})` : ""}`;
    return `- #${idx + 1} \`${run.modelLabel}\`（${ROLE_LABELS_ZH[run.role]}）：${statusText}`;
  });

  const hiddenLines = [
    `多模型代码审查融合裁决任务：${displayRef} - ${input.detail.title}`,
    `- 链接: ${input.detail.url}`,
    `- 分支: ${input.detail.headBranch} -> ${input.detail.baseBranch} (+${input.detail.additions}/-${input.detail.deletions})`,
    "- 你担任首席架构师 / 多模型融合裁决官（Synthesizer & Judge），严禁修改任何项目源码文件。",
    "",
    "各并行模型审查报告与参考文件（已落盘以节省上下文 Token，请先读取汇总报告文件）：",
    `- 各模型完整审查报告汇总: ${input.reportsFilePath}`,
    `- 完整 Diff 补丁文件: ${input.diffFilePath}（仅在各模型结论存在分歧或行号存疑时按需定位核实）`,
    `- PR 描述与历史评论归档: ${input.contextFilePath}`,
    ...(input.isLocalCheckout ? [`- 本地仓库目录: ${input.workspaceRoot}`] : []),
    "",
    "参与审查模型：",
    ...runSummaryLines,
    ...(input.skills.length > 0
      ? [
          "",
          "绑定的专业审查 Skills：",
          ...input.skills.map((s) => `- ${s.displayName || s.name}: ${s.path}`),
        ]
      : []),
    ...(input.customInstructions?.trim()
      ? ["", `团队附加审查规范：${input.customInstructions.trim()}`]
      : []),
    "",
    "融合裁决输出要求（必须同时包含可读 Markdown 报告与末尾 JSON 结构块）：",
    "1. `## 总体裁决结论`：给出总体判定与核心理由；",
    "2. `## 多模型共识对比`：简述多模型共同命中的高置信问题与被剔除的误报；",
    "3. `## 核心问题汇总`：按严重级别列出真实有效问题、`file:line` 与修改建议；",
    "4. `## 合并前检查建议`。",
    "",
    "紧接着在回复最末尾附带标准 JSON 代码块（标记为 ```json:t3-pr-fusion ）：",
    "```json:t3-pr-fusion",
    "{",
    '  "verdict": "approve | request-changes | comment",',
    '  "findings": [',
    "    {",
    '      "severity": "blocker | major | minor | nit",',
    '      "title": "简明问题标题",',
    '      "filePath": "相对仓库根目录的文件路径或 null",',
    '      "line": 42,',
    '      "description": "问题根因与影响说明",',
    '      "suggestion": "具体修改建议或 null",',
    '      "raisedByModels": ["模型显示名1", "模型显示名2"]',
    "    }",
    "  ]",
    "}",
    "```",
  ];

  const prBundle = buildPullRequestContextBundle({
    detail: input.detail,
    instructionsText: hiddenLines.join("\n"),
  });

  const visibleParts = [
    `请作为多模型融合裁决官，综合各并行模型对 ${prBundle.reference} 的审查报告并输出最终融合裁决结论${skillBundle.references.length > 0 ? `，遵循 ${skillBundle.references.join(" ")}` : ""}。`,
    ...(input.customInstructions?.trim() ? [`附加要求：${input.customInstructions.trim()}`] : []),
  ];

  return {
    text: visibleParts.join("\n"),
    context: {
      version: 1,
      records: [prBundle.record, ...skillBundle.records],
    },
  };
}

const RawSynthesisPayload = Schema.Struct({
  verdict: Schema.optional(Schema.String),
  findings: Schema.optional(
    Schema.Array(
      Schema.Struct({
        severity: Schema.optional(Schema.String),
        title: Schema.optional(Schema.String),
        filePath: Schema.optional(Schema.NullOr(Schema.String)),
        line: Schema.optional(Schema.NullOr(Schema.Number)),
        description: Schema.optional(Schema.String),
        suggestion: Schema.optional(Schema.NullOr(Schema.String)),
        raisedByModels: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
});

const decodeRawSynthesisPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(RawSynthesisPayload),
);
const decodePrReviewFinding = Schema.decodeSync(PrReviewFinding);

function normalizeVerdict(raw: string | undefined, markdown: string): PrReviewVerdict {
  const lowered = (raw ?? "").trim().toLowerCase();
  if (lowered === "approve" || lowered === "request-changes" || lowered === "comment") {
    return lowered;
  }
  if (/request[-_ ]changes|建议修改|打回|阻断|\[blocker\]/iu.test(markdown)) {
    return "request-changes";
  }
  if (/\bapprove\b|建议通过|审查通过|lgtm/iu.test(markdown)) {
    return "approve";
  }
  return "comment";
}

function normalizeSeverity(raw: string | undefined): PrReviewFindingSeverity {
  const lowered = (raw ?? "").trim().toLowerCase();
  if (lowered === "blocker" || lowered === "critical" || lowered === "high") return "blocker";
  if (lowered === "major" || lowered === "medium") return "major";
  if (lowered === "minor" || lowered === "low") return "minor";
  return "nit";
}

export function parseSynthesizerOutput(
  rawText: string,
  fallbackModels: ReadonlyArray<string>,
): {
  readonly verdict: PrReviewVerdict;
  readonly summaryMarkdown: string;
  readonly findings: ReadonlyArray<PrReviewFinding>;
} {
  const fenceRegex = /```json:t3-pr-fusion\s*([\s\S]*?)```/iu;
  const match = fenceRegex.exec(rawText);
  const cleanedMarkdown = (match ? rawText.replace(fenceRegex, "") : rawText).trim();

  if (match?.[1]) {
    const decoded = decodeRawSynthesisPayload(match[1].trim());
    if (Option.isSome(decoded)) {
      const payload = decoded.value;
      const verdict = normalizeVerdict(payload.verdict, cleanedMarkdown);
      const findings: PrReviewFinding[] = (payload.findings ?? []).flatMap((item, index) => {
        const title = item.title?.trim() ?? "";
        const description = item.description?.trim() ?? "";
        if (!title && !description) return [];
        const lineNum =
          typeof item.line === "number" && Number.isInteger(item.line) && item.line > 0
            ? item.line
            : null;
        return [
          decodePrReviewFinding({
            id: `finding-${index + 1}`,
            severity: normalizeSeverity(item.severity),
            title: title || description.slice(0, 60),
            filePath: item.filePath?.trim() ? item.filePath.trim() : null,
            line: lineNum,
            description: description || title,
            suggestion: item.suggestion?.trim() ? item.suggestion.trim() : null,
            raisedByModels:
              item.raisedByModels && item.raisedByModels.length > 0
                ? item.raisedByModels
                : [...fallbackModels],
          }),
        ];
      });
      return {
        verdict,
        summaryMarkdown: cleanedMarkdown || rawText.trim(),
        findings,
      };
    }
  }

  return {
    verdict: normalizeVerdict(undefined, cleanedMarkdown),
    summaryMarkdown: cleanedMarkdown || rawText.trim(),
    findings: [],
  };
}

export function formatFusionWriteBackMarkdown(input: {
  readonly verdict: PrReviewVerdict | null;
  readonly reviewerModels: ReadonlyArray<string>;
  readonly synthesizerModel: string | null;
  readonly boundSkills: ReadonlyArray<string>;
  readonly summaryMarkdown: string;
}): string {
  const verdictBadge =
    input.verdict === "approve"
      ? "✅ **建议通过 (Approve)**"
      : input.verdict === "request-changes"
        ? "⚠️ **建议修改 (Request Changes)**"
        : "💬 **审查意见 (Comment)**";

  const metaLines = [
    `## 🤖 T3 多模型融合代码审查报告`,
    `- **综合裁决**: ${verdictBadge}`,
    `- **参与审查模型**: ${input.reviewerModels.map((m) => `\`${m}\``).join(" · ") || "单模型直审"}`,
    ...(input.synthesizerModel ? [`- **融合裁决主模型**: \`${input.synthesizerModel}\``] : []),
    ...(input.boundSkills.length > 0
      ? [`- **启用专业 Skills**: ${input.boundSkills.map((s) => `\`${s}\``).join(", ")}`]
      : []),
    "",
    input.summaryMarkdown.trim(),
    "",
    `\`${FUSION_BOT_SIGNATURE}\``,
  ];
  return metaLines.join("\n");
}
