import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

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

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });

  it("expands and collapses the interactive quota trajectory curve on pool card click", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              {
                instanceId: ProviderInstanceId.make("antigravity_main"),
                driver: ProviderDriverKind.make("antigravity"),
                displayName: "Antigravity",
                enabled: true,
                installed: true,
                version: null,
                status: "ready" as const,
                auth: { status: "authenticated" as const, email: "dev@example.com" },
                checkedAt,
                models: [],
                slashCommands: [],
                skills: [],
                usageLimits: {
                  checkedAt,
                  windows: [
                    {
                      id: "gemini-session",
                      kind: "session" as const,
                      label: "Gemini · 5-hour",
                      usedPercent: 18,
                      resetsAt: "2026-10-25T17:04:00.000Z",
                      windowDurationMins: 300,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    ]);

    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    expect(screen.container.querySelector("[data-usage-limit-trajectory]")).toBeNull();

    // Click card to expand trajectory chart
    const card = screen.container.querySelector<HTMLElement>("[data-usage-limit-card]")!;
    await userEvent.click(card);
    await expect
      .element(screen.getByRole("img", { name: /quota trajectory chart/i }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "1h", exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Even", exact: true }));
    await expect
      .element(screen.getByRole("button", { name: "Even", exact: true }))
      .toHaveAttribute("aria-pressed", "true");

    // Click toggle button to collapse
    await userEvent.click(screen.getByRole("button", { name: /Hide .* quota trajectory/i }));
    expect(screen.container.querySelector("[data-usage-limit-trajectory]")).toBeNull();
  });
});
