import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  ProjectCloneSnapshot,
  ProjectId,
  SourceControlCloneProtocol,
  SourceControlNamespace,
  SourceControlProviderDiscoveryItem,
  SourceControlRepositorySummary,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import {
  getCloneDestinationPath,
  getCloneDirectoryName,
} from "@t3tools/client-runtime/operations/projects";

export type ClonePathLayout = "group" | "flat" | "ghq";
export type RepositoryLocalStatusFilter = "all" | "not_cloned" | "imported";

export interface NamespaceTreeNode {
  readonly namespace: SourceControlNamespace;
  readonly children: ReadonlyArray<NamespaceTreeNode>;
  /** True when the user belongs to this subgroup without belonging to its parent group. */
  readonly isOrphanSubgroup: boolean;
}

export interface BuiltNamespaceTree {
  readonly personal: SourceControlNamespace | null;
  readonly groups: ReadonlyArray<NamespaceTreeNode>;
  readonly byId: ReadonlyMap<string, SourceControlNamespace>;
}

export interface RepositoryLocalMatch {
  readonly project: EnvironmentProject | null;
  readonly clone: ProjectCloneSnapshot | null;
}

export interface ClonePlanEntry {
  readonly repo: SourceControlRepositorySummary;
  readonly destinationPath: string;
  readonly isCustomPath: boolean;
}

export function normalizeHostForLookup(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (parsed.host) return parsed.host.toLowerCase();
    } catch {
      // Fall back to trimming slashes.
    }
  }
  return trimmed.replace(/\/+$/u, "").toLowerCase();
}

export function extractConfiguredGitLabHosts(input: {
  readonly discovery: SourceControlProviderDiscoveryItem | null | undefined;
  readonly savedTokenHosts: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const hosts = new Set<string>();
  for (const raw of input.savedTokenHosts) {
    const normalized = normalizeHostForLookup(raw);
    if (normalized) hosts.add(normalized);
  }
  for (const account of input.discovery?.auth.accounts ?? []) {
    if (!account.authenticated) continue;
    const normalized = normalizeHostForLookup(account.host);
    if (normalized) hosts.add(normalized);
  }
  if (
    input.discovery?.auth.status === "authenticated" &&
    input.discovery.auth.host._tag === "Some"
  ) {
    const normalized = normalizeHostForLookup(input.discovery.auth.host.value);
    if (normalized) hosts.add(normalized);
  }
  return Array.from(hosts);
}

/**
 * Organizes flat GitLab namespaces into a personal entry plus a sorted multi-level group tree.
 * Subgroups whose parent is not in the user's membership list are promoted to the top level so
 * they remain accessible.
 */
export function buildNamespaceTree(
  namespaces: ReadonlyArray<SourceControlNamespace>,
): BuiltNamespaceTree {
  const byId = new Map<string, SourceControlNamespace>();
  let personal: SourceControlNamespace | null = null;
  const groups: SourceControlNamespace[] = [];

  for (const ns of namespaces) {
    byId.set(ns.id, ns);
    if (ns.kind === "user") {
      personal ??= ns;
    } else {
      groups.push(ns);
    }
  }

  const childrenByParent = new Map<string, SourceControlNamespace[]>();
  const roots: Array<{ readonly ns: SourceControlNamespace; readonly orphan: boolean }> = [];

  for (const group of groups) {
    if (group.parentId && byId.has(group.parentId)) {
      const list = childrenByParent.get(group.parentId);
      if (list) list.push(group);
      else childrenByParent.set(group.parentId, [group]);
    } else {
      roots.push({ ns: group, orphan: group.parentId !== null });
    }
  }

  const compareName = (a: SourceControlNamespace, b: SourceControlNamespace) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  const buildNode = (
    ns: SourceControlNamespace,
    isOrphanSubgroup: boolean,
    visited: Set<string>,
  ): NamespaceTreeNode => {
    const rawChildren = (childrenByParent.get(ns.id) ?? []).slice().sort(compareName);
    const children: NamespaceTreeNode[] = [];
    for (const child of rawChildren) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      children.push(buildNode(child, false, visited));
    }
    return { namespace: ns, children, isOrphanSubgroup };
  };

  roots.sort((a, b) => compareName(a.ns, b.ns));
  const rootNodes: NamespaceTreeNode[] = [];
  for (const root of roots) {
    const visited = new Set<string>([root.ns.id]);
    rootNodes.push(buildNode(root.ns, root.orphan, visited));
  }

  return { personal, groups: rootNodes, byId };
}

