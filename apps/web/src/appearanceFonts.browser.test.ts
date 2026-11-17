import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { applyAppearanceFontVariables } from "./appearanceFonts";

function renderedFontSize(
  style: (probe: HTMLElement) => void,
  property: "fontSize" | "fontFamily" = "fontSize",
  selector?: string,
): string {
  const probe = document.createElement("div");
  style(probe);
  document.body.append(probe);
  try {
    return getComputedStyle(selector ? probe.querySelector(selector)! : probe)[property];
  } finally {
    probe.remove();
  }
}

const composerFontSize = () =>
  renderedFontSize((probe) => {
    // The composer editor's own size class.
    probe.className = "composer-tiptap text-(length:--font-size-prompt,var(--text-sm))";
  });

const touchComposerFontSize = () =>
  renderedFontSize((probe) => {
    probe.style.fontSize = "var(--font-size-prompt-touch)";
  });

const composerFontFamily = () =>
  renderedFontSize((probe) => {
    probe.className = "composer-tiptap font-(family-name:--font-composer,var(--font-sans))";
  }, "fontFamily");

describe("applyAppearanceFontVariables", () => {
  it("keeps conversation and prompt sizes independent from interface controls", () => {
    const root = document.documentElement;
    const style = root.getAttribute("style");
    const preferences = {
      sans: "serif",
      code: "",
      composer: "monospace",
      sizeInterface: 14,
      sizeChat: 18,
      sizePrompt: null,
      sizeCode: 13,
      smoothing: true,
    };
    try {
      applyAppearanceFontVariables(root, { ...preferences, separate: false });
      expect(composerFontSize()).toBe("18px");
      expect(
        renderedFontSize((probe) => {
          probe.className = "text-sm";
        }),
      ).toBe("14px");
      for (const sidebarRow of ["shelf:settled", "settled:more"]) {
        expect(
          renderedFontSize((probe) => {
            probe.dataset.sidebarRow = sidebarRow;
          }),
        ).toBe("14px");
        expect(
          renderedFontSize((probe) => {
            probe.dataset.sidebarRow = sidebarRow;
          }, "fontFamily"),
        ).toContain("serif");
      }
      expect(
        renderedFontSize((probe) => {
          probe.className = "chat-markdown";
        }),
      ).toBe("18px");
      expect(
        renderedFontSize((probe) => {
          probe.dataset.userMessageBubble = "";
        }),
      ).toBe("18px");
      expect(composerFontFamily()).toContain("serif");
      expect(
        renderedFontSize(
          (probe) => {
            probe.className = "chat-markdown";
            probe.innerHTML = "<table><tbody><tr><td>Message</td></tr></tbody></table>";
          },
          "fontSize",
          "table",
        ),
      ).toBe("18px");
      expect(touchComposerFontSize()).toBe("18px");

      applyAppearanceFontVariables(root, { ...preferences, sizeInterface: 20, separate: false });
      expect(composerFontSize()).toBe("18px");
      expect(
        renderedFontSize((probe) => {
          probe.className = "chat-markdown";
        }),
      ).toBe("18px");

      applyAppearanceFontVariables(root, { ...preferences, separate: true });
      expect(composerFontSize()).toBe("18px");
      applyAppearanceFontVariables(root, { ...preferences, sizePrompt: 14, separate: true });
      expect(composerFontSize()).toBe("14px");
      expect(composerFontFamily()).toMatch(/^monospace/);
      // iOS zooms into inputs under 16px.
      expect(touchComposerFontSize()).toBe("16px");
    } finally {
      if (style === null) root.removeAttribute("style");
      else root.setAttribute("style", style);
    }
  });

  it("widens the numbered-list gutter only when the interface font's marker would clip", () => {
    const root = document.documentElement;
    const style = root.getAttribute("style");
    const gutter = (sans: string) => {
      applyAppearanceFontVariables(root, {
        sans,
        code: "",
        composer: "",
        sizeInterface: 14,
        sizeChat: 14,
        sizePrompt: 14,
        sizeCode: 13,
        smoothing: true,
        separate: false,
      });
      const markdown = document.createElement("div");
      markdown.className = "chat-markdown";
      markdown.style.fontSize = "14px";
      const list = document.createElement("ol");
      markdown.append(list);
      document.body.append(markdown);
      try {
        return Number.parseFloat(getComputedStyle(list).paddingInlineStart);
      } finally {
        markdown.remove();
      }
    };
    try {
      // `0. ` in a 14px monospace font is about 25px, past the 20px default.
      expect(gutter("monospace")).toBeGreaterThan(24);
      expect(gutter("sans-serif")).toBe(20);
    } finally {
      if (style === null) root.removeAttribute("style");
      else root.setAttribute("style", style);
    }
  });
});
