import { describe, expect, it } from "vite-plus/test";

import { mergeSelectionBands, type RawSelectionRect } from "./chatMarkdownSelection";

const proseRect = (left: number, right: number, top: number, bottom: number): RawSelectionRect => ({
  left,
  right,
  top,
  bottom,
  lineLeft: 0,
  lineRight: 520,
  scopeKey: "prose",
});

describe("mergeSelectionBands", () => {
  it("merges inline text and shorter code rects on one line into a single unbroken band", () => {
    const bands = mergeSelectionBands(
      [
        proseRect(48, 120, 10, 30),
        // Inline <code> sits slightly inset vertically and has a 5px horizontal gap from padding.
        proseRect(125, 190, 12, 28),
        proseRect(195, 280, 10, 30),
      ],
      { startsBeforeRoot: false, endsAfterRoot: false, verticalPad: 0 },
    );

    expect(bands).toEqual([
      {
        left: 48,
        top: 10,
        width: 232,
        height: 20,
        radiusTopLeft: 3,
        radiusTopRight: 3,
        radiusBottomRight: 3,
        radiusBottomLeft: 3,
      },
    ]);
  });

  it("extends non-final lines across full row width and closes vertical line seams", () => {
    const bands = mergeSelectionBands(
      [proseRect(80, 210, 0, 20), proseRect(20, 340, 26, 46), proseRect(40, 140, 52, 72)],
      { startsBeforeRoot: false, endsAfterRoot: false, verticalPad: 0 },
    );

    expect(bands).toHaveLength(3);
    // Line 1: starts at exact selection start, extends full right.
    expect(bands[0]).toMatchObject({ left: 80, width: 440, top: 0, height: 23 });
    expect(bands[0]!.radiusBottomRight).toBe(0);
    // Line 2: full left-to-right row, touching line 1 and line 3 seamlessly.
    expect(bands[1]).toMatchObject({ left: 0, width: 520, top: 23, height: 26 });
    expect(bands[1]!.radiusTopRight).toBe(0);
    expect(bands[1]!.radiusBottomLeft).toBe(0);
    // Line 3: starts at 0, ends at exact selection end, touching line 2 with zero gap.
    expect(bands[2]).toMatchObject({ left: 0, width: 140, top: 49, height: 23 });
    expect(bands[2]!.radiusTopLeft).toBe(0);
    expect(bands[2]!.radiusTopRight).toBe(0);
  });

  it("keeps separate table cells clamped to their own column bounds", () => {
    const bands = mergeSelectionBands(
      [
        {
          left: 10,
          right: 90,
          top: 0,
          bottom: 20,
          lineLeft: 0,
          lineRight: 150,
          scopeKey: "cell:0",
        },
        {
          left: 10,
          right: 60,
          top: 24,
          bottom: 44,
          lineLeft: 0,
          lineRight: 150,
          scopeKey: "cell:0",
        },
        {
          left: 170,
          right: 260,
          top: 0,
          bottom: 20,
          lineLeft: 160,
          lineRight: 320,
          scopeKey: "cell:1",
        },
      ],
      { startsBeforeRoot: false, endsAfterRoot: false, verticalPad: 0 },
    );

    const cell0Bands = bands.filter((band) => band.left < 150);
    const cell1Bands = bands.filter((band) => band.left >= 150);
    expect(cell0Bands.every((band) => band.left + band.width <= 150)).toBe(true);
    expect(cell1Bands[0]).toMatchObject({ left: 160, width: 100 });
  });
});
