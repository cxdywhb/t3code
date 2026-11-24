import { mcpAppToolApprovals } from "@t3tools/client-runtime/mcp-apps/tool-approval";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { injectMcpAppDocumentBootstrap } from "@t3tools/shared/mcpApp";

import "~/index.css";
import { ConfirmDialogHost } from "~/components/ConfirmDialogHost";
import { isConfirmDialogActive, resetConfirmDialogForTests } from "~/confirmDialog";
import { act, fakeTimers, render } from "../../../test/render";

// Asks to close twice when told to, and answers only the first teardown, so
// the second one is left to finish on the host's timeout.
const APP_HTML = `<script>
let answered = false;
addEventListener("message", (event) => {
  const message = event.data;
  if (message === "close") {
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/request-teardown" }, "*");
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/request-teardown" }, "*");
  } else if (message?.trigger === "call-tool") {
    parent.postMessage({
      jsonrpc: "2.0",
      id: message.id,
      method: "tools/call",
      params: { name: message.name, arguments: message.arguments ?? {} },
    }, "*");
  } else if (message?.method === "ui/resource-teardown" && !answered) {
    answered = true;
    parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
  } else if (message?.jsonrpc === "2.0" && ("result" in message || "error" in message)) {
    parent.postMessage({ t3TestReply: message }, "*");
  }
});
parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
</script>`;

const mockCommands = vi.hoisted(() => ({
  toolInfo: vi.fn(),
  callTool: vi.fn(),
}));
const sizeChanged = (height: number) =>
  `parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: ${height} } }, "*");`;
// What the app's frame shows after the app follows a link: another page in the same window.
// Its nested frame keeps `load`, which stops the app, from firing before its message arrives.
const REPLACEMENT_URL = `data:text/html,${encodeURIComponent(`<script>${sizeChanged(777)}</script><iframe srcdoc="x"></iframe>`)}`;
// Served as the server serves an app: the document bootstrap is its first script.
const NAVIGATING_APP_HTML = injectMcpAppDocumentBootstrap(`<script>
addEventListener("message", (event) => {
  if (event.data === "leave") location.href = ${JSON.stringify(REPLACEMENT_URL)};
  else if (event.data?.id === "init") ${sizeChanged(321)}
});
parent.postMessage({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: {} }, "*");
</script>`);

const asset = vi.hoisted(() => ({ html: "" }));

vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: `data:text/html,${encodeURIComponent(asset.html)}`,
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));

vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: ((command: { readonly label?: string }) => {
    if (command.label === "environment-command:mcp-apps:tool-info") {
      return mockCommands.toolInfo;
    }
    if (command.label === "environment-command:mcp-apps:call-tool") {
      return mockCommands.callTool;
    }
    return async () => ({ _tag: "Success", value: undefined });
  }) as never,
}));

import { McpAppFrame } from "./McpAppFrame";

function setup(html = APP_HTML) {
  asset.html = html;
  resetConfirmDialogForTests();
  mcpAppToolApprovals.resetAll();
  mockCommands.toolInfo.mockReset();
  mockCommands.callTool.mockReset();
  mockCommands.toolInfo.mockResolvedValue({
    _tag: "Success",
    value: {
      callable: true,
      readOnly: false,
      connectionId: "live-connection",
      title: "mobile_android_stream_reset",
    },
  });
  mockCommands.callTool.mockResolvedValue({
    _tag: "Success",
    value: { content: [{ type: "text", text: "ok" }] },
  });
}

const nextInitializedFrom = () =>
  new Promise<MessageEventSource>((resolve) => {
    const listen = (event: MessageEvent) => {
      if (event.source === null || event.data?.method !== "ui/notifications/initialized") return;
      window.removeEventListener("message", listen);
      resolve(event.source);
    };
    window.addEventListener("message", listen);
  });

const nextReplyFor = (id: string | number) =>
  new Promise<{ readonly result?: unknown; readonly error?: { readonly message: string } }>(
    (resolve) => {
      const listen = (event: MessageEvent) => {
        const reply = event.data?.t3TestReply;
        if (!reply || reply.id !== id) return;
        window.removeEventListener("message", listen);
        resolve(reply);
      };
      window.addEventListener("message", listen);
    },
  );

const defaultAppProps = () => ({
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  conversationThreadId: ThreadId.make("thread"),
  itemId: TurnItemId.make("item"),
  revision: "1",
  app: {
    attachmentId: "attachment",
    server: "mobile-dev",
    tool: "mobile_android_stream",
    resourceUri: "ui://mobile-dev/stream",
  },
  onSendMessage: undefined,
});

