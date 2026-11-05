import { describe, expect, it } from "vite-plus/test";

import { pickWorkspacePathMatch, workspaceFileLookupQuery } from "./workspaceBasenameLookup.ts";

describe("workspace path lookup", () => {
  it("keeps explicit paths out of abbreviated-path lookup", () => {
    for (const path of [
      "/tmp/file.md",
      "C:\\docs\\file.md",
      "~/file.md",
      "./file.md",
      "../file.md",
      "docs/../file.md",
      "docs/",
      "",
    ]) {
      expect(workspaceFileLookupQuery(path, "/repo")).toBeNull();
    }
    expect(workspaceFileLookupQuery("docs/file.md", "/repo")).toBe("docs/file.md");
    expect(workspaceFileLookupQuery("physics/docs/file.md", "/school/physics")).toBe(
      "docs/file.md",
    );
    expect(workspaceFileLookupQuery("a".repeat(257), "/repo")).toBeNull();
  });

  it("requires a unique complete suffix match at a path boundary", () => {
    const entries = [
      { path: "shared/skills/example/SKILL.md", kind: "file" as const },
      { path: "shared/skills/not-example/SKILL.md", kind: "file" as const },
      { path: "other/example/SKILL.md", kind: "directory" as const },
    ];
    expect(pickWorkspacePathMatch("example/SKILL.md", "/repo", { entries, truncated: false })).toBe(
      entries[0]!.path,
    );
    expect(
      pickWorkspacePathMatch("example/SKILL.md", "/repo", { entries, truncated: true }),
    ).toBeNull();
    expect(
      pickWorkspacePathMatch("example/SKILL.md", "/repo", {
        entries: [...entries, { path: "second/example/SKILL.md", kind: "file" }],
        truncated: false,
      }),
    ).toBeNull();
    expect(
      pickWorkspacePathMatch("example/SKILL.md", "/repo", { entries: [], truncated: false }),
    ).toBeNull();
    expect(
      pickWorkspacePathMatch("example/SKILL.md", "/repo", {
        entries: [...entries, { path: "example/SKILL.md", kind: "file" }],
        truncated: true,
      }),
    ).toBe("example/SKILL.md");
  });

  it("uses the environment's path casing and separators", () => {
    const result = {
      entries: [{ path: "shared\\资料\\Note.md", kind: "file" as const }],
      truncated: false,
    };
    expect(workspaceFileLookupQuery("资料\\note.md", "C:\\repo")).toBe("资料/note.md");
    expect(pickWorkspacePathMatch("资料/note.md", "C:\\repo", result)).toBe(
      result.entries[0]!.path,
    );
    expect(pickWorkspacePathMatch("资料/note.md", "/repo", result)).toBeNull();
  });
});
