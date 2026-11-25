import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect.element(screen.getByText("ChatGPT Work on Desk", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByText("ChatGPT Personal on Desk", { exact: true }))
      .toBeVisible();
  });
});

function account(instanceId: string, usedPercent: number, resetsAt: string): ServerProvider {
  return {
    ...managedChatGpt(instanceId, instanceId),
    usageLimits: {
      checkedAt,
      windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt }],
    },
  };
}

describe("UsageLimitsPooled next refill", () => {
  it("skips elapsed resets while waiting for refreshed account data", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              {
                ...account("Work", 20, "2026-10-25T17:00:00.000Z"),
                driver: ProviderDriverKind.make("claudeAgent"),
              },
              {
                ...account("Personal", 60, "2026-10-25T18:00:00.000Z"),
                driver: ProviderDriverKind.make("claudeAgent"),
              },
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T17:30:00Z")} />,
    );
    await expect.element(screen.getByText("↻ +30%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("↻ +30% in 30m")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T18:00:00Z")} />,
    );
    await expect.element(screen.getByText(/^↻ \+\d+%$/)).not.toBeInTheDocument();
  });
});

it("shows each Codex account's own remaining quota and reset time", async () => {
  const presentations = new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          providers: [
            account("Work", 20, "2026-10-25T17:00:00.000Z"),
            account("Personal", 60, "2026-10-25T18:00:00.000Z"),
          ],
        },
      },
    ],
  ]);
  await using screen = await render(
    <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
  );
  const work = screen.getByRole("region", { name: "Codex · Work" });
  const personal = screen.getByRole("region", { name: "Codex · Personal" });
  await expect.element(work.getByRole("button", { name: /80% left.*1h/ })).toBeVisible();
  await expect.element(personal.getByRole("button", { name: /40% left.*2h/ })).toBeVisible();
  expect(personal.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
    work.element().getBoundingClientRect().bottom,
  );
});

function antigravityAccount(
  instanceId: string,
  displayName: string,
  credentialFingerprint: string,
  usedPercent: number,
  resetsAt: string,
): ServerProvider {
  return {
    ...account(instanceId, usedPercent, resetsAt),
    driver: ProviderDriverKind.make("antigravity"),
    displayName,
    usageLimits: {
      checkedAt,
      credentialFingerprint,
      windows: [
        {
          id: "gemini-5h",
          label: "Gemini · 5-hour",
          kind: "session",
          usedPercent,
          resetsAt,
        },
      ],
    },
  };
}

it("shows each Antigravity account's own remaining quota and reset time", async () => {
  const presentations = new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          providers: [
            antigravityAccount(
              "antigravity",
              "Antigravity",
              "fp-account-1",
              15,
              "2026-10-25T17:00:00.000Z",
            ),
            antigravityAccount(
              "antigravity_work",
              "Work",
              "fp-account-2",
              55,
              "2026-10-25T18:00:00.000Z",
            ),
          ],
        },
      },
    ],
  ]);
  await using screen = await render(
    <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
  );
  const primary = screen.getByRole("region", { name: "Antigravity #1" });
  const work = screen.getByRole("region", { name: "Antigravity · Work" });
  await expect.element(primary.getByRole("button", { name: /85% left.*1h/ })).toBeVisible();
  await expect.element(work.getByRole("button", { name: /45% left.*2h/ })).toBeVisible();
  expect(work.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
    primary.element().getBoundingClientRect().bottom,
  );
});
