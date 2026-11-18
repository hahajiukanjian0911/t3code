import type { ClientSettings } from "@t3tools/contracts/settings";
import { useState } from "react";
import { Button } from "../ui/button";

type VimKeybindingRule = ClientSettings["vimKeybindings"][number];

const VALID_MODES = new Set(["normal", "insert", "visual", "operator"]);

function parseVimKeybindingsJson(
  raw: string,
):
  | { readonly ok: true; readonly rules: VimKeybindingRule[] }
  | { readonly ok: false; readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of keybinding objects." };
  }
  const rules: VimKeybindingRule[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: `Entry ${i + 1} must be an object.` };
    }
    const { mode, lhs, rhs, noremap } = item as Record<string, unknown>;
    if (typeof mode !== "string" || !VALID_MODES.has(mode)) {
      return {
        ok: false,
        error: `Entry ${i + 1}: "mode" must be "normal", "insert", "visual", or "operator".`,
      };
    }
    if (typeof lhs !== "string" || lhs.length === 0) {
      return { ok: false, error: `Entry ${i + 1}: "lhs" must be a non-empty string.` };
    }
    if (typeof rhs !== "string" || rhs.length === 0) {
      return { ok: false, error: `Entry ${i + 1}: "rhs" must be a non-empty string.` };
    }
    if (noremap !== undefined && typeof noremap !== "boolean") {
      return { ok: false, error: `Entry ${i + 1}: "noremap" must be a boolean when provided.` };
    }
    rules.push({
      mode: mode as VimKeybindingRule["mode"],
      lhs,
      rhs,
      ...(noremap === undefined ? {} : { noremap }),
    });
  }
  return { ok: true, rules };
}

export function VimKeybindingsEditor({
  value,
  onChange,
}: {
  value: ReadonlyArray<VimKeybindingRule>;
  onChange: (rules: ReadonlyArray<VimKeybindingRule>) => void;
}) {
  const canonical = JSON.stringify(value, null, 2);
  const [draftState, setDraftState] = useState<{
    canonical: string;
    text: string;
    error: string | null;
  }>({
    canonical,
    text: canonical,
    error: null,
  });

  const text = draftState.canonical === canonical ? draftState.text : canonical;
  const error = draftState.canonical === canonical ? draftState.error : null;

  return (
    <div className="w-full space-y-2 pt-1">
      <textarea
        aria-label="Custom Vim keybindings JSON"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          const result = parseVimKeybindingsJson(nextText);
          if (result.ok) {
            setDraftState({
              canonical: JSON.stringify(result.rules, null, 2),
              text: nextText,
              error: null,
            });
            onChange(result.rules);
          } else {
            setDraftState({ canonical, text: nextText, error: result.error });
          }
        }}
        rows={6}
        className="w-full resize-y rounded-lg border border-input bg-code px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-inset focus:ring-ring/24"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        {error ? (
          <span className="text-error-foreground">{error}</span>
        ) : (
          <span className="text-muted-foreground">
            {value.length} active Vim mappings (<code className="font-mono">normal</code>,{" "}
            <code className="font-mono">insert</code>, <code className="font-mono">visual</code>,{" "}
            <code className="font-mono">operator</code>)
          </span>
        )}
        {text !== canonical ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDraftState({ canonical, text: canonical, error: null })}
          >
            Format JSON
          </Button>
        ) : null}
      </div>
    </div>
  );
}
