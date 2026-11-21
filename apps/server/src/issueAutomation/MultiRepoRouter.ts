import type {
  IssueAutomationRepoBinding,
  OrchestrationProjectShell,
  ProjectId,
} from "@t3tools/contracts";

export interface MultiRepoRouteResult {
  readonly targetProjectId: ProjectId;
  readonly referenceProjectIds: ReadonlyArray<ProjectId>;
  readonly matchedReason: string;
}

/**
 * Resolves which local codebase owns the primary diagnosis/fix worktree and which sibling
 * local codebases are mounted as cross-repository reference context.
 */
export function resolveTargetRepositories(input: {
  readonly binding: IssueAutomationRepoBinding;
  readonly availableProjects: ReadonlyArray<OrchestrationProjectShell>;
  readonly moduleName: string | null;
  readonly issueTitle: string;
  readonly stepsMarkdown: string;
}): MultiRepoRouteResult {
  const availableIds = new Set(input.availableProjects.map((project) => project.id));
  const allCandidateIds = [
    input.binding.primaryProjectId,
    ...input.binding.linkedProjectIds.filter((id) => id !== input.binding.primaryProjectId),
  ].filter((id) => availableIds.has(id));

  const fallbackPrimary = allCandidateIds[0] ?? input.binding.primaryProjectId;
  const searchCorpus = `${input.moduleName ?? ""}\n${input.issueTitle}`.toLowerCase();

  // 1. Explicit module / keyword mapping rules configured by user
  for (const rule of input.binding.moduleMappings) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (pattern.length > 0 && searchCorpus.includes(pattern) && availableIds.has(rule.projectId)) {
      return {
        targetProjectId: rule.projectId,
        referenceProjectIds: allCandidateIds.filter((id) => id !== rule.projectId),
        matchedReason: `命中模块/关键字映射规则 "${rule.pattern}"`,
      };
    }
  }

  // 2. Repository name / basename heuristic match against bug title, module, and stacktrace
  if (allCandidateIds.length > 1) {
    const fullCorpus = `${searchCorpus}\n${input.stepsMarkdown.slice(0, 4000)}`.toLowerCase();
    for (const candidateId of allCandidateIds) {
      const shell = input.availableProjects.find((project) => project.id === candidateId);
      if (!shell) continue;
      const folderName =
        shell.workspaceRoot.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";
      const projectTitle = shell.title.trim().toLowerCase();
      if (
        (folderName.length >= 3 && fullCorpus.includes(folderName)) ||
        (projectTitle.length >= 2 && fullCorpus.includes(projectTitle))
      ) {
        return {
          targetProjectId: candidateId,
          referenceProjectIds: allCandidateIds.filter((id) => id !== candidateId),
          matchedReason: `根据问题内容自动匹配仓库 "${shell.title}"`,
        };
      }
    }
  }

  // 3. Default primary repository with all other linked repositories as reference context
  return {
    targetProjectId: fallbackPrimary,
    referenceProjectIds: allCandidateIds.filter((id) => id !== fallbackPrimary),
    matchedReason:
      allCandidateIds.length > 1
        ? `使用默认主仓库（同时挂载其余 ${String(allCandidateIds.length - 1)} 个关联仓库作为上下文）`
        : "使用已绑定的本地代码库",
  };
}
