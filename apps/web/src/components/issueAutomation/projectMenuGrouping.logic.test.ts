import { describe, expect, it } from "vite-plus/test";

import {
  extractParentDirectory,
  formatCompactParentPath,
  groupProjectsByParentFolder,
  type GroupableProjectItem,
} from "./projectMenuGrouping.logic";

function makeProject(id: string, title: string, workspaceRoot: string): GroupableProjectItem {
  return { id, title, workspaceRoot };
}

describe("projectMenuGrouping.logic", () => {
  it("extracts normalized parent directories across POSIX, Windows, and edge paths", () => {
    expect(extractParentDirectory("/Users/dev/Workspace/Sites/t3code")).toBe(
      "/Users/dev/Workspace/Sites",
    );
    expect(extractParentDirectory("/Users/dev/Workspace/Sites/t3code///")).toBe(
      "/Users/dev/Workspace/Sites",
    );
    expect(extractParentDirectory("C:\\Work\\Mobile\\repo-a")).toBe("C:/Work/Mobile");
    expect(extractParentDirectory("C:\\repo-a")).toBe("C:/");
    expect(extractParentDirectory("/top-level-repo")).toBe("/");
    expect(extractParentDirectory("/")).toBe("");
    expect(extractParentDirectory("")).toBe("");
    expect(extractParentDirectory("standalone-relative")).toBe("");
  });

  it("formats home prefixes compactly", () => {
    expect(formatCompactParentPath("/Users/alice/Desktop/Workspace/Sites")).toBe(
      "~/Desktop/Workspace/Sites",
    );
    expect(formatCompactParentPath("/home/bob/src")).toBe("~/src");
    expect(formatCompactParentPath("/opt/repos")).toBe("/opt/repos");
  });

  it("groups projects by parent folder preserving encounter order and placing ungrouped last", () => {
    const projects = [
      makeProject("p1", "t3code", "/Users/alice/Sites/t3code"),
      makeProject("p2", "No project", ""),
      makeProject("p3", "ym-ios", "/Users/alice/Mobile/ym-ios"),
      makeProject("p4", "web-app", "/Users/alice/Sites/web-app"),
    ];

    const groups = groupProjectsByParentFolder(projects, { ungroupedLabel: "Other" });
    expect(groups.map((g) => ({ key: g.key, label: g.label, count: g.projects.length }))).toEqual([
      { key: "/Users/alice/Sites", label: "Sites", count: 2 },
      { key: "/Users/alice/Mobile", label: "Mobile", count: 1 },
      { key: "__ungrouped__", label: "Other", count: 1 },
    ]);
    expect(groups[0]?.projects.map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(groups[2]?.isUngrouped).toBe(true);
  });

  it("disambiguates duplicate leaf folder names using ancestor segments", () => {
    const projects = [
      makeProject("p1", "api", "/Users/alice/work/apps/api"),
      makeProject("p2", "demo", "/Users/alice/personal/apps/demo"),
      makeProject("p3", "notes", "/Users/alice/docs/notes"),
    ];

    const groups = groupProjectsByParentFolder(projects);
    expect(groups.map((g) => g.label)).toEqual(["work / apps", "personal / apps", "docs"]);
  });

  it("filters across project title, workspaceRoot, and folder label while keeping disambiguation stable", () => {
    const projects = [
      makeProject("p1", "api", "/Users/alice/work/apps/api"),
      makeProject("p2", "worker", "/Users/alice/work/apps/worker"),
      makeProject("p3", "demo", "/Users/alice/personal/apps/demo"),
    ];

    const byFolder = groupProjectsByParentFolder(projects, { search: "personal" });
    expect(byFolder).toHaveLength(1);
    expect(byFolder[0]?.label).toBe("personal / apps");
    expect(byFolder[0]?.projects.map((p) => p.id)).toEqual(["p3"]);

    const byProject = groupProjectsByParentFolder(projects, { search: "work" });
    expect(byProject).toHaveLength(1);
    expect(byProject[0]?.label).toBe("work / apps");
    expect(byProject[0]?.projects.map((p) => p.id)).toEqual(["p1", "p2"]);

    const byExactProject = groupProjectsByParentFolder(projects, { search: "worker" });
    expect(byExactProject).toHaveLength(1);
    expect(byExactProject[0]?.projects.map((p) => p.id)).toEqual(["p2"]);
  });
});
