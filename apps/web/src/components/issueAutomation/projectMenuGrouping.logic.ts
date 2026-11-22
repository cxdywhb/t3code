export interface GroupableProjectItem {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface ProjectFolderGroup<T extends GroupableProjectItem = GroupableProjectItem> {
  readonly key: string;
  readonly parentDir: string;
  readonly label: string;
  readonly isUngrouped: boolean;
  readonly projects: ReadonlyArray<T>;
}

const UNGROUPED_KEY = "__ungrouped__";

function normalizeSlashes(input: string): string {
  const normalized = input.trim().replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

export function extractParentDirectory(workspaceRoot: string): string {
  const normalized = normalizeSlashes(workspaceRoot);
  if (!normalized || normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return "";
  }
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return "";
  }
  if (lastSlash === 0) {
    return "/";
  }
  const parent = normalized.slice(0, lastSlash);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}/`;
  }
  return parent;
}

export function formatCompactParentPath(parentDir: string): string {
  const normalized = normalizeSlashes(parentDir);
  if (!normalized) return "";
  return normalized
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/, "~");
}

function splitPathSegments(parentDir: string): string[] {
  const normalized = normalizeSlashes(parentDir);
  if (!normalized) return [];
  if (normalized === "/") return ["/"];
  if (/^[A-Za-z]:\/$/.test(normalized)) {
    return [normalized.slice(0, 2)];
  }
  return normalized.split("/").filter(Boolean);
}

function resolveUniqueFolderLabels(parentDirs: ReadonlyArray<string>): Map<string, string> {
  const uniqueParents = parentDirs.filter((dir) => dir.length > 0);
  const depths = new Map<string, number>();
  for (const dir of uniqueParents) {
    depths.set(dir, 1);
  }

  const labelFor = (dir: string, depth: number): string => {
    const segments = splitPathSegments(dir);
    if (segments.length === 0) return dir;
    return segments.slice(-Math.min(segments.length, depth)).join(" / ");
  };

  while (true) {
    const byLabel = new Map<string, string[]>();
    for (const dir of uniqueParents) {
      const lbl = labelFor(dir, depths.get(dir) ?? 1);
      const bucket = byLabel.get(lbl);
      if (bucket) {
        bucket.push(dir);
      } else {
        byLabel.set(lbl, [dir]);
      }
    }

    let advanced = false;
    for (const dirs of byLabel.values()) {
      if (dirs.length <= 1) continue;
      for (const dir of dirs) {
        const currentDepth = depths.get(dir) ?? 1;
        const maxDepth = splitPathSegments(dir).length;
        if (currentDepth < maxDepth) {
          depths.set(dir, currentDepth + 1);
          advanced = true;
        }
      }
    }
    if (!advanced) break;
  }

  const resolved = new Map<string, string>();
  for (const dir of uniqueParents) {
    resolved.set(dir, labelFor(dir, depths.get(dir) ?? 1));
  }
  return resolved;
}

export function groupProjectsByParentFolder<T extends GroupableProjectItem>(
  projects: ReadonlyArray<T>,
  options?: {
    readonly search?: string;
    readonly ungroupedLabel?: string;
  },
): ReadonlyArray<ProjectFolderGroup<T>> {
  const buckets = new Map<string, T[]>();
  const orderedKeys: string[] = [];
  const ungrouped: T[] = [];

  for (const project of projects) {
    const parentDir = extractParentDirectory(project.workspaceRoot);
    if (!parentDir) {
      ungrouped.push(project);
      continue;
    }
    const existing = buckets.get(parentDir);
    if (existing) {
      existing.push(project);
    } else {
      buckets.set(parentDir, [project]);
      orderedKeys.push(parentDir);
    }
  }

  const labels = resolveUniqueFolderLabels(orderedKeys);
  const allGroups: ProjectFolderGroup<T>[] = orderedKeys.map((parentDir) => ({
    key: parentDir,
    parentDir,
    label: labels.get(parentDir) ?? parentDir,
    isUngrouped: false,
    projects: buckets.get(parentDir) ?? [],
  }));

  if (ungrouped.length > 0) {
    allGroups.push({
      key: UNGROUPED_KEY,
      parentDir: "",
      label: options?.ungroupedLabel ?? "",
      isUngrouped: true,
      projects: ungrouped,
    });
  }

  const query = options?.search?.trim().toLowerCase() ?? "";
  if (!query) {
    return allGroups;
  }

  const filtered: ProjectFolderGroup<T>[] = [];
  for (const group of allGroups) {
    const groupMatches =
      group.label.toLowerCase().includes(query) || group.parentDir.toLowerCase().includes(query);
    if (groupMatches) {
      filtered.push(group);
      continue;
    }
    const matchingProjects = group.projects.filter(
      (project) =>
        project.title.toLowerCase().includes(query) ||
        project.workspaceRoot.toLowerCase().includes(query),
    );
    if (matchingProjects.length > 0) {
      filtered.push({
        ...group,
        projects: matchingProjects,
      });
    }
  }
  return filtered;
}
