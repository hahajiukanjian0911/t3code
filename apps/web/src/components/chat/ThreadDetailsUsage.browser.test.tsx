import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { ThreadDetailsContext, ThreadDetailsUsage } from "./ThreadDetailsUsage";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-18T14:00" }));

function provider(driver: string, windows: ServerProviderUsageWindow[]): ServerProvider {
  const checkedAt = "2026-11-18T14:00:00Z";
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    skills: [],
    models: [],
    slashCommands: [],
    usageLimits: { checkedAt, windows },
  };
}

it("lists available windows and opens the selected model's quota in place", async () => {
  const codex = provider("codex", [
    {
      id: "secondary",
      label: "Weekly",
      kind: "weekly",
      usedPercent: 5,
      resetsAt: "2026-11-25T10:00:00Z",
    },
  ]);
  const agy = provider("antigravity", [
    {
      id: "gemini-5h",
      kind: "session",
      label: "Gemini · 5-hour",
      usedPercent: 3,
      resetsAt: "2026-11-18T18:06:00Z",
    },
    {
      id: "gemini-weekly",
      kind: "weekly",
      label: "Gemini · Weekly",
      usedPercent: 16,
      resetsAt: "2026-11-25T08:00:00Z",
    },
    { id: "3p-5h", kind: "session", label: "Claude & GPT (shared) · 5-hour", usedPercent: 0 },
    { id: "3p-weekly", kind: "weekly", label: "Claude & GPT (shared) · Weekly", usedPercent: 0 },
  ]);
  const view = (selected: ServerProvider, model: string) => (
    <div className="w-72">
      <ThreadDetailsUsage
        key={model}
        environmentId={EnvironmentId.make("desk")}
        providerInstanceId={selected.instanceId}
        model={model}
        providers={[codex, agy]}
        sources={[]}
      />
    </div>
  );
  await using screen = await render(view(codex, "gpt-6.2-astra"));
  await expect
    .element(screen.getByRole("img", { name: "Weekly quota trajectory chart" }))
    .toBeVisible();
  expect(screen.container.querySelectorAll("button[aria-expanded]")).toHaveLength(5);
  await screen.rerender(view(agy, "gemini-3.8-flash-high"));
  await expect
    .element(screen.getByRole("img", { name: "Gemini · 5-hour quota trajectory chart" }))
    .toBeVisible();
  const shared = screen.getByRole("button", { name: /Others · 5-hour/ });
  await expect.element(shared.getByText("5-hour", { exact: true })).toBeVisible();
  await userEvent.click(shared);
  await expect.element(shared).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("Reset time unavailable")).toBeVisible();
  await userEvent.click(shared);
  expect(screen.container.querySelector('[aria-expanded="true"]')).toBeNull();
  for (const model of ["claude-opus-5-5", "gpt-oss"]) {
    await screen.rerender(view(agy, model));
    await expect.element(shared).toHaveAttribute("aria-expanded", "true");
  }
});

it("discloses the thread's context usage and shows only reported limits", async () => {
  const report = { usedTokens: 215_000, updatedAt: "2026-11-18T14:00:00Z" };
  const usage = deriveLatestContextWindowSnapshot([], {
    ...report,
    maxTokens: 258_000,
    autoCompactThreshold: 240_000,
  })!;
  await using screen = await render(<ThreadDetailsContext usage={usage} />);
  const toggle = screen.getByRole("button", { name: /Context usage/ });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.element(toggle.getByText("83%", { exact: true })).toBeVisible();
  await userEvent.click(toggle);
  await expect.element(screen.getByText("215,000", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("43,000", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("258,000", { exact: true })).toBeVisible();
  await expect.element(screen.getByText(/240,000/)).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await screen.rerender(
    <ThreadDetailsContext usage={deriveLatestContextWindowSnapshot([], report)!} />,
  );
  await expect.element(toggle.getByText("215k tokens", { exact: true })).toBeVisible();
  await userEvent.keyboard(" ");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("215,000", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Remaining tokens")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Window limit")).not.toBeInTheDocument();
});
