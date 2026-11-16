import { describe, expect, it } from "vite-plus/test";
import {
  createWorkspaceLayout,
  moveWorkspaceWindow,
  restoreWorkspaceLayout,
  workspaceGroups,
} from "./workspaceLayout";

describe("workspace window ownership", () => {
  it("moves and splits windows without duplicating ownership, then merges them back", () => {
    let layout = createWorkspaceLayout();
    layout = moveWorkspaceWindow(layout, "chat", { panel: "main", group: "main" });
    layout = moveWorkspaceWindow(layout, "file", { panel: "right", group: "right" });
    layout = moveWorkspaceWindow(layout, "file", { panel: "main", group: "main" }, "right");
    const windows = [
      { id: "chat", available: true },
      { id: "file", available: true },
    ];
    expect(workspaceGroups(layout, windows, "right")).toEqual([]);
    expect(workspaceGroups(layout, windows, "main")).toHaveLength(2);
    layout = moveWorkspaceWindow(layout, "file", { panel: "main", group: "main" }, "left");
    expect(workspaceGroups(layout, windows, "main").map((group) => group.windows)).toEqual([
      ["file"],
      ["chat"],
    ]);
    layout = moveWorkspaceWindow(layout, "file", { panel: "main", group: "main" }, "top");
    expect(layout.vertical.main).toBe(true);
    expect(workspaceGroups(layout, windows, "main").map((group) => group.windows)).toEqual([
      ["file"],
      ["chat"],
    ]);
    layout = moveWorkspaceWindow(layout, "file", { panel: "main", group: "main" });
    expect(workspaceGroups(layout, windows, "main")).toEqual([
      { id: "main", windows: ["chat", "file"], active: "file" },
    ]);
    layout = { ...layout, dismissed: ["file"], hidden: { floating: true } };
    layout = moveWorkspaceWindow(layout, "file", { panel: "floating", group: "floating" });
    expect(layout.hidden.floating).toBe(false);
    expect(layout.dismissed).toEqual([]);
    expect(workspaceGroups(layout, windows, "floating")[0]?.windows).toEqual(["file"]);
  });
  it("falls back from closed selections and rejects malformed saved placements", () => {
    const layout = restoreWorkspaceLayout({
      placements: {
        a: { panel: "main", group: "main" },
        b: { panel: "unknown", group: "x" },
        c: null,
      },
    });
    layout.active.main = "removed";
    expect(workspaceGroups(layout, [{ id: "a", available: true }], "main")[0]?.active).toBe("a");
    expect(Object.keys(layout.placements)).toEqual(["a"]);
    expect(workspaceGroups(layout, [{ id: "a", available: false }], "main")).toEqual([]);
    expect(restoreWorkspaceLayout(null)).toEqual(createWorkspaceLayout());
    const saved = {
      ...layout,
      order: ["main"],
      hidden: { right: true },
      vertical: { main: true },
      dismissed: ["closed"],
      sizes: { left: 280, right: 390, bottom: 260 },
      floating: { x: 80, y: 40, width: 420, height: 300 },
    };
    expect(restoreWorkspaceLayout(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(
      restoreWorkspaceLayout({
        sizes: { left: -10, right: "wide", bottom: Infinity },
        floating: { x: -500, height: null },
      }).sizes,
    ).toEqual({ left: 180, right: 320, bottom: 220 });
  });
});
