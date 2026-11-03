import { parse } from "@babel/parser";
import type { HeuristicFunc } from "wuchale";

type Node = { type: string; [key: string]: unknown };
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
const children = (node: Node): Node[] =>
  Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  );

/** Reject unbound generated translation variables before they can reach a client. */
class InvalidTranslationContextError extends Error {}

export function assertTranslationContextBindings(
  source: string,
  language: "tsx" | "js" = "tsx",
): void {
  const generated = new Set(["_w_ctx_", "_w_runtime_"]);
  if (![...generated].some((name) => source.includes(name))) return;
  const visit = (node: Node, bound: ReadonlySet<string>): void => {
    const inScope = new Set(bound);
    const parameters = Array.isArray(node.params) ? node.params : [];
    for (const parameter of parameters) {
      if (
        isNode(parameter) &&
        parameter.type === "Identifier" &&
        typeof parameter.name === "string"
      )
        inScope.add(parameter.name);
    }
    if ((node.type === "Program" || node.type === "BlockStatement") && Array.isArray(node.body)) {
      for (const statement of node.body) {
        if (!isNode(statement) || statement.type !== "VariableDeclaration") continue;
        if (!Array.isArray(statement.declarations)) continue;
        for (const declaration of statement.declarations) {
          if (
            isNode(declaration) &&
            isNode(declaration.id) &&
            declaration.id.type === "Identifier" &&
            typeof declaration.id.name === "string"
          )
            inScope.add(declaration.id.name);
        }
      }
    }
    if (
      node.type === "Identifier" &&
      typeof node.name === "string" &&
      generated.has(node.name) &&
      !inScope.has(node.name)
    ) {
      throw new InvalidTranslationContextError(
        `Unbound generated translation variable: ${node.name}.`,
      );
    }
    for (const child of children(node)) visit(child, inScope);
  };
  const ast: unknown = parse(source, {
    sourceType: "module",
    plugins: language === "tsx" ? ["typescript", "jsx"] : [],
  });
  if (isNode(ast)) visit(ast, new Set());
}

/** Wuchale's text paths omit comparisons and object keys. Protect their strings before extraction. */
export function protectProtocolStrings(source: string, heuristic: HeuristicFunc): HeuristicFunc {
  const protectedStrings = new Set<string>();
  const protect = (node: unknown): void => {
    if (!isNode(node)) return;
    if (node.type === "StringLiteral" && typeof node.value === "string")
      protectedStrings.add(node.value);
    for (const child of children(node)) protect(child);
  };
  const visit = (node: Node): void => {
    if (
      node.type === "BinaryExpression" &&
      ["==", "===", "!=", "!=="].includes(String(node.operator))
    ) {
      protect(node.left);
      protect(node.right);
    }
    if (
      [
        "IfStatement",
        "ConditionalExpression",
        "SwitchCase",
        "WhileStatement",
        "ForStatement",
      ].includes(node.type)
    )
      protect(node.test);
    if (["ObjectProperty", "ObjectMethod", "MemberExpression"].includes(node.type))
      protect(node.key ?? node.property);
    for (const child of children(node)) visit(child);
  };
  const ast: unknown = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  if (isNode(ast)) visit(ast);
  return (text, file) => {
    const body = typeof text.body === "string" ? text.body : text.body.join("\n");
    return protectedStrings.has(body) ? false : heuristic(text, file);
  };
}
