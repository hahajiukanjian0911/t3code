import type { ClientSettings } from "@t3tools/contracts/settings";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
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

const CJK_FULLWIDTH_PUNCTUATION = /^[；：。「」【】、，？！（）《》“”‘’·—…￥～]+$/;

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

const INSERT_ESCAPE_RHS = /^<(?:esc|c-\[|c-c)>$/i;
const ASCII_INSERT_ESCAPE_LHS = /^[!-~]{2,}$/;

let appliedKeybindingsSignature = "";
let activeInsertEscapeSequences = new Set<string>(["jk"]);

export function extractInsertEscapeSequences(
  rules: ReadonlyArray<VimKeybindingRule>,
): ReadonlySet<string> {
  const sequences = new Set<string>();
  for (const rule of rules) {
    if (
      rule.mode === "insert" &&
      ASCII_INSERT_ESCAPE_LHS.test(rule.lhs) &&
      INSERT_ESCAPE_RHS.test(rule.rhs.trim())
    ) {
      sequences.add(rule.lhs);
    }
  }
  return sequences;
}

const IME_ESCAPE_TRAILING_KEYS = /^[!-~；：]*$/;

function matchImeInsertEscape(
  committed: string,
  sequences: ReadonlySet<string> = activeInsertEscapeSequences,
): { readonly escapeSeq: string; readonly trailingKeys: string } | null {
  if (!committed) return null;
  let matchedSeq: string | null = null;
  for (const seq of sequences) {
    if (committed.startsWith(seq) && (matchedSeq === null || seq.length > matchedSeq.length)) {
      matchedSeq = seq;
    }
  }
  if (matchedSeq === null) return null;
  const rawTrailing = committed.slice(matchedSeq.length);
  if (!IME_ESCAPE_TRAILING_KEYS.test(rawTrailing)) return null;
  const trailingKeys = rawTrailing.replaceAll("；", ";").replaceAll("：", ":");
  return { escapeSeq: matchedSeq, trailingKeys };
}

/**
 * Applies user-configured `vimKeybindings` into `@replit/codemirror-vim` idempotently.
 * `Vim.mapclear()` strips only user-added mappings while preserving built-in defaults.
 */
export function syncVimKeybindings(rules: ReadonlyArray<VimKeybindingRule>): void {
  const signature = JSON.stringify(rules);
  if (signature === appliedKeybindingsSignature) return;
  appliedKeybindingsSignature = signature;
  activeInsertEscapeSequences = new Set(extractInsertEscapeSequences(rules));

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

const setVimImeEditable = StateEffect.define<boolean>();

/** Keep `contenteditable="false"` + `tabindex="0"` in Normal/Visual mode so OS CJK IME popups never activate. */
const vimImeEditableField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (tr.state.readOnly) return false;
    for (const effect of tr.effects) {
      if (effect.is(setVimImeEditable)) return effect.value;
    }
    return value;
  },
  provide: (field) => [
    Prec.high(EditorView.editable.from(field)),
    EditorView.contentAttributes.compute([EditorState.readOnly], (state) =>
      state.readOnly ? {} : { tabindex: "0" },
    ),
  ],
});

function shouldEnableImeEditing(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const vim = getCM(view)?.state.vim;
  return Boolean(vim && (vim.insertMode || vim.expectLiteralNext));
}

function applyVimImeEditable(view: EditorView): void {
  if (!view.dom.isConnected) return;
  const next = shouldEnableImeEditing(view);
  const current = view.state.field(vimImeEditableField, false);
  if (current === undefined || current === next) return;
  const wasFocused = view.hasFocus || document.activeElement === view.contentDOM;
  view.dispatch({ effects: setVimImeEditable.of(next) });
  if (wasFocused && document.activeElement !== view.contentDOM) {
    view.contentDOM.focus({ preventScroll: true });
  }
  // Defensive recovery: if a browser dropped `compositionend` while leaving Insert mode,
  // clear CodeMirror's composing state so subsequent keydowns are never ignored.
  if (!next && view.composing) {
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend"));
  }
}

function syncVimImeEditable(view: EditorView, defer = false): void {
  const next = shouldEnableImeEditing(view);
  const current = view.state.field(vimImeEditableField, false);
  if (current === undefined || current === next) return;
  if (defer) {
    queueMicrotask(() => applyVimImeEditable(view));
    return;
  }
  try {
    applyVimImeEditable(view);
  } catch {
    queueMicrotask(() => applyVimImeEditable(view));
  }
}

