import { isIssueAutomationFeishuWebhook, type IssueAutomationTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { zenTaoBugStatusLabel } from "./connectors/zentao/ZenTaoClient.ts";

const notifiedStages = {
  completed: "已完成",
  needs_human: "待人工复核",
  failed: "失败",
};

const FeishuResponse = Schema.Union([
  Schema.Struct({ code: Schema.Number }),
  Schema.Struct({ StatusCode: Schema.Number }),
]);

export const sendFeishuTaskNotification = Effect.fn("IssueAutomation.sendFeishuTaskNotification")(
  function* <E>(
    httpClient: HttpClient.HttpClient,
    getWebhook: Effect.Effect<string | undefined, E>,
    task: IssueAutomationTask,
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

    const text = (value: string) => ({ tag: "text", text: value });
    const request = yield* HttpClientRequest.post(webhook).pipe(
      HttpClientRequest.bodyJson({
        msg_type: "post",
        content: {
          post: {
            zh_cn: {
              content: [
                [text(`任务状态：${notifiedStages[task.stage]}`)],
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
