import { describe, expect, it } from "vite-plus/test";
import { resolveWindowDisplaySpace } from "./DesktopWallpaper.ts";

describe("resolveWindowDisplaySpace", () => {
  it("computes window offset relative to the display with the largest overlap", () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1200 } },
      { bounds: { x: 0, y: 1200, width: 1920, height: 1080 } },
    ];
    expect(
      resolveWindowDisplaySpace({ x: 140, y: 80, width: 1100, height: 720 }, displays),
    ).toEqual({
      offsetX: 140,
      offsetY: 80,
      displayWidth: 1920,
      displayHeight: 1200,
      displayKey: "0,0,1920x1200",
    });
    expect(
      resolveWindowDisplaySpace({ x: 220, y: 1320, width: 970, height: 610 }, displays),
    ).toEqual({
      offsetX: 220,
      offsetY: 120,
      displayWidth: 1920,
      displayHeight: 1080,
      displayKey: "0,1200,1920x1080",
    });
  });

  it("falls back cleanly when no displays are reported", () => {
    expect(resolveWindowDisplaySpace({ x: 30, y: 40, width: 960, height: 600 }, [])).toEqual({
      offsetX: 30,
      offsetY: 40,
      displayWidth: 1440,
      displayHeight: 900,
      displayKey: "0,0,1440x900",
    });
  });
});
