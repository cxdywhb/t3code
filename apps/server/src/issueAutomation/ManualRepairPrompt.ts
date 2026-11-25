import type { OrchestrationProjectShell } from "@t3tools/contracts";

import type { PlatformIssueDetail } from "./plugin/IssuePlatformPlugin.ts";

export function buildManualRepairPrompt(input: {
  readonly detail: Pick<PlatformIssueDetail, "displayKey" | "title" | "stepsMarkdown">;
  readonly diagnosisReport: string;
  readonly referenceProjects: ReadonlyArray<OrchestrationProjectShell>;
  readonly customInstructions: string | null;
}): string {
  return [
    `# 根据已有诊断修复 ${input.detail.displayKey} - ${input.detail.title}`,
    "",
    "在当前独立 Git Worktree 内，沿用下方诊断报告的根因、代码位置和修复建议，实施最小修复并运行相关验证。跳过重新诊断。",
    "只核对修复涉及的代码。如果当前代码与报告有差异，只补查受影响的部分。如果报告不足以支撑修复，说明阻塞点。",
    "保持改动可审查。不要推送、合并、更新禅道或发送外部通知。",
    "",
    "## 已有诊断报告",
    input.diagnosisReport,
    ...(input.detail.stepsMarkdown.trim()
      ? ["", "## 原始复现条件（用于验证）", input.detail.stepsMarkdown]
      : []),
    ...(input.referenceProjects.length
      ? [
          "",
          "## 关联代码库（只读）",
          ...input.referenceProjects.map(
            (project) => `- ${project.title}：${project.workspaceRoot}`,
          ),
        ]
      : []),
    ...(input.customInstructions?.trim()
      ? ["", "## 团队规范（适用于本次修复和验证）", input.customInstructions.trim()]
      : []),
    "",
    "## 修复报告",
    "简述沿用的诊断结论，列出实际改动和验证结果。如有未完成项，说明原因。",
  ].join("\n");
}
