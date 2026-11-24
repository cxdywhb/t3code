import type { PullRequestReviewPosition } from "@t3tools/contracts";

import { HUNK_HEADER, headerPath } from "./pullRequestReviewGuideNormalize.ts";

/** `new` numbers a line in the PR's head, `old` in its base. */
export type ReviewLineSide = "new" | "old";

/** Where a line of `path` sits in a unified patch, or null when the patch does not show it. */
export function reviewPositionInPatch(
  patch: string,
  path: string,
  line: number,
  side: ReviewLineSide,
): PullRequestReviewPosition | null {
  let oldPath: string | null = null;
  let inFile = false;
  let inHunks = false;
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split("\n")) {
    if (text.startsWith("diff --git ")) {
      oldPath = null;
      inFile = false;
      inHunks = false;
    } else if (!inHunks && text.startsWith("--- ")) {
      oldPath = headerPath(text, "a/");
    } else if (!inHunks && text.startsWith("+++ ")) {
      inFile = (headerPath(text, "b/") ?? oldPath) === path;
    } else if (text.startsWith("@@")) {
      // Every file's hunks count, so another file's `+++ ` source line is never a header.
      const header = HUNK_HEADER.exec(text);
      if (header === null) continue;
      inHunks = true;
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
    } else if (inFile && inHunks) {
      if (text.startsWith("+")) {
        if (side === "new" && newLine === line) return { kind: "added", newLine };
        newLine += 1;
      } else if (text.startsWith("-")) {
        if (side === "old" && oldLine === line) return { kind: "deleted", oldLine };
        oldLine += 1;
      } else if (text.startsWith(" ")) {
        if ((side === "new" ? newLine : oldLine) === line) {
          return { kind: "context", oldLine, newLine, side: side === "new" ? "right" : "left" };
        }
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  return null;
}

export interface LocatedReviewCommentPosition {
  readonly path: string;
  readonly oldPath?: string;
  readonly position: PullRequestReviewPosition;
}

function normalizeCandidatePaths(rawPath: string): ReadonlyArray<string> {
  const cleaned = rawPath
    .trim()
    .replace(/^[`"']+|[`"']+$/gu, "")
    .trim()
    .replace(/^(?:\.\/+|\/+)/u, "");
  if (cleaned.length === 0) return [];
  const strippedDiffPrefix = cleaned.replace(/^(?:a|b)\//u, "");
  return strippedDiffPrefix.length > 0 && strippedDiffPrefix !== cleaned
    ? [cleaned, strippedDiffPrefix]
    : [cleaned];
}

/**
 * Resolves a review finding `(rawPath, line)` against a unified patch, returning the canonical
 * path, optional pre-rename `oldPath`, and exact hunk position (`added`, `context` with both
 * line numbers, or `deleted` for deleted files), or `null` when the line sits outside every hunk.
 */
export function locateReviewCommentInPatch(
  patch: string,
  rawPath: string,
  line: number,
): LocatedReviewCommentPosition | null {
  if (!Number.isInteger(line) || line <= 0) return null;
  const candidates = new Set(normalizeCandidatePaths(rawPath));
  if (candidates.size === 0) return null;

  let oldPath: string | null = null;
  let newPath: string | null = null;
  let inFile = false;
  let inHunks = false;
  let oldLine = 0;
  let newLine = 0;

  for (const text of patch.split("\n")) {
    if (text.startsWith("diff --git ")) {
      oldPath = null;
      newPath = null;
      inFile = false;
      inHunks = false;
    } else if (!inHunks && text.startsWith("--- ")) {
      oldPath = headerPath(text, "a/");
    } else if (!inHunks && text.startsWith("+++ ")) {
      newPath = headerPath(text, "b/");
      const effectivePath = newPath ?? oldPath;
      inFile =
        (effectivePath !== null && candidates.has(effectivePath)) ||
        (oldPath !== null && candidates.has(oldPath));
    } else if (text.startsWith("@@")) {
      const header = HUNK_HEADER.exec(text);
      if (header === null) continue;
      inHunks = true;
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
    } else if (inFile && inHunks) {
      const canonicalPath = newPath ?? oldPath;
      if (canonicalPath === null) continue;
      const renameFields =
        oldPath !== null && newPath !== null && oldPath !== newPath ? { oldPath } : {};
      if (text.startsWith("+")) {
        if (newLine === line) {
          return {
            path: canonicalPath,
            ...renameFields,
            position: { kind: "added", newLine },
          };
        }
        newLine += 1;
      } else if (text.startsWith("-")) {
        if (newPath === null && oldLine === line) {
          return {
            path: canonicalPath,
            position: { kind: "deleted", oldLine },
          };
        }
        oldLine += 1;
      } else if (text.startsWith(" ")) {
        if (newLine === line) {
          return {
            path: canonicalPath,
            ...renameFields,
            position: { kind: "context", oldLine, newLine, side: "right" },
          };
        }
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  return null;
}
