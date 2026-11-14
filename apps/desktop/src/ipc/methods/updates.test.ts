import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { DesktopUpdateActionResultSchema } from "@t3tools/contracts";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as DesktopUpdates from "../../updates/DesktopUpdates.ts";
import { makeHarness } from "../../updates/updatesTestHarness.ts";
import { installUpdate } from "./updates.ts";

describe("installed update IPC", () => {
  it.effect.each([undefined, "1.2.4", "1.2.5"])(
    "restarts only the installed version requested by %s",
    (expectedVersion) => {
      const harness = makeHarness({
        env: { T3CODE_DISABLE_AUTO_UPDATE: "true" },
        installedPlist: () =>
          "<plist><dict><key>CFBundleShortVersionString</key><string>1.2.4</string></dict></plist>",
      });
      const reasons: string[] = [];
      return Effect.scoped(
        Effect.gen(function* () {
          yield* (yield* DesktopUpdates.DesktopUpdates).configure;
          const result = yield* installUpdate
            .handler(expectedVersion)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(DesktopUpdateActionResultSchema)));
          const accepted = expectedVersion !== "1.2.5";
          assert.equal(result.accepted, accepted);
          assert.equal(result.completed, accepted);
          assert.deepEqual(reasons, accepted ? ["installedUpdate=1.2.4"] : []);
          assert.equal(harness.quitAndInstalls(), 0);
          assert.equal(harness.downloadCount(), 0);
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            harness.layer,
            DesktopShutdown.layer,
            Layer.mock(DesktopWindow.DesktopWindow, {}),
            Layer.mock(ElectronApp.ElectronApp, {}),
            Layer.mock(ElectronTheme.ElectronTheme, {}),
            Layer.mock(DesktopLifecycle.DesktopLifecycle, {
              relaunch: (reason) =>
                Effect.sync(() => {
                  reasons.push(reason);
                }),
            }),
          ),
        ),
      );
    },
  );
});
