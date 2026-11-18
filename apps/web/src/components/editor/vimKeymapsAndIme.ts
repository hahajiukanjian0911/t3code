import type { ClientSettings } from "@t3tools/contracts/settings";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CodeMirror, Vim, getCM } from "@replit/codemirror-vim";
import { listContinuationForEnter } from "~/composer-list-continuation";

export type VimKeybindingRule = ClientSettings["vimKeybindings"][number];

const VIM_CONTEXT_BY_MODE: Readonly<Record<VimKeybindingRule["mode"], string>> = {
  normal: "normal",
  insert: "insert",
  visual: "visual",
  operator: "operatorPending",
};

const SHIFTED_DIGITS: Readonly<Record<string, string>> = {
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
};

const CODE_PUNCTUATION: Readonly<Record<string, readonly [plain: string, shifted: string]>> = {
  Backquote: ["`", "~"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
};

const CJK_FULLWIDTH_PUNCTUATION = /^[；：。「」【】、，？！（）《》“”‘’·—…￥]$/;

/**
 * Translates a physical `KeyboardEvent.code` into the ASCII key string Vim expects
 * when a CJK input method intercepts keystrokes in Normal/Visual mode (Zed-style).
 */
export function resolvePhysicalVimKey(event: {
  readonly code: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): string | null {
  if (event.metaKey || event.altKey) return null;
  const { code, shiftKey, ctrlKey } = event;

  let base: string | null = null;
  if (code.startsWith("Key") && code.length === 4) {
    const letter = code.slice(3);
    base = shiftKey ? letter.toUpperCase() : letter.toLowerCase();
  } else if (code.startsWith("Digit") && code.length === 6) {
    const digit = code.slice(5);
    base = shiftKey ? (SHIFTED_DIGITS[digit] ?? digit) : digit;
  } else if (code in CODE_PUNCTUATION) {
    const pair = CODE_PUNCTUATION[code]!;
    base = shiftKey ? pair[1] : pair[0];
  } else if (code === "Space") {
    base = " ";
  } else if (code === "Escape") {
    return "<Esc>";
  } else if (code === "Backspace") {
    return "<BS>";
  } else if (code === "Enter") {
    return "<CR>";
  }

  if (base === null) return null;
  if (ctrlKey && /^[a-zA-Z[\]\\^_]$/.test(base)) {
    return `<C-${base.toLowerCase()}>`;
  }
  return base;
}

export function isCjkImeHijackedEvent(event: {
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly key: string;
}): boolean {
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === "Process" ||
    event.key === "Unidentified" ||
    CJK_FULLWIDTH_PUNCTUATION.test(event.key)
  );
}

let appliedKeybindingsSignature = "";

/**
 * Applies user-configured `vimKeybindings` into `@replit/codemirror-vim` idempotently.
 * `Vim.mapclear()` strips only user-added mappings while preserving built-in defaults.
 */
export function syncVimKeybindings(rules: ReadonlyArray<VimKeybindingRule>): void {
  const signature = JSON.stringify(rules);
  if (signature === appliedKeybindingsSignature) return;
  appliedKeybindingsSignature = signature;

  Vim.setOption("insertModeEscKeysTimeout", 400);
  Vim.mapclear();
  for (const rule of rules) {
    const lhs = rule.lhs;
    const rhs = rule.rhs;
    if (!lhs || !rhs) continue;
    const context = VIM_CONTEXT_BY_MODE[rule.mode];
    if (rule.noremap === false) {
      Vim.map(lhs, rhs, context);
    } else {
      Vim.noremap(lhs, rhs, context);
    }
  }
}

let listContinuationInstalled = false;

/**
 * Teaches `@replit/codemirror-vim`'s `o` / `O` (`newLineAndEnterInsertMode`) to continue
 * Markdown ordered, bullet, and task lists (`1.`, `-`, `- [ ]`) inside Markdown editors.
 */
export function ensureVimMarkdownListContinuation(): void {
  if (listContinuationInstalled) return;
  listContinuationInstalled = true;

  const commands = (
    CodeMirror as unknown as {
      commands: {
        newlineAndIndent: (cm: { cm6: EditorView }) => void;
        newlineAndIndentContinueComment?: (cm: { cm6: EditorView }) => void;
      };
    }
  ).commands;

  commands.newlineAndIndentContinueComment = (cm) => {
    const view = cm.cm6;
    if (view.dom.closest("[data-composer-markdown='true']")) {
      const text = view.state.doc.toString();
      const head = view.state.selection.main.head;
      const edit = listContinuationForEnter(text, head);
      if (edit && edit.replacement.startsWith("\n")) {
        view.dispatch({
          changes: { from: edit.start, to: edit.end, insert: edit.replacement },
          selection: { anchor: edit.cursorAfter },
          scrollIntoView: true,
          userEvent: "input",
        });
        return;
      }
    }
    commands.newlineAndIndent(cm);
  };
}

function abortActiveImeComposition(view: EditorView): void {
  const content = view.contentDOM;
  if (document.activeElement !== content) return;
  const selection = view.state.selection;
  content.blur();
  content.focus({ preventScroll: true });
  // Restore CodeMirror's exact selection if the native blur/focus shifted DOM ranges.
  if (!view.state.selection.eq(selection)) {
    view.dispatch({ selection });
  }
}

/**
 * Normal/Visual mode CJK IME shield: intercepts `keyCode === 229` / composition / full-width
 * punctuation and forwards physical `KeyboardEvent.code` to Vim while leaving Insert mode native.
 */
export const vimNormalModeImeShield = (() => {
  const composingBeforeBypass = new WeakMap<EditorView, { docText: string; head: number }>();

  const shouldBypassIme = (view: EditorView): boolean => {
    const cm = getCM(view);
    const vim = cm?.state.vim;
    if (!cm || !vim) return false;
    if (vim.insertMode) return false;
    // Allow CJK characters for single-character target commands like `f`, `F`, `t`, `T`, `r`.
    if (vim.expectLiteralNext) return false;
    return true;
  };

  return [
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (event.target instanceof HTMLElement && event.target.closest(".cm-vim-panel")) {
            return false;
          }
          if (!shouldBypassIme(view)) return false;
          if (!isCjkImeHijackedEvent(event)) return false;

          const vimKey = resolvePhysicalVimKey(event);
          if (!vimKey) return false;

          const cm = getCM(view);
          if (!cm) return false;

          composingBeforeBypass.set(view, {
            docText: view.state.doc.toString(),
            head: view.state.selection.main.head,
          });

          event.preventDefault();
          event.stopPropagation();

          Vim.handleKey(cm, vimKey, "user");

          abortActiveImeComposition(view);
          return true;
        },
        beforeinput(event, view) {
          if (!shouldBypassIme(view)) return false;
          if (
            event.inputType === "insertCompositionText" ||
            event.inputType === "insertFromComposition" ||
            (event.inputType === "insertText" &&
              typeof event.data === "string" &&
              CJK_FULLWIDTH_PUNCTUATION.test(event.data))
          ) {
            event.preventDefault();
            abortActiveImeComposition(view);
            return true;
          }
          return false;
        },
        compositionstart(_event, view) {
          if (!shouldBypassIme(view)) return false;
          abortActiveImeComposition(view);
          return true;
        },
        compositionend(_event, view) {
          const snapshot = composingBeforeBypass.get(view);
          if (!snapshot) return false;
          composingBeforeBypass.delete(view);
          return false;
        },
      }),
    ),
    Prec.highest(
      EditorView.inputHandler.of((view, _from, _to, text) => {
        if (!shouldBypassIme(view)) return false;
        // Block stray IME pre-edit or full-width punctuation from mutating the buffer in Normal mode.
        if (CJK_FULLWIDTH_PUNCTUATION.test(text)) {
          return true;
        }
        return false;
      }),
    ),
  ];
})();

