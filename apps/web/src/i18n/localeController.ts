import type { UiLocale } from "@t3tools/contracts/settings";

/** Wuchale's pending catalogs are global: serialize loads and commit only the latest request. */
export function createLocaleController(runtime: {
  load: (locale: UiLocale) => Promise<void>;
  commit: (locale: UiLocale) => void;
}) {
  let generation = 0;
  let queue = Promise.resolve();
  return (locale: UiLocale): Promise<void> => {
    const request = ++generation;
    const result = queue.then(async () => {
      if (request !== generation) return;
      await runtime.load(locale);
      if (request === generation) runtime.commit(locale);
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
