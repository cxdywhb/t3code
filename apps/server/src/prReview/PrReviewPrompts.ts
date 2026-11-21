import {
  PrReviewFinding,
  PrReviewFindingSeverity,
  PrReviewVerdict,
  type PrReviewModelRun,
  type PrReviewRole,
  type PrReviewSkillDescriptor,
  type PullRequestActivity,
  type PullRequestDetail,
} from "@t3tools/contracts";
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

const INLINE_DIFF_MAX_CHARS = 55_000;
export const FUSION_BOT_SIGNATURE = "[T3-Multi-Model-Fusion-Review]";

type PrReviewPromptDetail = Pick<
  PullRequestDetail,
  | "provider"
  | "repository"
  | "number"
  | "title"
  | "body"
  | "url"
  | "author"
  | "headBranch"
  | "baseBranch"
  | "headSha"
  | "additions"
  | "deletions"
  | "changedFiles"
>;

export function buildReviewerPrompt(input: {
  readonly detail: PrReviewPromptDetail;
  readonly activity: PullRequestActivity | null;
  readonly patch: string;
  readonly diffFilePath: string;
  readonly role: PrReviewRole;
  readonly isLocalCheckout: boolean;
  readonly workspaceRoot: string;
  readonly skills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly customInstructions: string | null;
  readonly interactiveDirectMode: boolean;
}): string {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;
  const inlinePatch =
    input.patch.length <= INLINE_DIFF_MAX_CHARS
      ? input.patch
      : `${input.patch.slice(0, INLINE_DIFF_MAX_CHARS)}\n\n... [Diff 超长已截断，完整 Patch 已保存至本地文件: ${input.diffFilePath}，请使用读文件工具查阅剩余变更]`;

  const commitLines =
    !input.activity || input.activity.commits.length === 0
      ? "（无提交记录摘要）"
      : input.activity.commits
          .slice(0, 20)
          .map((c) => `- \`${c.oid.slice(0, 8)}\` ${c.messageHeadline}`)
          .join("\n");

  const recentComments =
    !input.activity || input.activity.comments.length === 0
      ? "（暂无历史评审评论）"
      : input.activity.comments
          .slice(-6)
          .map(
            (c) =>
              `- **@${c.author?.login ?? "unknown"}** (${c.createdAt}): ${c.body.slice(0, 300).replace(/\n+/g, " ")}`,
          )
          .join("\n");

  const skillSection =
    input.skills.length === 0
      ? []
      : [
          "",
          "## 绑定的专业审查 Skills（请先读取并严格遵循以下 Skill 规范）",
          ...input.skills.map(
            (s) =>
              `- **${s.displayName || s.name}** (\`${s.name}\`): 请读取 \`${s.path}\`${s.description ? `: ${s.description}` : ""}`,
          ),
        ];

  return [
    `# 代码变更深度审查任务：${displayRef} - ${input.detail.title}`,
    "",
    "## 1. PR / Merge Request 元数据",
    `- **仓库与编号**: \`${displayRef}\``,
    `- **链接**: ${input.detail.url}`,
    `- **作者**: @${input.detail.author?.login ?? "unknown"}`,
    `- **分支流向**: \`${input.detail.headBranch}\` → \`${input.detail.baseBranch}\`${input.detail.headSha ? ` (Head SHA: \`${input.detail.headSha.slice(0, 12)}\`)` : ""}`,
    `- **变更规模**: +${input.detail.additions} / -${input.detail.deletions}（共 ${input.detail.changedFiles} 个文件）`,
    `- **完整 Diff 补丁文件**: \`${input.diffFilePath}\``,
    input.isLocalCheckout
      ? `- **本地仓库源码目录**: \`${input.workspaceRoot}\`（你可以只读检索仓库上下文、类型定义与上下游调用链以验证判断）`
      : `- **运行模式**: 云端远端仓库直接审查（本地未克隆完整仓库，请基于完整 Diff 补丁文件与描述进行深入审查）`,
    "",
    "## 2. 审查角色与侧重点",
    `- **当前审查视角**: **${ROLE_LABELS_ZH[input.role]}**`,
    `- **职责要求**: ${ROLE_INSTRUCTIONS[input.role]}`,
    "- **安全约束**: **严禁修改、新建或删除项目源码文件**，仅做只读代码分析与验证。",
    ...skillSection,
    ...(input.customInstructions?.trim()
      ? ["", "## 3. 团队附加审查规范", input.customInstructions.trim()]
      : []),
    "",
    "## 4. 变更说明 (Description)",
    input.detail.body.trim() || "（作者未填写描述）",
    "",
    "## 5. 提交记录与近期讨论",
    "### Commits",
    commitLines,
    "### 近期评论",
    recentComments,
    "",
    "## 6. Unified Diff 变更内容",
    "```diff",
    inlinePatch || "（空 Diff）",
    "```",
    "",
    "## 7. 输出格式要求",
    "请使用中文输出严谨、言之有物的代码审查报告（拒绝空泛套话，每个问题必须指出准确文件路径、行号与触发机理）：",
    "1. `## 审查结论`：明确给出建议（`Approve / 建议通过`、`Request Changes / 建议修改后合并` 或 `Comment / 仅留评建议`）及一句话总结；",
    "2. `## 发现的问题清单`：按严重度（`[BLOCKER]`、`[MAJOR]`、`[MINOR]`、`[NIT]`）逐条列出：",
    "   - 准确位置：`文件路径:行号`（对应新文件行号）",
    "   - 问题描述与触发条件",
    "   - 具体修复建议或代码片段；",
    "3. `## 风险点与验证建议`：简述潜在回归面或需要补充的测试。",
    ...(input.interactiveDirectMode
      ? ["", "完成后开发者可能会在当前会话继续与你讨论该 PR/MR 的细节或让你协助回写评审意见。"]
      : []),
  ].join("\n");
}

