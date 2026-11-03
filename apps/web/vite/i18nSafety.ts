import { parse } from "@babel/parser";
import type { HeuristicFunc } from "wuchale";

type Node = { type: string; [key: string]: unknown };
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
const children = (node: Node): Node[] =>
  Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  );

/** Reject invalid nested-message output during compilation, before it can reach a client. */
class InvalidTranslationContextError extends Error {}

export function assertTranslationContextBindings(source: string): void {
  if (!source.includes("_w_ctx_")) return;
  const visit = (node: Node, bound: boolean): void => {
    const parameters = Array.isArray(node.params) ? node.params : [];
    const inScope =
      bound ||
      parameters.some(
        (parameter) =>
          isNode(parameter) && parameter.type === "Identifier" && parameter.name === "_w_ctx_",
      );
    if (node.type === "Identifier" && node.name === "_w_ctx_" && !inScope) {
      throw new InvalidTranslationContextError("Unbound generated translation context: _w_ctx_.");
    }
    for (const child of children(node)) visit(child, inScope);
  };
  const ast: unknown = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  if (isNode(ast)) visit(ast, false);
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
