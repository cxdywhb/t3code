import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type ProjectCloneSnapshot,
  type SourceControlNamespace,
  type SourceControlRepositorySummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFolderBreadcrumbs,
  buildNamespaceTree,
  collectExpandableGroupIds,
  computeRepoDestinationPath,
  filterNamespaceTree,
  findDuplicateDestinationPaths,
  indexLocalRepositories,
  normalizeHostForLookup,
  resolveEffectiveCloneRoot,
  summarizeCloneBatch,
} from "./repositoriesPage.logic";

const SAMPLE_REPO: SourceControlRepositorySummary = {
  id: "101",
  name: "example-app",
  pathWithNamespace: "acme/platform/example-app",
  namespacePath: "acme/platform",
  description: "Example repository",
  defaultBranch: "main",
  visibility: "private",
  sshUrl: "git@gitlab.example.test:acme/platform/example-app.git",
  httpUrl: "https://gitlab.example.test/acme/platform/example-app.git",
  webUrl: "https://gitlab.example.test/acme/platform/example-app",
  archived: false,
  lastActivityAt: "2026-11-20T12:00:00Z",
};

describe("repositoriesPage.logic", () => {
  it("normalizes pasted GitLab URLs and bare hosts", () => {
    expect(normalizeHostForLookup("https://gitlab.example.test/")).toBe("gitlab.example.test");
    expect(normalizeHostForLookup("https://GITLAB.EXAMPLE.TEST:8443/acme")).toBe(
      "gitlab.example.test:8443",
    );
    expect(normalizeHostForLookup("gitlab.example.test")).toBe("gitlab.example.test");
  });

  it("builds a multi-level group tree and promotes orphan subgroups without dropping them", () => {
    const namespaces: SourceControlNamespace[] = [
      {
        id: "personal",
        kind: "user",
        name: "Example User",
        path: "example-user",
        parentId: null,
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "1",
        kind: "group",
        name: "acme",
        path: "acme",
        parentId: null,
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "2",
        kind: "group",
        name: "platform",
        path: "acme/platform",
        parentId: "1",
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "3",
        kind: "group",
        name: "SubOnly",
        path: "OtherParent/SubOnly",
        parentId: "999",
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
    ];

    const tree = buildNamespaceTree(namespaces);
    expect(tree.personal?.id).toBe("personal");
    expect(tree.groups.map((node) => node.namespace.id)).toEqual(["1", "3"]);
    expect(tree.groups[1]?.isOrphanSubgroup).toBe(true);
    expect(tree.groups[0]?.children.map((child) => child.namespace.id)).toEqual(["2"]);

    const filtered = filterNamespaceTree(tree.groups, "platform");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.namespace.id).toBe("1");
    expect(filtered[0]?.children.map((child) => child.namespace.id)).toEqual(["2"]);
  });

  it("computes destination paths by group hierarchy, flat folder, or ghq layout", () => {
    expect(
      computeRepoDestinationPath({
        rootDirectory: "/workspace/dev",
        repo: SAMPLE_REPO,
        host: "gitlab.example.test",
        layout: "group",
      }),
    ).toBe("/workspace/dev/acme/platform/example-app");

    expect(
      computeRepoDestinationPath({
        rootDirectory: "/workspace/parent-project/submodules",
        repo: SAMPLE_REPO,
        host: "gitlab.example.test",
        layout: "flat",
      }),
    ).toBe("/workspace/parent-project/submodules/example-app");

    expect(
      computeRepoDestinationPath({
        rootDirectory: "/workspace/dev",
        repo: SAMPLE_REPO,
        host: "gitlab.example.test",
        layout: "ghq",
      }),
    ).toBe("/workspace/dev/gitlab.example.test/acme/platform/example-app");
  });

  it("falls back to auto-managed root when no custom root directory is configured", () => {
    expect(
      resolveEffectiveCloneRoot({
        customRoot: "",
        newProjectsRoot: "/home/example/.t3/userdata/projects",
      }),
    ).toEqual({
      path: "/home/example/.t3/userdata/projects",
      isAutoManaged: true,
    });

    expect(
      resolveEffectiveCloneRoot({
        customRoot: "~/workspace",
        newProjectsRoot: "/home/example/.t3/userdata/projects",
      }),
    ).toEqual({
      path: "~/workspace",
      isAutoManaged: false,
    });
  });

  it("matches remote repositories against local projects and active clones regardless of SSH/HTTPS URL", () => {
    const project = {
      id: ProjectId.make("proj-1"),
      environmentId: EnvironmentId.make("env-1"),
      title: "example-app",
      workspaceRoot: "/workspace/dev/acme/platform/example-app",
      repositoryIdentity: {
        canonicalKey: "gitlab.example.test/acme/platform/example-app",
        provider: SourceControlProviderKind.make("gitlab"),
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://gitlab.example.test/acme/platform/example-app.git",
        },
      },
    } as unknown as EnvironmentProject;

    const clone: ProjectCloneSnapshot = {
      projectId: ProjectId.make("proj-1"),
      remoteUrl: "git@gitlab.example.test:acme/platform/example-app.git",
      destinationPath: "/workspace/dev/acme/platform/example-app",
      repository: null,
      phase: "running",
      stage: "receiving",
      percent: 45,
      detail: "12 MiB/s",
      error: null,
      startedAt: "2026-11-21T12:00:00Z",
      endedAt: null,
      sequence: 1,
    };

    const index = indexLocalRepositories({ projects: [project], clones: [clone] });
    const matched = index.match(SAMPLE_REPO, "gitlab.example.test");
    expect(matched.project?.id).toBe("proj-1");
    expect(matched.clone?.percent).toBe(45);

    const pathOnlyProject = {
      id: ProjectId.make("proj-path-only"),
      environmentId: EnvironmentId.make("env-1"),
      title: "example-app",
      workspaceRoot: "/workspace/flat/example-app/",
      repositoryIdentity: null,
    } as unknown as EnvironmentProject;
    const pathIndex = indexLocalRepositories({ projects: [pathOnlyProject], clones: [] });
    expect(
      pathIndex.match(SAMPLE_REPO, "gitlab.example.test", "/workspace/flat/example-app").project
        ?.id,
    ).toBe("proj-path-only");
  });

  it("detects duplicate destination paths in a batch clone plan", () => {
    const duplicates = findDuplicateDestinationPaths([
      { destinationPath: "/tmp/shared/app" },
      { destinationPath: "/tmp/shared/app/" },
      { destinationPath: "/tmp/shared/other" },
    ]);
    expect(duplicates.has("/tmp/shared/app")).toBe(true);
    expect(duplicates.has("/tmp/shared/other")).toBe(false);
  });

  it("collects only expandable group IDs across nested levels", () => {
    const tree = buildNamespaceTree([
      {
        id: "1",
        kind: "group",
        name: "acme",
        path: "acme",
        parentId: null,
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "2",
        kind: "group",
        name: "platform",
        path: "acme/platform",
        parentId: "1",
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "3",
        kind: "group",
        name: "services",
        path: "acme/platform/services",
        parentId: "2",
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: "4",
        kind: "group",
        name: "leaf",
        path: "leaf",
        parentId: null,
        description: null,
        webUrl: null,
        avatarUrl: null,
      },
    ]);

    expect(collectExpandableGroupIds(tree.groups)).toEqual(["1", "2"]);
  });

  it("builds clickable folder breadcrumbs for POSIX, tilde, and Windows paths", () => {
    expect(buildFolderBreadcrumbs("/workspace/dev/apps")).toEqual([
      { label: "/", path: "/" },
      { label: "workspace", path: "/workspace/" },
      { label: "dev", path: "/workspace/dev/" },
      { label: "apps", path: "/workspace/dev/apps/" },
    ]);

    expect(buildFolderBreadcrumbs("~/projects/acme/")).toEqual([
      { label: "~", path: "~/" },
      { label: "projects", path: "~/projects/" },
      { label: "acme", path: "~/projects/acme/" },
    ]);

    expect(buildFolderBreadcrumbs("C:\\workspace\\apps")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "workspace", path: "C:\\workspace\\" },
      { label: "apps", path: "C:\\workspace\\apps\\" },
    ]);
  });

  it("summarizes live clone batches including evicted completed snapshots and start errors", () => {
    const runningId = ProjectId.make("proj-running");
    const evictedDoneId = ProjectId.make("proj-done");
    const failedId = ProjectId.make("proj-failed");

    const summary = summarizeCloneBatch({
      items: [
        {
          key: runningId,
          repo: SAMPLE_REPO,
          projectId: runningId,
          destinationPath: "/workspace/dev/running",
          protocol: "auto",
          startError: null,
        },
        {
          key: evictedDoneId,
          repo: { ...SAMPLE_REPO, id: "102", name: "done-app" },
          projectId: evictedDoneId,
          destinationPath: "/workspace/dev/done-app",
          protocol: "auto",
          startError: null,
        },
        {
          key: failedId,
          repo: { ...SAMPLE_REPO, id: "103", name: "failed-app" },
          projectId: failedId,
          destinationPath: "/workspace/dev/failed-app",
          protocol: "auto",
          startError: null,
        },
        {
          key: "start-err",
          repo: { ...SAMPLE_REPO, id: "104", name: "conflict-app" },
          projectId: null,
          destinationPath: "/workspace/dev/conflict-app",
          protocol: "auto",
          startError: "Directory already exists",
        },
      ],
      clones: [
        {
          projectId: runningId,
          remoteUrl: SAMPLE_REPO.httpUrl,
          destinationPath: "/workspace/dev/running",
          repository: null,
          phase: "running",
          stage: "receiving",
          percent: 60,
          detail: "2 MiB/s",
          error: null,
          startedAt: "2026-11-21T12:00:00Z",
          endedAt: null,
          sequence: 1,
        },
        {
          projectId: failedId,
          remoteUrl: SAMPLE_REPO.httpUrl,
          destinationPath: "/workspace/dev/failed-app",
          repository: null,
          phase: "failed",
          stage: "receiving",
          percent: null,
          detail: null,
          error: "Permission denied",
          startedAt: "2026-11-21T12:00:00Z",
          endedAt: "2026-11-21T12:00:05Z",
          sequence: 2,
        },
      ],
      projects: [
        {
          id: evictedDoneId,
          environmentId: EnvironmentId.make("env-1"),
          title: "done-app",
          workspaceRoot: "/workspace/dev/done-app",
        } as unknown as EnvironmentProject,
      ],
    });

    expect(summary.total).toBe(4);
    expect(summary.runningCount).toBe(1);
    expect(summary.doneCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.settledCount).toBe(3);
    expect(summary.isComplete).toBe(false);
    expect(summary.overallPercent).toBe(90);
    expect(summary.items[1]?.status).toBe("done");
    expect(summary.items[3]?.error).toBe("Directory already exists");
  });
});