/** Filters a namespace tree by name or full path, keeping ancestors of matching subgroups. */
export function filterNamespaceTree(
  nodes: ReadonlyArray<NamespaceTreeNode>,
  rawQuery: string,
): ReadonlyArray<NamespaceTreeNode> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return nodes;

  const visit = (node: NamespaceTreeNode): NamespaceTreeNode | null => {
    const selfMatches =
      node.namespace.name.toLowerCase().includes(query) ||
      node.namespace.path.toLowerCase().includes(query);
    if (selfMatches) return node;
    const matchedChildren = node.children
      .map(visit)
      .filter((child): child is NamespaceTreeNode => child !== null);
    if (matchedChildren.length === 0) return null;
    return { ...node, children: matchedChildren };
  };

  return nodes.map(visit).filter((node): node is NamespaceTreeNode => node !== null);
}

function canonicalRepoKey(host: string, pathWithNamespace: string): string {
  const normalizedHost = normalizeHostForLookup(host);
  const normalizedPath = pathWithNamespace
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return `${normalizedHost}/${normalizedPath}`;
}

function normalizedProjectRepoKeys(project: EnvironmentProject): ReadonlyArray<string> {
  const keys = new Set<string>();
  const identity = project.repositoryIdentity;
  if (!identity) return [];
  if (identity.canonicalKey) {
    keys.add(
      identity.canonicalKey
        .trim()
        .replace(/\.git$/i, "")
        .toLowerCase(),
    );
  }
  const urls = [identity.locator.remoteUrl, identity.origin?.remoteUrl, identity.webUrl];
  for (const url of urls) {
    if (!url) continue;
    const normalized = normalizeGitRemoteUrl(url);
    if (normalized) keys.add(normalized.replace(/\.git$/i, "").toLowerCase());
  }
  return Array.from(keys);
}

function normalizedCloneRepoKeys(clone: ProjectCloneSnapshot): ReadonlyArray<string> {
  const keys = new Set<string>();
  const normalizedRemote = normalizeGitRemoteUrl(clone.remoteUrl);
  if (normalizedRemote) keys.add(normalizedRemote.replace(/\.git$/i, "").toLowerCase());
  if (clone.repository) {
    for (const url of [clone.repository.url, clone.repository.sshUrl]) {
      const normalized = normalizeGitRemoteUrl(url);
      if (normalized) keys.add(normalized.replace(/\.git$/i, "").toLowerCase());
    }
  }
  return Array.from(keys);
}

export function indexLocalRepositories(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly clones: ReadonlyArray<ProjectCloneSnapshot>;
}): {
  readonly match: (
    repo: SourceControlRepositorySummary,
    host: string,
    expectedDestinationPath?: string,
  ) => RepositoryLocalMatch;
} {
  const projectByKey = new Map<string, EnvironmentProject>();
  const projectById = new Map<string, EnvironmentProject>();
  const projectByPath = new Map<string, EnvironmentProject>();
  for (const project of input.projects) {
    projectById.set(project.id, project);
    const normalizedRoot = normalizeProjectPathForComparison(project.workspaceRoot);
    if (normalizedRoot && !projectByPath.has(normalizedRoot)) {
      projectByPath.set(normalizedRoot, project);
    }
    for (const key of normalizedProjectRepoKeys(project)) {
      if (!projectByKey.has(key)) projectByKey.set(key, project);
    }
  }

  const cloneByKey = new Map<string, ProjectCloneSnapshot>();
  for (const clone of input.clones) {
    for (const key of normalizedCloneRepoKeys(clone)) {
      const existing = cloneByKey.get(key);
      if (!existing || clone.sequence > existing.sequence) {
        cloneByKey.set(key, clone);
      }
    }
  }

  return {
    match(repo, host, expectedDestinationPath) {
      const candidateKeys = new Set<string>([
        canonicalRepoKey(host, repo.pathWithNamespace),
        normalizeGitRemoteUrl(repo.httpUrl)
          .replace(/\.git$/i, "")
          .toLowerCase(),
        normalizeGitRemoteUrl(repo.sshUrl)
          .replace(/\.git$/i, "")
          .toLowerCase(),
      ]);

      let clone: ProjectCloneSnapshot | null = null;
      for (const key of candidateKeys) {
        if (!key) continue;
        const found = cloneByKey.get(key);
        if (found) {
          clone = found;
          break;
        }
      }

      let project: EnvironmentProject | null = null;
      for (const key of candidateKeys) {
        if (!key) continue;
        const found = projectByKey.get(key);
        if (found) {
          project = found;
          break;
        }
      }
      if (project === null && expectedDestinationPath) {
        const normalizedExpected = normalizeProjectPathForComparison(expectedDestinationPath);
        if (normalizedExpected) {
          project = projectByPath.get(normalizedExpected) ?? null;
        }
      }
      if (project === null && clone !== null) {
        project = projectById.get(clone.projectId) ?? null;
      }

      return { project, clone };
    },
  };
}

