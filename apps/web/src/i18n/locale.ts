import type { UiLocale } from "@t3tools/contracts/settings";

import {
  ensureClientSettingsHydrated,
  getClientSettings,
  subscribeClientSettings,
} from "../hooks/useSettings";
import { applyInterfaceLocale } from "./runtime";

/** Await before mounting, then follow this client's preferences without remounting the app. */
export async function startInterfaceLocale(): Promise<() => void> {
  await ensureClientSettingsHydrated().catch(() => undefined);
  let requested = getClientSettings().uiLocale;
  const apply = async (locale: UiLocale) => {
    try {
      await applyInterfaceLocale(locale);
    } catch (error) {
      if (locale !== requested) return;
      console.error("Could not load the interface language; using English.", error);
      await applyInterfaceLocale("en");
    }
  };
  const unsubscribe = subscribeClientSettings(() => {
    const next = getClientSettings().uiLocale;
    if (next === requested) return;
    requested = next;
    void apply(next);
  });
  await apply(requested);
  return unsubscribe;
}