export interface VimTelemetrySnapshot {
  readonly mode: "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "replace";
  readonly line: number;
  readonly column: number;
  readonly pendingKeys: string;
}

export function readVimTelemetry(view: EditorView): VimTelemetrySnapshot {
  const cm = getCM(view);
  const vim = cm?.state.vim;
  const head = view.state.selection.main.head;
  const docLine = view.state.doc.lineAt(head);
  const line = docLine.number;
  const column = head - docLine.from + 1;

  let mode: VimTelemetrySnapshot["mode"] = "normal";
  if (vim?.insertMode) {
    mode = (cm?.state as { overwrite?: boolean } | undefined)?.overwrite ? "replace" : "insert";
  } else if (vim?.visualMode) {
    mode = vim.visualLine ? "visual-line" : vim.visualBlock ? "visual-block" : "visual";
  }

  const inputState = vim?.inputState;
  const prefix = inputState?.prefixRepeat?.join("") ?? "";
  const op = inputState?.operator ?? "";
  const motionRepeat = inputState?.motionRepeat?.join("") ?? "";
  const keyBuf = inputState?.keyBuffer?.join("") ?? "";
  const pendingKeys = `${prefix}${op}${motionRepeat}${keyBuf}`.slice(0, 8);

  return { mode, line, column, pendingKeys };
}
