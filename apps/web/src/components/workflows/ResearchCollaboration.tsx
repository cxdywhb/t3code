import type { EnvironmentId } from "@t3tools/contracts";
import { workflowRunState } from "@t3tools/client-runtime/workflows";
import { formatDateTimeTimestamp } from "../../timestampFormat";
import { useGT, useMessages } from "gt-react";
import ChatMarkdown from "../ChatMarkdown";
import { collaborationStage } from "./ResearchCollaboration.logic";
import { Link } from "@tanstack/react-router";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

const stages = [
  ["prd-", "需求 · 唐僧"],
  ["analysis-", "分析 · 沙僧"],
  ["requirements-review-", "需求评审 · 观音"],
  ["design-", "设计 · 孙悟空"],
  ["design-review-", "设计评审 · 太上老君"],
  ["qa-", "测试用例 · 猪八戒"],
  ["archive", "归档 · 系统"],
] as const;

export function ResearchCollaboration({
  environmentId,
  selected,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const live = useEnvironmentQuery(serverEnvironment.workflowsLive({ environmentId, input: {} }));
  const runs = live.data?.runs.filter((run) => run.workflow === "pilgrimage-rd");

  const active = runs?.find((run) => run.runId === selected) ?? runs?.[0];
  return (
    <div className="min-h-0 flex-1 min-w-0 overflow-auto p-3 sm:p-6">
      <h1 className="text-xl font-semibold">{gt("Research collaboration")}</h1>
      <p role="status" className="my-3 text-sm text-muted-foreground">
        {live.error ? live.error : live.data ? gt("Connected · Live updates") : gt("Connecting…")}
      </p>
      {runs?.length === 0 ? (
        <p>{gt("No pilgrimage-rd runs. Start the workflow from the CLI.")}</p>
      ) : null}
      {runs?.map((run) => (
        <section key={run.runId} className="my-4 rounded-lg border p-4">
          <button
            type="button"
            className="text-start font-medium break-words"
            onClick={() => onSelect(run.runId)}
            aria-pressed={active?.runId === run.runId}
          >
            {run.title} ·{" "}
            {
              workflowRunState(
                {
                  run,
                  questions: live.data?.questions.filter((q) => q.runId === run.runId) ?? [],
                  children: [],
                },
                m,
              ).word
            }
          </button>
          <p className="text-xs text-muted-foreground">
            {formatDateTimeTimestamp(run.updatedAt, "locale")}
          </p>
          <Link
            to="/workflows"
            search={{ env: environmentId, run: run.runId }}
            className="underline"
          >
            {gt("Open workflow")}
          </Link>
          {active?.runId === run.runId ? (
            <RunStages environmentId={environmentId} runId={run.runId} />
          ) : null}
        </section>
      ))}
    </div>
  );
}

function RunStages({
  environmentId,
  runId,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
}) {
  const gt = useGT();
  const detail = useEnvironmentQuery(
    serverEnvironment.workflowRun({ environmentId, input: { runId } }),
  );
  if (detail.error) return <p role="alert">{detail.error}</p>;
  if (!detail.data) return <p role="status">{gt("Loading stages…")}</p>;
  const snapshot = detail.data;
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {stages.map(([prefix, title]) => {
        const steps = snapshot.steps.filter((step) => collaborationStage(step.name) === prefix);
        return (
          <section key={prefix} className="rounded-md border p-3">
            <h3 className="border-b pb-2 font-medium">{title}</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">{gt("Not started")}</p>
            ) : (
              steps.map((step) => (
                <details key={step.name} className="mt-3 space-y-1 text-sm">
                  <summary className="cursor-pointer break-words">
                    {step.name} ·{" "}
                    {step.result &&
                    typeof step.result === "object" &&
                    "decision" in step.result &&
                    typeof step.result.decision === "string"
                      ? step.result.decision
                      : step.status}{" "}
                    · {gt("Attempts: {count}", { count: step.attempts })}
                  </summary>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeTimestamp(step.startedAt, "locale")} →{" "}
                    {step.endedAt
                      ? formatDateTimeTimestamp(step.endedAt, "locale")
                      : gt("In progress")}
                  </p>
                  {step.detail ? <p>{step.detail}</p> : null}
                  {step.result === null && step.said ? (
                    <p className="whitespace-pre-wrap">{step.said}</p>
                  ) : null}
                  {step.result !== null ? <ResultContent value={step.result} /> : null}
                  {step.threadId ? (
                    <Link
                      to="/workflows"
                      search={{
                        env: environmentId,
                        run: runId,
                        pane: [
                          {
                            thread: step.threadId,
                            ...(step.environmentId === null ? {} : { env: step.environmentId }),
                          },
                        ],
                      }}
                      className="underline"
                    >
                      {gt("Open thread")}
                    </Link>
                  ) : null}
                </details>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function ResultContent({ value }: { readonly value: unknown }) {
  if (typeof value === "string") return <ChatMarkdown text={value} cwd={undefined} />;
  if (value === null || typeof value !== "object") return null;
  return (
    <div className="min-w-0 space-y-2 break-words">
      {Object.entries(value).map(([key, content]) =>
        typeof content === "string" ? (
          <div key={key}>
            <p className="text-xs text-muted-foreground">{key}</p>
            <ChatMarkdown text={content} cwd={undefined} />
          </div>
        ) : (
          <details key={key}>
            <summary>{key}</summary>
            <ResultContent value={content} />
          </details>
        ),
      )}
    </div>
  );
}
