import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "@fontsource-variable/inter";
import "~/index.css";

import { AppRoot } from "~/AppRoot";
import {
  __setClientSettingsForTests,
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  updateClientSettings,
} from "~/hooks/useSettings";
import { readBrowserClientSettings, writeBrowserClientSettings } from "~/clientPersistenceStorage";
import { getRouter } from "~/router";
import { startInterfaceLocale } from "../src/i18n/locale";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "./fakeEnvironment";
import { render } from "./render";

vi.mock("../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("./fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

async function capture(name: string) {
  const directory = import.meta.env.VITE_I18N_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

it("switches language without reloading, persists the preference and searches Chinese settings", async () => {
  const thread = { ...threadWithHistory("locale-fixture", 1), title: "Settings" };
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  using _locale = { [Symbol.dispose]: await startInterfaceLocale() };
  await page.viewport(1400, 900);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings/appearance"] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, {
    router: false, // AppRoot owns the real application router.
  });
  await expect.element(page.getByRole("heading", { name: "Interface", exact: true })).toBeVisible();
  await capture("before-english");

  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "界面", exact: true })).toBeVisible();
  expect(getClientSettings().uiLocale).toBe("zh-CN");
  expect(readBrowserClientSettings()?.uiLocale).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  await capture("after-chinese");

  const search = page.getByRole("combobox", { name: "搜索设置", exact: true });
  await search.fill("语言");
  await expect.element(page.getByRole("option", { name: /界面语言/ })).toBeVisible();
  await search.fill("no-such-setting-语言");
  await expect.element(page.getByRole("status").filter({ hasText: "未找到设置" })).toBeVisible();
  await search.fill("");
  await page.getByRole("combobox", { name: "界面语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "Interface", exact: true })).toBeVisible();
  expect(getClientSettings().uiLocale).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});

it("restores Chinese on startup and preserves the original conversation, code and model names", async () => {
  const thread = { ...threadWithHistory("locale-fixture", 1), title: "Settings" };
  using _environment = installFakeEnvironment([thread]);
  writeBrowserClientSettings({
    ...DEFAULT_CLIENT_SETTINGS,
    uiLocale: "zh-CN",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  __resetClientSettingsPersistenceForTests();
  using _locale = { [Symbol.dispose]: await startInterfaceLocale() };
  expect(getClientSettings().uiLocale).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, { router: false }); // AppRoot owns the real router.
  await expect.element(page.getByText("locale-fixture: question 0", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Sidebar.tsx", { exact: true })).toBeVisible();
  await expect.element(page.getByText("GPT-5.4", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("输入问题。@ 引用文件，$ 选择技能，/ 使用命令", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await capture("chinese-chat-original-content");
  const composer = page.getByRole("textbox");
  await composer.fill("Settings");
  await updateClientSettings({ uiLocale: "en" });
  await expect.element(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect.element(composer).toHaveTextContent("Settings");
});

it("keeps the language control readable and usable in a narrow web window", async () => {
  using _environment = installFakeEnvironment([threadWithHistory("locale-narrow", 1)]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    uiLocale: "zh-CN",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  using _locale = { [Symbol.dispose]: await startInterfaceLocale() };
  await page.viewport(390, 844);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings/appearance"] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, { router: false }); // AppRoot owns the real router.
  const language = page.getByRole("combobox", { name: "界面语言", exact: true });
  await expect.element(language).toBeVisible();
  await language.click();
  await expect.element(page.getByRole("option", { name: "English", exact: true })).toBeVisible();
  await capture("chinese-narrow-language-menu");
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "Interface", exact: true })).toBeVisible();
});
