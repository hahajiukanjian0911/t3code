import { adapter, jsxDefaultHeuristic } from "@wuchale/jsx";
import { defineConfig, type HeuristicFunc, type Scope } from "wuchale";
import { assertTranslationContextBindings, protectProtocolStrings } from "./vite/i18nSafety.ts";

/** Anonymous effect/event callbacks must never acquire React hooks. */
export function reactiveUiScope(path: Scope[]): boolean | null {
  const index = path.findLastIndex(
    (scope) => scope.type === "function" || scope.type === "funcexpr" || scope.type === "method",
  );
  if (index < 0) return null;
  const scope = path[index];
  let name = scope?.type === "function" ? scope.name : "";
  if (scope?.type === "funcexpr") {
    let parentIndex = index - 1;
    const call = path[parentIndex];
    if (call?.type === "call" && /^(?:React\.)?(?:memo|forwardRef)$/.test(call.name))
      parentIndex -= 1;
    const parent = path[parentIndex];
    if (parent?.type === "assignment" && !parent.left && parent.targets.length === 1) {
      name = parent.targets[0] ?? "";
    }
  }
  return /^(?:[A-Z]|use[A-Z])/.test(name);
}

const textAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "description",
  "ariaLabel",
  "emptyLabel",
  "emptyMessage",
  "emptyText",
  "label",
  "loadingLabel",
  "placeholder",
  "title",
  "tooltip",
]);

const textProperties = new Set([
  "description",
  "emptyMessage",
  "errorMessage",
  "helpText",
  "label",
  "placeholder",
  "subtitle",
  "title",
  "tooltip",
]);

const technicalProperties = new Set([
  "_tag",
  "action",
  "command",
  "driver",
  "id",
  "kind",
  "method",
  "model",
  "name",
  "provider",
  "role",
  "status",
  "type",
  "value",
]);

export const uiMessage: HeuristicFunc = (text, file) => {
  if (text.path.some((scope) => scope.type === "function" && scope.name === "SidebarBrandMark"))
    return false;
  if (text.path.some((scope) => scope.type === "element" && scope.name === "svg")) return false;
  if (!jsxDefaultHeuristic(text, file)) return false;
  // React runtimes are initialized inside functions, never for module-level JSX constants.
  if (
    !text.path.some(
      (scope) => scope.type === "function" || scope.type === "funcexpr" || scope.type === "class",
    )
  )
    return false;
  if (file === "src/i18n/staticUiLabels.ts") return "message";

  const property = text.path.findLast((scope) => scope.type === "property");
  if (property?.type === "property" && technicalProperties.has(property.name)) return false;
  if (property?.type === "property" && textProperties.has(property.name)) return "message";

  if (
    text.path.some(
      (scope) => scope.type === "call" && /^(toast|toastManager|notify)(\.|$)/.test(scope.name),
    )
  ) {
    return "message";
  }

  if (
    text.path.some(
      (scope) =>
        scope.type === "assignment" &&
        !scope.left &&
        scope.targets.some((target) =>
          /(?:Label|Title|Description|Message|Placeholder)$/.test(target),
        ),
    )
  )
    return "message";

  const nearest = text.path.findLast((scope) => scope.type !== "expression");
  if (nearest?.type === "element") return "message";

  const attribute = text.path.findLast((scope) => scope.type === "attribute");
  if (attribute?.type === "attribute") {
    return textAttributes.has(attribute.name) ? "message" : false;
  }
  if (text.path.at(-1)?.type === "element") return "message";
  if (text.path.at(-1)?.type === "call") return false;

  const fn = text.path.findLast((scope) => scope.type === "function");
  return fn?.type === "function" && /(?:Label|Title|Description|Message|Placeholder)$/.test(fn.name)
    ? "message"
    : false;
};

const mainOptions = {
  loader: "react" as const,
  files: {
    include: ["src/**/*.tsx", "src/i18n/staticUiLabels.ts"],
    ignore: ["**/*.test.*", "**/*.browser.test.*", "src/locales/**"],
  },
  heuristic: uiMessage,
  runtime: {
    initReactive: reactiveUiScope,
    useReactive: (path: Scope[]) => reactiveUiScope(path) === true,
  },
};
const main = adapter(mainOptions);
main.transform = async (context) => {
  const result = await adapter({
    ...mainOptions,
    heuristic: protectProtocolStrings(context.content, uiMessage),
  }).transform(context);
  return {
    ...result,
    output(header) {
      const output = result.output(header);
      try {
        assertTranslationContextBindings(output.code ?? "");
      } catch (cause) {
        throw new Error(`${context.filename}: invalid generated translation context.`, { cause });
      }
      return output;
    },
  };
};

export default defineConfig({
  locales: ["en", "zh-CN"],
  fallback: { "zh-CN": "en" },
  ai: null,
  adapters: {
    main,
  },
});
