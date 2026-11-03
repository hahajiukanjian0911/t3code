import { commitLocale, loadLocale } from "wuchale/load-utils";

import "../locales/main.loader.js";
import { createLocaleController } from "./localeController";

let revision = 0;
const listeners = new Set<() => void>();

export const getLocaleRevision = () => revision;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const applyInterfaceLocale = createLocaleController({
  load: (locale) => loadLocale(locale, false),
  commit(locale) {
    commitLocale(locale);
    document.documentElement.lang = locale;
    revision += 1;
    for (const listener of listeners) listener();
  },
});
