import { describe, expect, it } from "vite-plus/test";
import {
  advanceWorkspaceMaximizeInApp,
  createWorkspaceLayout,
  moveWorkspaceWindow,
  readWorkspaceRightPanel,
  rememberWorkspaceChatRightPanel,
  restoreWorkspaceChatRightPanel,
  restoreWorkspaceLayout,
  toggleWorkspaceMaximizeInPanel,
  workspaceGroups,
} from "./workspaceLayout";

describe("workspace window ownership", () => {
  it("carries forward legacy right panel state only for its identified conversation", () => {
    const legacy = restoreWorkspaceLayout({
      placements: {
        "surface:env-a:thread:file:same": { panel: "right", group: "right" },
        "surface:env-b:thread:file:same": { panel: "right", group: "right" },
      },
      active: { right: "surface:env-a:thread:file:same", main: "route" },
      hidden: { right: true, left: true },
      sizes: { left: 300, right: 390, rightContentShare: 0.62 },
      chatRightPanels: {
        "chat:env-b:thread": { width: "invalid", contentShare: 0.8 },
      },
    });
    const fallback = readWorkspaceRightPanel(legacy);
    const a = restoreWorkspaceChatRightPanel(legacy, "chat:env-a:thread", fallback);
    expect(a.sizes).toEqual({ left: 300, right: 390, rightContentShare: 0.62 });
    expect(a.hidden.right).toBe(true);
    const b = restoreWorkspaceChatRightPanel(a, "chat:env-b:thread", fallback);
    expect(b.sizes).toEqual({ left: 300, right: 280, rightContentShare: 0.75 });
    expect(b.hidden).toEqual({ left: true });
    expect(b.active).toEqual({ main: "route" });
    const adjusted = rememberWorkspaceChatRightPanel(
      b,
      { ...b, sizes: { ...b.sizes, right: 335 } },
      "chat:env-b:thread",
    );
    const saved = restoreWorkspaceLayout(JSON.parse(JSON.stringify(adjusted)));
    expect(restoreWorkspaceChatRightPanel(saved, "chat:env-b:thread", fallback).sizes.right).toBe(
      335,
    );
    expect(restoreWorkspaceChatRightPanel(saved, "chat:env-a:thread", fallback).sizes.right).toBe(
      390,
    );
  });

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
        legacyBottom: { panel: "bottom", group: "bottom" },
      },
    });
    layout.active.main = "removed";
    expect(workspaceGroups(layout, [{ id: "a", available: true }], "main")[0]?.active).toBe("a");
    expect(layout.placements).toEqual({
      a: { panel: "main", group: "main" },
      legacyBottom: { panel: "right", group: "right" },
    });
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
      maximized: { windowId: "surface:1:diff", stage: "full" as const },
      sizes: { left: 280, right: 390, rightContentShare: 0.55 },
      floating: { x: 80, y: 40, width: 420, height: 300 },
    };
    expect(
      restoreWorkspaceLayout({ ...saved, sizes: { ...saved.sizes, bottom: 260, companion: 310 } }),
    ).toEqual(saved);
    expect(
      restoreWorkspaceLayout({ ...saved, dismissed: ["route", "chat:active", "file"] }).dismissed,
    ).toEqual(["file"]);
    expect(
      restoreWorkspaceLayout({
        sizes: {
          left: -10,
          right: "wide",
          rightContentShare: 9,
          bottom: Infinity,
          companion: -5,
        },
        floating: { x: -500, height: null },
        maximized: { windowId: "threads", stage: "full" },
      }).sizes,
    ).toEqual({ left: 246, right: 280, rightContentShare: 0.75 });
    expect(
      restoreWorkspaceLayout({
        maximized: { windowId: "threads", stage: "full" },
      }).maximized,
    ).toBeNull();
    expect(
      restoreWorkspaceLayout({
        maximized: { windowId: "details:env:thread", stage: "full" },
      }).maximized,
    ).toBeNull();
    expect(
      restoreWorkspaceLayout({
        maximized: { windowId: "surface:1:diff", stage: "companion" },
      }).maximized,
    ).toBeNull();
  });

  it("toggles single-stage full app maximize for chat and tool windows while forbidding sidebar and inspector maximize", () => {
    expect(advanceWorkspaceMaximizeInApp(null, "threads")).toBeNull();
    expect(advanceWorkspaceMaximizeInApp(null, "details:env:thread")).toBeNull();

    const chatStep1 = advanceWorkspaceMaximizeInApp(null, "chat:test");
    expect(chatStep1).toEqual({ windowId: "chat:test", stage: "full" });
    expect(advanceWorkspaceMaximizeInApp(chatStep1, "chat:test")).toBeNull();

    const nonChat1 = advanceWorkspaceMaximizeInApp(null, "surface:test:file");
    expect(nonChat1).toEqual({ windowId: "surface:test:file", stage: "full" });
    expect(advanceWorkspaceMaximizeInApp(nonChat1, "surface:test:file")).toBeNull();

    // Panel-level monocle toggle
    let layout = createWorkspaceLayout();
    layout = toggleWorkspaceMaximizeInPanel(layout, "right", "right:split:b");
    expect(layout.panelZoomedGroup.right).toBe("right:split:b");
    layout = toggleWorkspaceMaximizeInPanel(layout, "right", "right:split:b");
    expect(layout.panelZoomedGroup.right).toBeUndefined();
  });
});