const vimImeEditableSyncPlugin = ViewPlugin.fromClass(
  class {
    private cm: ReturnType<typeof getCM> = null;
    private readonly onVimEvent: () => void;
    private pendingImeEscape: { fullText: string; trailingKeys: string } | null = null;
    private readonly onCompositionStart: () => void;
    private readonly onCompositionEnd: (event: CompositionEvent) => void;

    constructor(private readonly view: EditorView) {
      this.onVimEvent = () => syncVimImeEditable(this.view, false);
      this.onCompositionStart = () => {
        this.pendingImeEscape = null;
      };
      this.onCompositionEnd = (event) => {
        const vim = getCM(this.view)?.state.vim;
        if (!vim?.insertMode) return;
        const committed = event.data;
        if (!committed) return;
        const matched = matchImeInsertEscape(committed);
        if (!matched) return;
        this.pendingImeEscape = { fullText: committed, trailingKeys: matched.trailingKeys };
        // Run after CodeMirror's own compositionend microtask observer flush; `update()` also retries when the DOM flush lands later.
        Promise.resolve().then(() => queueMicrotask(() => this.flushPendingImeEscape(false)));
      };
      this.view.contentDOM.addEventListener("compositionstart", this.onCompositionStart);
      this.view.contentDOM.addEventListener("compositionend", this.onCompositionEnd);
      this.attach(true);
    }

    private flushPendingImeEscape(fromDocUpdate: boolean): void {
      const pending = this.pendingImeEscape;
      if (!pending || !this.view.dom.isConnected) return;
      const cm = getCM(this.view);
      const vim = cm?.state.vim;
      if (!cm || !vim?.insertMode) {
        this.pendingImeEscape = null;
        return;
      }
      const { fullText, trailingKeys } = pending;
      const head = this.view.state.selection.main.head;
      if (
        head < fullText.length ||
        this.view.state.sliceDoc(head - fullText.length, head) !== fullText
      ) {
        if (fromDocUpdate) {
          this.pendingImeEscape = null;
        }
        return;
      }
      this.pendingImeEscape = null;
      this.view.dispatch({
        changes: { from: head - fullText.length, to: head, insert: "" },
        selection: { anchor: head - fullText.length },
        userEvent: "delete",
      });
      Vim.multiSelectHandleKey(cm, "<Esc>", "user");
      CodeMirror.signal(cm, "vim-keypress", "<Esc>");
      for (const key of trailingKeys) {
        Vim.multiSelectHandleKey(cm, key, "user");
        CodeMirror.signal(cm, "vim-keypress", key);
      }
      (
        cm.state as { vimPlugin?: { blockCursor?: { scheduleRedraw: () => void } } }
      ).vimPlugin?.blockCursor?.scheduleRedraw();
      syncVimImeEditable(this.view, false);
    }

    private attach(defer: boolean): void {
      const cm = getCM(this.view);
      if (!cm || cm === this.cm) return;
      this.detach();
      this.cm = cm;
      cm.on("vim-mode-change", this.onVimEvent);
      cm.on("vim-keypress", this.onVimEvent);
      cm.on("vim-command-done", this.onVimEvent);
      syncVimImeEditable(this.view, defer);
    }

    private detach(): void {
      if (!this.cm) return;
      this.cm.off("vim-mode-change", this.onVimEvent);
      this.cm.off("vim-keypress", this.onVimEvent);
      this.cm.off("vim-command-done", this.onVimEvent);
      this.cm = null;
    }

    update(update: ViewUpdate): void {
      if (!this.cm) this.attach(true);
      if (update.docChanged && this.pendingImeEscape) {
        queueMicrotask(() => this.flushPendingImeEscape(true));
      }
      syncVimImeEditable(this.view, true);
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener("compositionstart", this.onCompositionStart);
      this.view.contentDOM.removeEventListener("compositionend", this.onCompositionEnd);
      this.detach();
    }
  },
);

/**
 * Zed-style Normal/Visual IME shield: disables `contenteditable` outside Insert/literal-target
 * modes, maps CJK full-width punctuation to physical keys, and preserves plain-text paste.
 */
export const vimNormalModeImeShield = (() => {
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
    vimImeEditableField,
    vimImeEditableSyncPlugin,
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

          event.preventDefault();
          event.stopPropagation();

          const handled = Vim.multiSelectHandleKey(cm, vimKey, "user");
          if (handled) {
            CodeMirror.signal(cm, "vim-keypress", vimKey);
            (
              cm.state as { vimPlugin?: { blockCursor?: { scheduleRedraw: () => void } } }
            ).vimPlugin?.blockCursor?.scheduleRedraw();
          }
          syncVimImeEditable(view);
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
            return true;
          }
          return false;
        },
      }),
    ),
    EditorView.domEventHandlers({
      paste(event, view) {
        if (
          event.defaultPrevented ||
          view.state.readOnly ||
          view.state.facet(EditorView.editable)
        ) {
          return false;
        }
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(text), {
          userEvent: "input.paste",
          scrollIntoView: true,
        });
        return true;
      },
    }),
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
  readonly recordingRegister: string | null;
  readonly notice: string | null;
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

  const dialog = (cm?.state as { dialog?: HTMLElement | null } | undefined)?.dialog;
  const isMessageOnlyDialog = Boolean(dialog && !dialog.querySelector("input"));
  const messageText = isMessageOnlyDialog ? (dialog?.textContent?.trim() ?? "") : "";
  const recordingMatch = /^recording @(.+)$/.exec(messageText);
  const recordingRegister = recordingMatch?.[1] ?? null;
  const notice = recordingRegister ? null : messageText || null;

  return { mode, line, column, pendingKeys, recordingRegister, notice };
}