describe("McpAppFrame", () => {
  it("keeps a reopened app when the old document's second teardown finishes late", async () => {
    setup();
    const firstInitialized = nextInitializedFrom();
    await using screen = await render(<McpAppFrame {...defaultAppProps()} />);
    const firstApp = await firstInitialized;
    using _timers = fakeTimers();

    (firstApp as Window).postMessage("close", "*");
    await userEvent.click(screen.getByRole("button", { name: "Show app" }));
    await expect.element(screen.getByTitle("mobile-dev app")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("button", { name: "Show app" }).query()).toBeNull();
    await expect.element(screen.getByTitle("mobile-dev app")).toBeInTheDocument();
  });

  it("allows an MCP app tool for the session, displays the permission bar, and prompts again after Reset", async () => {
    setup();
    const firstInitialized = nextInitializedFrom();
    await using screen = await render(
      <>
        <ConfirmDialogHost />
        <McpAppFrame {...defaultAppProps()} />
      </>,
    );
    const appWindow = (await firstInitialized) as Window;

    const firstReply = nextReplyFor("req-1");
    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "req-1",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );

    await expect
      .element(page.getByRole("button", { name: "Always allow this session" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Always allow this session" }));
    await expect(firstReply).resolves.toMatchObject({
      result: { content: [{ type: "text", text: "ok" }] },
    });
    await expect.element(page.getByRole("button", { name: "Allow once" })).not.toBeInTheDocument();

    await expect
      .element(screen.getByText("Allowed this session: mobile_android_stream_reset"))
      .toBeVisible();

    const secondReply = nextReplyFor("req-2");
    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "req-2",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect(secondReply).resolves.toMatchObject({
      result: { content: [{ type: "text", text: "ok" }] },
    });
    expect(mockCommands.callTool).toHaveBeenCalledTimes(2);
    expect(mockCommands.callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ connectionId: "live-connection" }),
      }),
    );
    expect(page.getByRole("button", { name: "Allow once" }).query()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reset", exact: true }));
    expect(screen.getByRole("button", { name: "Reset", exact: true }).query()).toBeNull();

    // A legacy server supports explicit approval for this call only.
    mockCommands.toolInfo.mockResolvedValue({
      _tag: "Success",
      value: { callable: true, readOnly: false },
    });
    const thirdReply = nextReplyFor("req-3");
    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "req-3",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect.element(page.getByRole("button", { name: "Allow once" })).toBeVisible();
    expect(page.getByRole("button", { name: "Always allow this session" }).query()).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Allow once" }));
    await expect(thirdReply).resolves.toMatchObject({
      result: { content: [{ type: "text", text: "ok" }] },
    });
  });

  it("suppresses repeated background calls after Cancel and deduplicates concurrent prompts", async () => {
    setup();
    const firstInitialized = nextInitializedFrom();
    await using screen = await render(
      <>
        <ConfirmDialogHost />
        <McpAppFrame {...defaultAppProps()} />
      </>,
    );
    const appWindow = (await firstInitialized) as Window;

    const firstReply = nextReplyFor("dup-1");
    const duplicateReply = nextReplyFor("dup-2");
    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "dup-1",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "dup-2",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect(duplicateReply).resolves.toMatchObject({
      error: { message: "Waiting for approval of this tool." },
    });

    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await expect(firstReply).resolves.toMatchObject({
      error: { message: "Declined by the user." },
    });
    await expect.element(page.getByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Muted prompts: mobile_android_stream_reset"))
      .toBeVisible();

    const suppressedReply = nextReplyFor("bg-3");
    appWindow.postMessage(
      {
        trigger: "call-tool",
        id: "bg-3",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect(suppressedReply).resolves.toMatchObject({
      error: { message: "Declined by the user." },
    });
    expect(page.getByRole("button", { name: "Allow once" }).query()).toBeNull();
    expect(mockCommands.callTool).not.toHaveBeenCalled();
  });

  it("cancels an open approval prompt on unmount without suppressing future calls", async () => {
    setup();
    const firstInitialized = nextInitializedFrom();
    await using screen = await render(
      <>
        <ConfirmDialogHost />
        <McpAppFrame {...defaultAppProps()} />
      </>,
    );
    const firstWindow = (await firstInitialized) as Window;

    firstWindow.postMessage(
      {
        trigger: "call-tool",
        id: "unmount-1",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect.element(page.getByRole("button", { name: "Allow once" })).toBeVisible();

    await screen.rerender(<ConfirmDialogHost />);
    await expect.element(page.getByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    expect(isConfirmDialogActive()).toBe(false);
    expect(
      mcpAppToolApprovals.isPromptPending({
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
        itemId: TurnItemId.make("item"),
        connectionId: "live-connection",
        server: "mobile-dev",
        tool: "mobile_android_stream_reset",
      }),
    ).toBe(false);
    expect(
      mcpAppToolApprovals.isBackgroundSuppressed({
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
        itemId: TurnItemId.make("item"),
        connectionId: "live-connection",
        server: "mobile-dev",
        tool: "mobile_android_stream_reset",
      }),
    ).toBe(false);

    const secondInitialized = nextInitializedFrom();
    await screen.rerender(
      <>
        <ConfirmDialogHost />
        <McpAppFrame {...defaultAppProps()} />
      </>,
    );
    const secondWindow = (await secondInitialized) as Window;

    secondWindow.postMessage(
      {
        trigger: "call-tool",
        id: "unmount-2",
        name: "mobile_android_stream_reset",
        arguments: { sessionId: "session-1" },
      },
      "*",
    );
    await expect.element(page.getByRole("button", { name: "Allow once" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await expect.element(page.getByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
  });

  it("ignores a page the app's frame navigated to", async () => {
    setup(NAVIGATING_APP_HTML);
    const element = () => (
      <McpAppFrame
        environmentId={EnvironmentId.make("environment")}
        threadId={ThreadId.make("thread")}
        conversationThreadId={ThreadId.make("thread")}
        itemId={TurnItemId.make("item")}
        revision="1"
        app={{
          attachmentId: "attachment",
          server: "Demo",
          tool: "show",
          resourceUri: "ui://demo/app",
        }}
        onSendMessage={undefined}
      />
    );
    await using screen = await render(element());
    const frame = screen.getByTitle("Demo app").element() as HTMLIFrameElement;
    const row = frame.parentElement!.parentElement!;
    // The app resizes only after the host's answer reached it, so the bridge works both ways.
    await expect.element(row).toHaveStyle({ height: "321px" });

    // A tool update hands the row an equal app in a new object, which re-attaches the host.
    await screen.rerender(element());
    frame.contentWindow!.postMessage("leave", "*");
    await expect
      .element(screen.getByText("The Demo app left its page and was stopped"))
      .toBeInTheDocument();
    expect(row.style.height).toBe("321px");
  });
});
