export const ISSUE_AUTOMATION_COMMENT_MARKER = "[T3-Auto-Analysis]";

export function formatIssueAutomationWriteBackComment(input: {
  readonly assignedModelLabel: string;
  readonly worktreeBranch: string | null;
  readonly diagnosisReport: string;
  readonly reviewReport: string | null;
  readonly repairOfTaskId?: string;
}): string {
  const sections = [
    input.repairOfTaskId ? "## 修复报告" : "## 🤖 自动诊断分析报告",
    `- **执行模型**: \`${input.assignedModelLabel}\``,
    ...(input.worktreeBranch ? [`- **本地修复分支**: \`${input.worktreeBranch}\``] : []),
    "",
    input.diagnosisReport.trim(),
  ];
  if (input.reviewReport && input.reviewReport.trim().length > 0) {
    sections.push("", "## 🔍 异构模型交叉审查意见", input.reviewReport.trim());
  }
  sections.push("", `\`${ISSUE_AUTOMATION_COMMENT_MARKER}\``);
  return sections.join("\n");
}
