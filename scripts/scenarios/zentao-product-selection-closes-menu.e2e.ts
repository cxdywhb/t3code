// @effect-diagnostics-next-line nodeBuiltinImport:off -- The scenario supplies a loopback ZenTao fixture.
import * as NodeHttp from "node:http";
import { IssueAutomationPlatformKind, WS_METHODS } from "@t3tools/contracts";
import { expect } from "e2e";
import * as Effect from "effect/Effect";

import { T3_HOME } from "../e2e.config.ts";
import { rpcClient, runPromise, test, WEB } from "./t3.ts";

test(
  "Selecting a ZenTao product closes the unattended rule menu",
  WEB,
  async ({ t3, app, screen }) => {
    const replies: Record<string, unknown> = {
      getconfig: { requestType: "GET" },
      getSessionID: { sessionID: "fixture-session" },
      login: { status: "success" },
      browse: {
        products: Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => [index + 1, `Test product ${index + 1}`]),
        ),
      },
    };
    await using zentao = NodeHttp.createServer((request, response) => {
      request.resume();
      const { searchParams } = new URL(request.url ?? "/", "http://127.0.0.1");
      const action = searchParams.get("f") ?? searchParams.get("mode") ?? "";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(replies[action] ?? {}));
    });
    await new Promise<void>((resolve) => zentao.listen(0, "127.0.0.1", resolve));
    const address = zentao.address();
    if (address === null || typeof address === "string") throw new Error("No fixture port");

    await t3.project("demo");
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, app.baseUrl ?? "");
        yield* Effect.acquireRelease(
          client[WS_METHODS.issueAutomationSaveConnector]({
            platform: IssueAutomationPlatformKind.make("zentao"),
            name: "Test ZenTao",
            baseUrl: `http://127.0.0.1:${address.port}`,
            account: "fixture",
            secret: "fixture-secret",
          }),
          (connector) =>
            client[WS_METHODS.issueAutomationDeleteConnector]({ connectorId: connector.id }).pipe(
              Effect.ignore({ log: true }),
            ),
        );

        yield* Effect.promise(async () => {
          await t3.open("/issue-automation");
          await screen.getByRole("button", "Unattended rule", { exact: true }).tap();
          const trigger = screen.getByRole("button", "Select ZenTao product", { exact: true });
          await trigger.tap();
          await screen.getByRole("textbox", "Search products").fill("Test product 2");
          await screen.getByRole("menuitemradio", /Test product 2/).tap();

          await expect.soft(trigger).toContainText("#2 · Test product 2");
          await expect.soft(trigger).toHaveAttribute("aria-expanded", "false");
          await app.screenshot("zentao-product-selected");
        });
      }).pipe(Effect.scoped),
    );
  },
);
