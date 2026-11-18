import { css } from "@codemirror/lang-css";
import { useId, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { CodeMirrorSurface } from "../editor/CodeMirrorSurface";
import { Button } from "../ui/button";

const cssExtension = css();

export function ThemeCssEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  const vimEnabled = useClientSettings((settings) => settings.vimMode);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [tabIndents, setTabIndents] = useState(true);
  const [vimMode, setVimMode] = useState("normal");

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-input bg-code text-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-inset focus-within:ring-ring/24">
        <CodeMirrorSurface
          ariaLabel="Custom CSS"
          ariaDescribedBy={hintId}
          value={value}
          onChange={onChange}
          languageExtension={cssExtension}
          vimEnabled={vimEnabled}
          tabIndents={tabIndents}
          onFocus={() => setTabIndents(true)}
          onPositionChange={setPosition}
          onVimModeChange={setVimMode}
          onEscapeTabTrap={() => setTabIndents(false)}
          className="block h-52 w-full font-mono text-xs leading-5"
        />
        <div className="flex items-center justify-between border-t border-input px-3 py-1 font-mono text-xs">
          <span className="inline-flex items-center gap-2">
            <span>CSS</span>
            {vimEnabled ? (
              <span className="rounded bg-muted px-1.5 py-0.25 text-2xs font-semibold uppercase text-muted-foreground">
                {vimMode}
              </span>
            ) : null}
          </span>
          <span>
            Ln {position.line}, Col {position.column}
          </span>
        </div>
      </div>
      <div className="flex items-start justify-between gap-2">
        <p id={hintId} className="text-xs text-muted-foreground">
          {vimEnabled
            ? "Vim mode active. Escape returns to Normal mode."
            : tabIndents
              ? "Tab indents. Shift+Tab unindents. Press Escape, then Tab to leave."
              : "Tab moves to the next control."}
        </p>
        <Button
          size="xs"
          variant="ghost"
          disabled={!value}
          onClick={() => {
            onChange("");
            setPosition({ line: 1, column: 1 });
          }}
        >
          Clear CSS
        </Button>
      </div>
    </div>
  );
}
