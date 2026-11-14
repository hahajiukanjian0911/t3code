import { describe, expect, it } from "vite-plus/test";
import { parseLocalUpdate } from "./localUpdate.ts";

const installedPath = "/Applications/T3 Code (Beta).app";
const offer = {
  version: "0.1.9-fork.20261115.1",
  commit: "a".repeat(40),
  installedPath,
  stagedPath: "/Applications/.T3-Code-update-0.1.9-fork.20261115.1.app",
  backupPath: "/tmp/release/rollback/old.app",
  installerPath: "/tmp/release/install.py",
  asarSha256: "b".repeat(64),
  previousAsarSha256: "c".repeat(64),
  phase: "prepared",
};
describe("local fork offers", () => {
  it.each([
    [{}, true],
    [{ phase: "failed" }, false],
    [{ phase: "swapping" }, false],
    [{ version: "0.1.8-fork.20261114.1" }, false],
    [{ version: "invalid" }, false],
    [{ commit: "unpublished" }, false],
    [{ asarSha256: "invalid" }, false],
    [{ installedPath: "/Applications/Other.app" }, false],
    [{ stagedPath: installedPath }, false],
    [{ stagedPath: "/tmp/.T3-Code-update-new.app" }, false],
    [{ installerPath: "relative.py" }, false],
  ])("validates a prepared offer %j", (overrides, accepted) => {
    expect(
      Boolean(
        parseLocalUpdate(
          JSON.stringify({ ...offer, ...overrides }),
          installedPath,
          "0.1.8-fork.20261114.1",
        ),
      ),
    ).toBe(accepted);
  });
  it("ignores incomplete metadata", () => {
    expect(parseLocalUpdate("{", installedPath, "0.1.8")).toBeUndefined();
    expect(parseLocalUpdate("{}", installedPath, "0.1.8")).toBeUndefined();
  });
});
