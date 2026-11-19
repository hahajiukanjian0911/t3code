import { collectComposerPromptInlineTokens } from "~/composer-editor-mentions";

export interface EditorImageAliasBinding {
  readonly alias: string;
  readonly contextId: string;
  readonly canonicalSource: string;
}

export interface EditorImageEncoding {
  readonly displayText: string;
  readonly aliasToBinding: ReadonlyMap<string, EditorImageAliasBinding>;
  readonly contextIdToAlias: ReadonlyMap<string, string>;
  readonly mapCanonicalToDisplay: (offset: number) => number;
  readonly mapDisplayToCanonical: (offset: number) => number;
}

interface OffsetSpan {
  readonly canonicalStart: number;
  readonly canonicalEnd: number;
  readonly displayStart: number;
  readonly displayEnd: number;
}

const IMAGE_ALIAS_PATTERN = /\[image (\d+)\]/g;

/**
 * Rewrites canonical inline image context links (`![name](t3-context://v1/image/<id>)`) into
 * short literal `[image N]` tokens for the CodeMirror buffer so Vim editing, cursor columns,
 * and plain-text copies never expose raw `t3-context://` URLs.
 */
type InlineToken = ReturnType<typeof collectComposerPromptInlineTokens>[number];
type ImageContextInlineToken = Extract<InlineToken, { type: "context-reference" }>;

function isImageContextInlineToken(token: InlineToken): token is ImageContextInlineToken {
  return token.type === "context-reference" && token.kind === "image";
}

function collectLiteralAliasSet(
  canonical: string,
  tokens: ReadonlyArray<ImageContextInlineToken>,
): Set<string> {
  const literals = new Set<string>();
  let cursor = 0;
  for (const token of tokens) {
    const chunk = canonical.slice(cursor, token.start);
    if (chunk.includes("[image ")) {
      for (const match of chunk.matchAll(IMAGE_ALIAS_PATTERN)) {
        literals.add(match[0]);
      }
    }
    cursor = token.end;
  }
  const tail = canonical.slice(cursor);
  if (tail.includes("[image ")) {
    for (const match of tail.matchAll(IMAGE_ALIAS_PATTERN)) {
      literals.add(match[0]);
    }
  }
  return literals;
}

export function encodeEditorImageTokens(
  canonical: string,
  existingAliases?: ReadonlyMap<string, EditorImageAliasBinding>,
): EditorImageEncoding {
  const tokens = collectComposerPromptInlineTokens(canonical).filter(isImageContextInlineToken);
  if (tokens.length === 0) {
    return {
      displayText: canonical,
      aliasToBinding: new Map(existingAliases),
      contextIdToAlias: new Map(
        existingAliases
          ? Array.from(existingAliases.values(), (binding) => [binding.contextId, binding.alias])
          : [],
      ),
      mapCanonicalToDisplay: (offset) => Math.max(0, Math.min(canonical.length, offset)),
      mapDisplayToCanonical: (offset) => Math.max(0, Math.min(canonical.length, offset)),
    };
  }

  const aliasToBinding = new Map<string, EditorImageAliasBinding>(existingAliases);
  const contextIdToAlias = new Map<string, string>();
  for (const [alias, binding] of aliasToBinding) {
    if (!contextIdToAlias.has(binding.contextId)) {
      contextIdToAlias.set(binding.contextId, alias);
    }
  }
  const reservedLiterals = collectLiteralAliasSet(canonical, tokens);
  const spans: OffsetSpan[] = [];
  let nextIndex = 1;
  let canonicalCursor = 0;
  let displayText = "";

  for (const token of tokens) {
    displayText += canonical.slice(canonicalCursor, token.start);
    let alias = contextIdToAlias.get(token.contextId);
    if (!alias) {
      while (
        aliasToBinding.has(`[image ${nextIndex}]`) ||
        reservedLiterals.has(`[image ${nextIndex}]`)
      ) {
        nextIndex += 1;
      }
      alias = `[image ${nextIndex++}]`;
      contextIdToAlias.set(token.contextId, alias);
      aliasToBinding.set(alias, {
        alias,
        contextId: token.contextId,
        canonicalSource: token.source,
      });
    } else if (!aliasToBinding.has(alias)) {
      aliasToBinding.set(alias, {
        alias,
        contextId: token.contextId,
        canonicalSource: token.source,
      });
    }
    const displayStart = displayText.length;
    displayText += alias;
    const displayEnd = displayText.length;
    spans.push({
      canonicalStart: token.start,
      canonicalEnd: token.end,
      displayStart,
      displayEnd,
    });
    canonicalCursor = token.end;
  }
  displayText += canonical.slice(canonicalCursor);

  const mapCanonicalToDisplay = (rawOffset: number): number => {
    const offset = Math.max(0, Math.min(canonical.length, rawOffset));
    let delta = 0;
    for (const span of spans) {
      if (offset <= span.canonicalStart) {
        return offset + delta;
      }
      if (offset < span.canonicalEnd) {
        return span.displayStart;
      }
      delta += span.displayEnd - span.displayStart - (span.canonicalEnd - span.canonicalStart);
    }
    return offset + delta;
  };

  const mapDisplayToCanonical = (rawOffset: number): number => {
    const offset = Math.max(0, Math.min(displayText.length, rawOffset));
    let delta = 0;
    for (const span of spans) {
      if (offset <= span.displayStart) {
        return offset + delta;
      }
      if (offset < span.displayEnd) {
        return span.canonicalStart;
      }
      delta += span.canonicalEnd - span.canonicalStart - (span.displayEnd - span.displayStart);
    }
    return offset + delta;
  };

  return {
    displayText,
    aliasToBinding,
    contextIdToAlias,
    mapCanonicalToDisplay,
    mapDisplayToCanonical,
  };
}

