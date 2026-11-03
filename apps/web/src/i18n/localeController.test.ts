import { expect, it, vi } from "vite-plus/test";

import { createLocaleController } from "./localeController";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

it("serializes catalog loads and commits only the latest requested locale", async () => {
  const started = gate();
  const finish = gate();
  const load = vi.fn(async (locale: string) => {
    if (locale === "zh-CN") {
      started.release();
      await finish.promise;
    }
  });
  const commit = vi.fn();
  const apply = createLocaleController({ load, commit });
  const chinese = apply("zh-CN");
  await started.promise;
  const english = apply("en");
  expect(load).toHaveBeenCalledTimes(1);
  finish.release();
  await Promise.all([chinese, english]);
  expect(load.mock.calls).toEqual([["zh-CN"], ["en"]]);
  expect(commit.mock.calls).toEqual([["en"]]);
});

it("allows the next language change after a catalog fails to load", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const commit = vi.fn();
  const apply = createLocaleController({ load, commit });
  await expect(apply("zh-CN")).rejects.toThrow("offline");
  await apply("en");
  expect(commit.mock.calls).toEqual([["en"]]);
});
