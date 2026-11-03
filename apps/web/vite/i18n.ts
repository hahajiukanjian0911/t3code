import { wuchale } from "wuchale/vite";
import type { Plugin } from "vite-plus";
import * as NodeURL from "node:url";

/** Keep translation in the client build; Node tests exercise the original source. */
export function interfaceTranslations(): Plugin {
  const plugin = wuchale({
    configPath: NodeURL.fileURLToPath(new URL("../wuchale.config.ts", import.meta.url)),
  });
  return {
    ...plugin,
    async handleHotUpdate(context) {
      if ((await plugin.handleHotUpdate(context)) === false) return [];
    },
    config(config, environment) {
      // Wuchale 0.26 selects build behavior by mode rather than Vite's command.
      return plugin.config(config, {
        mode:
          environment.command === "build" || process.env.VITEST === "true"
            ? "build"
            : environment.mode,
      });
    },
    transform: {
      ...plugin.transform,
      handler(code, id, options) {
        if (options?.ssr) return;
        return plugin.transform.handler(code, id, options);
      },
    },
  };
}