export interface EditorImageDecoding {
  readonly canonicalText: string;
  readonly mapDisplayToCanonical: (offset: number) => number;
}

/**
 * Expands known `[image N]` aliases back into their canonical `t3-context://v1/image/...`
 * references when reporting buffer changes out of CodeMirror.
 */
export function decodeEditorImageTokens(
  displayText: string,
  aliasToBinding: ReadonlyMap<string, EditorImageAliasBinding>,
): EditorImageDecoding {
  if (aliasToBinding.size === 0 || !displayText.includes("[image ")) {
    return {
      canonicalText: displayText,
      mapDisplayToCanonical: (offset) => Math.max(0, Math.min(displayText.length, offset)),
    };
  }

  const spans: OffsetSpan[] = [];
  let cursor = 0;
  let canonicalText = "";
  for (const match of displayText.matchAll(IMAGE_ALIAS_PATTERN)) {
    const alias = match[0];
    const binding = aliasToBinding.get(alias);
    if (!binding || match.index === undefined) continue;
    const displayStart = match.index;
    const displayEnd = displayStart + alias.length;
    canonicalText += displayText.slice(cursor, displayStart);
    const canonicalStart = canonicalText.length;
    canonicalText += binding.canonicalSource;
    const canonicalEnd = canonicalText.length;
    spans.push({ canonicalStart, canonicalEnd, displayStart, displayEnd });
    cursor = displayEnd;
  }
  canonicalText += displayText.slice(cursor);

  const mapDisplayToCanonical = (rawOffset: number): number => {
    const offset = Math.max(0, Math.min(displayText.length, rawOffset));
    let delta = 0;
    for (const span of spans) {
      if (offset <= span.displayStart) {
        return offset + delta;
      }
      if (offset < span.displayEnd) {
        return span.canonicalStart;
      }
      delta += span.canonicalEnd - span.canonicalStart - (span.displayEnd - span.displayStart);
    }
    return offset + delta;
  };

  return { canonicalText, mapDisplayToCanonical };
}

export interface EditorImageAliasMatch {
  readonly start: number;
  readonly end: number;
  readonly alias: string;
  readonly binding: EditorImageAliasBinding;
}

export function collectEditorImageAliases(
  displayText: string,
  aliasToBinding: ReadonlyMap<string, EditorImageAliasBinding>,
): EditorImageAliasMatch[] {
  if (aliasToBinding.size === 0 || !displayText.includes("[image ")) return [];
  const matches: EditorImageAliasMatch[] = [];
  for (const match of displayText.matchAll(IMAGE_ALIAS_PATTERN)) {
    const alias = match[0];
    const binding = aliasToBinding.get(alias);
    if (!binding || match.index === undefined) continue;
    matches.push({
      start: match.index,
      end: match.index + alias.length,
      alias,
      binding,
    });
  }
  return matches;
}

export function nextAvailableImageAlias(
  existingAliases: ReadonlyMap<string, EditorImageAliasBinding>,
  existingText = "",
): string {
  let index = 1;
  while (
    existingAliases.has(`[image ${index}]`) ||
    (existingText.length > 0 && existingText.includes(`[image ${index}]`))
  ) {
    index += 1;
  }
  return `[image ${index}]`;
}