export function buildSynthesizerPrompt(input: {
  readonly detail: PrReviewPromptDetail;
  readonly diffFilePath: string;
  readonly isLocalCheckout: boolean;
  readonly workspaceRoot: string;
  readonly reviewerRuns: ReadonlyArray<PrReviewModelRun>;
  readonly skills: ReadonlyArray<PrReviewSkillDescriptor>;
  readonly customInstructions: string | null;
}): string {
  const sigil = input.detail.provider === "gitlab" ? "!" : "#";
  const displayRef = `${input.detail.repository}${sigil}${input.detail.number}`;
  const reportsBlock = input.reviewerRuns
    .map((run, idx) =>
      [
        `### 模型 #${idx + 1}：\`${run.modelLabel}\`（视角：${ROLE_LABELS_ZH[run.role]}）`,
        run.status === "completed" && run.reportMarkdown
          ? run.reportMarkdown.trim()
          : `（该模型执行未产出报告：${run.error ?? run.status}）`,
      ].join("\n\n"),
    )
    .join("\n\n---\n\n");

  const skillSection =
    input.skills.length === 0
      ? []
      : [
          "",
          "## 绑定的专业审查 Skills",
          ...input.skills.map((s) => `- **${s.displayName || s.name}**: \`${s.path}\``),
        ];

  return [
    `# 多模型代码审查融合裁决任务：${displayRef} - ${input.detail.title}`,
    "",
    "你现在担任 **首席架构师 / 多模型融合裁决官（Synthesizer & Judge）**。",
    "多位异构大模型已经并行完成了对该 PR / Merge Request 的独立审查。请你综合各方报告，结合真实 Diff 与代码上下文完成去重、交叉核实、剔除误报，并输出最终权威的【多模型融合审查报告】。",
    "",
    "## 1. PR 基本信息与参考上下文",
    `- **仓库与编号**: \`${displayRef}\` (${input.detail.url})`,
    `- **分支**: \`${input.detail.headBranch}\` → \`${input.detail.baseBranch}\` (+${input.detail.additions} / -${input.detail.deletions})`,
    `- **完整 Diff 补丁文件**: \`${input.diffFilePath}\`（如各模型存在分歧或行号存疑，请直接读取此补丁文件${input.isLocalCheckout ? `或本地源码 \`${input.workspaceRoot}\` ` : ""}核实）`,
    "- **严禁修改任何项目源码文件**。",
    ...skillSection,
    ...(input.customInstructions?.trim()
      ? ["", "## 2. 团队附加审查规范", input.customInstructions.trim()]
      : []),
    "",
    "## 3. 各并行模型独立审查报告",
    reportsBlock,
    "",
    "## 4. 融合裁决输出要求（必须同时包含可读 Markdown 报告与末尾 JSON 结构块）",
    "请先输出一份结构清晰、可直接发布到 GitLab/GitHub 评论区的中文 Markdown 报告，包含：",
    "1. `## 总体裁决结论`：给出总体判定与核心理由；",
    "2. `## 多模型共识对比`：简述哪些关键问题是多模型共同命中的高置信问题，哪些经核实属于误报已剔除；",
    "3. `## 核心问题汇总`：按严重级别清晰列出真实有效的问题、位置（`file:line`）与修改建议；",
    "4. `## 合并前检查建议`。",
    "",
    "紧接着在回复的最末尾，**必须附带一个标准 JSON 代码块**（标记为 ```json:t3-pr-fusion ），供工作站解析结构化结论与行级回写评论：",
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
  ].join("\n");
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