function sanitizeRelativeSegments(rawPath: string): string {
  return rawPath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}

/**
 * Computes the default local clone destination path for a repository:
 * - `group` (default): `<root>/<group>/<subgroup>/<repo>` — mirrors GitLab's group hierarchy
 * - `flat`: `<root>/<repo>` — places the repo directly under the chosen folder (e.g. inside a subproject)
 * - `ghq`: `<root>/<host>/<group>/<subgroup>/<repo>`
 */
export function computeRepoDestinationPath(input: {
  readonly rootDirectory: string;
  readonly repo: Pick<SourceControlRepositorySummary, "pathWithNamespace" | "httpUrl" | "name">;
  readonly host: string;
  readonly layout: ClonePathLayout;
}): string {
  const root = input.rootDirectory.trim() || "~/projects";
  const repoLeaf = getCloneDirectoryName(input.repo.pathWithNamespace) || input.repo.name.trim();
  const groupPath = sanitizeRelativeSegments(input.repo.pathWithNamespace);
  const normalizedHost = normalizeHostForLookup(input.host);

  let relativePath: string;
  switch (input.layout) {
    case "flat":
      relativePath = repoLeaf;
      break;
    case "ghq":
      relativePath =
        normalizedHost && groupPath ? `${normalizedHost}/${groupPath}` : groupPath || repoLeaf;
      break;
    case "group":
    default:
      relativePath = groupPath || repoLeaf;
      break;
  }

  return getCloneDestinationPath(root, relativePath);
}

export function resolveEffectiveCloneRoot(input: {
  readonly customRoot: string | null | undefined;
  readonly newProjectsRoot: string | null | undefined;
}): { readonly path: string; readonly isAutoManaged: boolean } {
  const trimmedCustom = input.customRoot?.trim() ?? "";
  if (trimmedCustom.length > 0) {
    return { path: trimmedCustom, isAutoManaged: false };
  }
  const managed = input.newProjectsRoot?.trim() ?? "";
  return { path: managed || "~/projects", isAutoManaged: true };
}

export function findDuplicateDestinationPaths(
  entries: ReadonlyArray<Pick<ClonePlanEntry, "destinationPath">>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const key = entry.destinationPath
      .trim()
      .replace(/[\\/]+$/u, "")
      .toLowerCase();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    else seen.add(key);
  }
  return duplicates;
}

export function normalizeDestinationKey(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
}

