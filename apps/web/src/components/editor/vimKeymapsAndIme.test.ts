import { describe, expect, it } from "vite-plus/test";
import { isCjkImeHijackedEvent, resolvePhysicalVimKey } from "./vimKeymapsAndIme";

describe("vimKeymapsAndIme", () => {
  it("resolves physical key codes for Vim Normal/Visual motions regardless of CJK IME character output", () => {
    expect(
      resolvePhysicalVimKey({
        code: "KeyJ",
        key: "Process",
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe("j");
    expect(
      resolvePhysicalVimKey({
        code: "KeyJ",
        key: "Process",
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe("J");
    expect(
      resolvePhysicalVimKey({
        code: "Semicolon",
        key: "：",
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(":");
    expect(
      resolvePhysicalVimKey({
        code: "Digit4",
        key: "￥",
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe("$");
    expect(
      resolvePhysicalVimKey({
        code: "KeyR",
        key: "Process",
        shiftKey: false,
        ctrlKey: true,
        altKey: false,
        metaKey: false,
      }),
    ).toBe("<C-r>");
    // Leaves OS / app shortcuts with Meta or Alt untouched
    expect(
      resolvePhysicalVimKey({
        code: "KeyV",
        key: "v",
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: true,
      }),
    ).toBeNull();
  });

  it("identifies CJK IME hijacked events while ignoring clean ASCII keystrokes", () => {
    expect(isCjkImeHijackedEvent({ isComposing: true, keyCode: 74, key: "j" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 229, key: "Process" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 186, key: "；" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 54, key: "……" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 189, key: "——" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 192, key: "～" })).toBe(true);
    expect(isCjkImeHijackedEvent({ isComposing: false, keyCode: 74, key: "j" })).toBe(false);
  });
});
