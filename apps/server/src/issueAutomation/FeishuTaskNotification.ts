import { isIssueAutomationFeishuWebhook, type IssueAutomationTask } from "@t3tools/contracts";
import { issueAutomationWorkbenchTitleZh } from "@t3tools/shared/issueAutomationTitle";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { zenTaoBugStatusLabel } from "./connectors/zentao/ZenTaoClient.ts";

type FeishuTask = Pick<
  IssueAutomationTask,
  | "actionMode"
  | "assignee"
  | "displayKey"
  | "issueStatus"
  | "issueTitle"
  | "issueUrl"
  | "platform"
  | "scopeName"
  | "stage"
>;

function formatTaskStatus(
  stage: "completed" | "needs_human" | "failed",
  diagnosisOnly: boolean,
  hasConfirmedRepair: boolean,
): string {
  switch (stage) {
    case "needs_human":
      return "修复待人工复核";
    case "failed":
      return diagnosisOnly ? "诊断失败" : "修复任务失败";
    case "completed":
      if (diagnosisOnly) return "诊断完成";
      return hasConfirmedRepair ? "修复完成" : "修复任务结束，待确认";
  }
}

const FeishuResponse = Schema.Union([
  Schema.Struct({ code: Schema.Number }),
  Schema.Struct({ StatusCode: Schema.Number }),
]);

export const sendFeishuTaskNotification = Effect.fn("IssueAutomation.sendFeishuTaskNotification")(
  function* <E>(
    httpClient: HttpClient.HttpClient,
    getWebhook: Effect.Effect<string | undefined, E>,
    task: FeishuTask,
    result: { readonly appDisplayName: string; readonly hasConfirmedRepair: boolean },
  ) {
    if (
      task.platform !== "zentao" ||
      (task.stage !== "completed" && task.stage !== "needs_human" && task.stage !== "failed")
    ) {
      return true;
    }
    const webhook = yield* getWebhook;
    if (webhook === undefined) return true;
    if (!isIssueAutomationFeishuWebhook(webhook)) return false;

    const status = formatTaskStatus(
      task.stage,
      task.actionMode === "diagnose_only",
      result.hasConfirmedRepair,
    );
    const text = (value: string) => ({ tag: "text", text: value });
    const request = yield* HttpClientRequest.post(webhook).pipe(
      HttpClientRequest.bodyJson({
        msg_type: "post",
        content: {
          post: {
            zh_cn: {
              title: `${result.appDisplayName} · ${issueAutomationWorkbenchTitleZh}`,
              content: [
                [text(`任务状态：${status}`)],
                [
                  text("禅道 Bug："),
                  { tag: "a", text: `${task.displayKey} ${task.issueTitle}`, href: task.issueUrl },
                ],
                [text(`Bug 状态：${zenTaoBugStatusLabel(task.issueStatus)}`)],
                [text(`项目名：${task.scopeName}`)],
                [text(`负责人：${task.assignee || "未指派"}`)],
              ],
            },
          },
        },
      }),
    );
    const response = yield* HttpClient.withScope(httpClient).execute(request);
    if (response.status < 200 || response.status >= 300) return false;
    const body = yield* HttpClientResponse.schemaBodyJson(FeishuResponse)(response);
    return ("code" in body ? body.code : body.StatusCode) === 0;
  },
  Effect.scoped,
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
  Effect.withTracerEnabled(false),
  Effect.timeoutOption("5 seconds"),
  Effect.map((result) => result._tag === "Some" && result.value),
  Effect.orElseSucceed(() => false),
);
