import type { IssueAutomationMessageSummary, OrchestrationV2TurnItem } from "@t3tools/contracts";

const LEGACY_OPENING = "# 企业问题自动诊断与解决任务：";
const LEGACY_EXECUTION_HEADING = "\n\n## 5. 执行要求\n";
const LEGACY_REPORT_HEADING = "\n\n## 6. 最终输出报告格式";

type UserTurnItem = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;

export function readLegacyIssueAutomationSummary(item: {
  readonly text: string;
  readonly createdBy?: UserTurnItem["createdBy"];
  readonly creationSource?: UserTurnItem["creationSource"];
  readonly inputIntent?: UserTurnItem["inputIntent"] | undefined;
}): IssueAutomationMessageSummary | undefined {
  if (
    item.createdBy !== "user" ||
    item.creationSource !== "web" ||
    item.inputIntent !== "turn_start" ||
    !item.text.startsWith(LEGACY_OPENING)
  )
    return undefined;

  const [title = "", , metadata, scope = "", module = "", link = ""] = item.text.split("\n", 6);
  if (metadata !== "## 1. 外部平台问题元数据") return undefined;
  const issueKey = /^(#\d+) - /.exec(title.slice(LEGACY_OPENING.length))?.[1];
  const scopeName = /^- \*\*所属产品\/项目\*\*: (.+) \(#[^)]+\)$/.exec(scope)?.[1];
  const moduleName = /^- \*\*所属模块\*\*: (.+)$/.exec(module)?.[1];
  const issueUrl = /^- \*\*问题链接\*\*: (https?:\/\/\S+)$/.exec(link)?.[1];
  if (!issueKey || !scopeName || !moduleName || !issueUrl) return undefined;
  try {
    if (!new URL(issueUrl).pathname.endsWith(`/bug-view-${issueKey.slice(1)}.html`))
      return undefined;
  } catch {
    return undefined;
  }

  const reportOffset = item.text.lastIndexOf(LEGACY_REPORT_HEADING);
  if (reportOffset < 0) return undefined;
  const executionOffset = item.text.lastIndexOf(LEGACY_EXECUTION_HEADING, reportOffset);
  if (executionOffset < 0) return undefined;
  const executionMode = item.text
    .slice(executionOffset + LEGACY_EXECUTION_HEADING.length)
    .split("\n", 1)[0];
  const mode =
    executionMode === "当前运行模式为【只读自动诊断模式】："
      ? "diagnose"
      : /^当前运行模式为【自动诊断与代码修复模式 \((?:fix_worktree_review|auto_resolve)\)】：$/.test(
            executionMode ?? "",
          )
        ? "repair"
        : undefined;
  if (mode === undefined) return undefined;

  return {
    mode,
    scopeName,
    moduleName: moduleName === "未分类" ? null : moduleName,
    platform: "zentao",
    issueKey,
    issueUrl,
  };
}
