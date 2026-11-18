import { describe, expect, it } from "vite-plus/test";
import {
  advanceWorkspaceMaximizeInApp,
  createWorkspaceLayout,
  moveWorkspaceWindow,
  restoreWorkspaceLayout,
  toggleWorkspaceMaximizeInPanel,
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
      groupWeights: { main: 1.4 },
      panelZoomedGroup: { right: "right" },
      maximized: { windowId: "surface:1:diff", stage: "companion" as const },
      sizes: { left: 280, right: 390, bottom: 260, companion: 310 },
      floating: { x: 80, y: 40, width: 420, height: 300 },
    };
    expect(restoreWorkspaceLayout(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(
      restoreWorkspaceLayout({ ...saved, dismissed: ["route", "chat:active", "file"] }).dismissed,
    ).toEqual(["file"]);
    expect(
      restoreWorkspaceLayout({
        sizes: { left: -10, right: "wide", bottom: Infinity, companion: -5 },
        floating: { x: -500, height: null },
        maximized: { windowId: "threads", stage: "full" },
      }).sizes,
    ).toEqual({ left: 246, right: 280, bottom: 152, companion: 220 });
    expect(
      restoreWorkspaceLayout({
        maximized: { windowId: "threads", stage: "full" },
      }).maximized,
    ).toBeNull();
  });

  it("enforces progressive 2-stage app maximize for non-chat windows and forbids sidebar maximize", () => {
    expect(advanceWorkspaceMaximizeInApp(null, "threads")).toBeNull();
    // Main chat goes straight to full and back
    const chatStep1 = advanceWorkspaceMaximizeInApp(null, "chat:test");
    expect(chatStep1).toEqual({ windowId: "chat:test", stage: "full" });
    expect(advanceWorkspaceMaximizeInApp(chatStep1, "chat:test")).toBeNull();

    // Non-chat window: Stage 1 (companion chat in left slot) -> Stage 2 (true full app) -> Tile
    const nonChat1 = advanceWorkspaceMaximizeInApp(null, "surface:test:file");
    expect(nonChat1).toEqual({ windowId: "surface:test:file", stage: "companion" });
    const nonChat2 = advanceWorkspaceMaximizeInApp(nonChat1, "surface:test:file");
    expect(nonChat2).toEqual({ windowId: "surface:test:file", stage: "full" });
    expect(advanceWorkspaceMaximizeInApp(nonChat2, "surface:test:file")).toBeNull();

    // Panel-level monocle toggle
    let layout = createWorkspaceLayout();
    layout = toggleWorkspaceMaximizeInPanel(layout, "right", "right:split:b");
    expect(layout.panelZoomedGroup.right).toBe("right:split:b");
    layout = toggleWorkspaceMaximizeInPanel(layout, "right", "right:split:b");
    expect(layout.panelZoomedGroup.right).toBeUndefined();
  });
});
