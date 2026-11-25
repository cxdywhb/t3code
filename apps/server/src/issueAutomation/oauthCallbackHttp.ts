import { ISSUE_AUTOMATION_OAUTH_CALLBACK_PATH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestUrl } from "../requestUrl.ts";
import * as IssueAutomationService from "./IssueAutomationService.ts";

const headers = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'sha256-h0NufX2/0l7EdjngE9B3jCXeQmJX7z1VwGQMiqiETNE='; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function callbackPage(success: boolean) {
  const title = success ? "ZenTao connected" : "ZenTao authorization could not finish";
  return HttpServerResponse.text(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body data-connected="${success}"><h1>${title}</h1><p>Return to T3 Code to continue.</p><script>history.replaceState(null, "", location.pathname);if (document.body.dataset.connected === "true") window.close();</script></body></html>`,
    { status: success ? 200 : 400, contentType: "text/html; charset=utf-8", headers },
  );
}

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const issueAutomation = yield* IssueAutomationService.IssueAutomationService;
    return HttpRouter.add(
      "GET",
      ISSUE_AUTOMATION_OAUTH_CALLBACK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const callback = requestUrl(request);
        if (Option.isNone(callback)) return callbackPage(false);
        return yield* issueAutomation.handleConnectorAuthCallback(callback.value).pipe(
          Effect.match({
            onFailure: () => callbackPage(false),
            onSuccess: () => callbackPage(true),
          }),
        );
      }).pipe(HttpMiddleware.withLoggerDisabled),
    );
  }),
);
