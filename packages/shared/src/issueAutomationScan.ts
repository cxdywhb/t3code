import type { IssueAutomationIssueFilter } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

type FilterableIssue = {
  readonly confirmed: boolean;
  readonly severity: number | null;
  readonly assignee: string | null;
};

export function matchesIssueAutomationFilter(
  issue: FilterableIssue,
  filter: IssueAutomationIssueFilter,
): boolean {
  const assignedTo = filter.assignedToAccount?.trim().toLowerCase();
  return (
    (!filter.onlyUnconfirmed || !issue.confirmed) &&
    (filter.maxSeverity === null ||
      issue.severity === null ||
      issue.severity <= filter.maxSeverity) &&
    (!assignedTo || (issue.assignee ?? "").toLowerCase().includes(assignedTo))
  );
}

export const scanIssueAutomationPage = Effect.fn("IssueAutomation.scanIssuePage")(function* <
  A extends FilterableIssue,
  E,
  R,
>(
  page: number,
  filter: IssueAutomationIssueFilter,
  load: (
    page: number,
    pageSize: number,
  ) => Effect.Effect<{ readonly items: ReadonlyArray<A>; readonly total: number }, E, R>,
) {
  const pageSize = 25;
  const sourcePageSize = 100;
  const offset = (page - 1) * pageSize;
  const matches: A[] = [];
  let seen = 0;
  for (let sourcePage = 1; matches.length <= pageSize; sourcePage++) {
    const source = yield* load(sourcePage, sourcePageSize);
    for (const item of source.items) {
      if (!matchesIssueAutomationFilter(item, filter) || seen++ < offset) continue;
      matches.push(item);
      if (matches.length > pageSize) break;
    }
    if (sourcePage * sourcePageSize >= source.total) break;
  }
  return { items: matches.slice(0, pageSize), hasNextPage: matches.length > pageSize };
});