/** Returns IDs of all groups in the tree that have at least one child subgroup. */
export function collectExpandableGroupIds(
  nodes: ReadonlyArray<NamespaceTreeNode>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const visit = (items: ReadonlyArray<NamespaceTreeNode>) => {
    for (const node of items) {
      if (node.children.length > 0) {
        ids.push(node.namespace.id);
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return ids;
}

export interface FolderBreadcrumb {
  readonly label: string;
  readonly path: string;
}

/** Splits an absolute or home-relative directory path into clickable browse breadcrumbs. */
export function buildFolderBreadcrumbs(directoryPath: string): ReadonlyArray<FolderBreadcrumb> {
  const trimmed = directoryPath.trim();
  if (trimmed.length === 0) return [];

  // Windows drive path, e.g. C:\Users\example\projects
  if (/^[a-zA-Z]:[\\/]?/.test(trimmed)) {
    const driveRoot = `${trimmed.slice(0, 2)}\\`;
    const rest = trimmed
      .slice(2)
      .split(/[\\/]+/)
      .filter(Boolean);
    const crumbs: FolderBreadcrumb[] = [{ label: trimmed.slice(0, 2), path: driveRoot }];
    let acc = driveRoot;
    for (const segment of rest) {
      acc = `${acc}${segment}\\`;
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  }

  // Home-relative path, e.g. ~/workspace/apps
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    const rest = trimmed.slice(1).split(/\/+/).filter(Boolean);
    const crumbs: FolderBreadcrumb[] = [{ label: "~", path: "~/" }];
    let acc = "~/";
    for (const segment of rest) {
      acc = `${acc}${segment}/`;
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  }

  // POSIX absolute path, e.g. /workspace/projects
  if (trimmed.startsWith("/")) {
    const rest = trimmed.slice(1).split(/\/+/).filter(Boolean);
    const crumbs: FolderBreadcrumb[] = [{ label: "/", path: "/" }];
    let acc = "/";
    for (const segment of rest) {
      acc = `${acc}${segment}/`;
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  }

  return [{ label: trimmed, path: trimmed }];
}

export interface TrackedCloneBatchItem {
  readonly key: string;
  readonly repo: SourceControlRepositorySummary;
  readonly projectId: ProjectId | null;
  readonly destinationPath: string;
  readonly protocol: SourceControlCloneProtocol;
  readonly startError: string | null;
}

export type ResolvedCloneBatchStatus = "running" | "done" | "failed" | "cancelled";

export interface ResolvedCloneBatchItem {
  readonly item: TrackedCloneBatchItem;
  readonly status: ResolvedCloneBatchStatus;
  readonly clone: ProjectCloneSnapshot | null;
  readonly project: EnvironmentProject | null;
  readonly percent: number | null;
  readonly error: string | null;
}

export interface CloneBatchSummary {
  readonly items: ReadonlyArray<ResolvedCloneBatchItem>;
  readonly total: number;
  readonly runningCount: number;
  readonly doneCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly settledCount: number;
  readonly overallPercent: number;
  readonly isComplete: boolean;
}

/**
 * Resolves tracked clone batch items against live server clone snapshots and registered projects.
 * Done snapshots are evicted on the server after 30s, so a registered project with no snapshot is
 * preserved as done rather than regressing to running.
 */
export function summarizeCloneBatch(input: {
  readonly items: ReadonlyArray<TrackedCloneBatchItem>;
  readonly clones: ReadonlyArray<ProjectCloneSnapshot>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}): CloneBatchSummary {
  const cloneByProjectId = new Map<ProjectId, ProjectCloneSnapshot>();
  for (const clone of input.clones) {
    cloneByProjectId.set(clone.projectId, clone);
  }
  const projectById = new Map<ProjectId, EnvironmentProject>();
  for (const project of input.projects) {
    projectById.set(project.id, project);
  }

  let runningCount = 0;
  let doneCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let progressSum = 0;

  const resolved: ResolvedCloneBatchItem[] = input.items.map((item) => {
    if (item.startError !== null || item.projectId === null) {
      failedCount += 1;
      progressSum += 100;
      return {
        item,
        status: "failed",
        clone: null,
        project: null,
        percent: null,
        error: item.startError,
      };
    }

    const clone = cloneByProjectId.get(item.projectId) ?? null;
    const project = projectById.get(item.projectId) ?? null;

    if (clone !== null) {
      if (clone.phase === "running") {
        runningCount += 1;
        progressSum += clone.percent ?? 8;
        return {
          item,
          status: "running",
          clone,
          project,
          percent: clone.percent,
          error: null,
        };
      }
      if (clone.phase === "done") {
        doneCount += 1;
        progressSum += 100;
        return {
          item,
          status: "done",
          clone,
          project,
          percent: 100,
          error: null,
        };
      }
      if (clone.phase === "cancelled") {
        cancelledCount += 1;
        progressSum += 100;
        return {
          item,
          status: "cancelled",
          clone,
          project,
          percent: null,
          error: null,
        };
      }
      failedCount += 1;
      progressSum += 100;
      return {
        item,
        status: "failed",
        clone,
        project,
        percent: null,
        error: clone.error,
      };
    }

    if (project !== null) {
      doneCount += 1;
      progressSum += 100;
      return {
        item,
        status: "done",
        clone: null,
        project,
        percent: 100,
        error: null,
      };
    }

    // Clone was just dispatched and the first snapshot has not arrived yet.
    runningCount += 1;
    progressSum += 5;
    return {
      item,
      status: "running",
      clone: null,
      project: null,
      percent: null,
      error: null,
    };
  });

  const total = resolved.length;
  const settledCount = doneCount + failedCount + cancelledCount;
  const overallPercent =
    total === 0 ? 0 : Math.min(100, Math.max(0, Math.round(progressSum / total)));

  return {
    items: resolved,
    total,
    runningCount,
    doneCount,
    failedCount,
    cancelledCount,
    settledCount,
    overallPercent,
    isComplete: runningCount === 0,
  };
}
