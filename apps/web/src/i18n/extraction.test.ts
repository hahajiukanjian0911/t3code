import { expect, it } from "vite-plus/test";
import { IndexTracker } from "wuchale";

import config, { reactiveUiScope } from "../../wuchale.config";

const transformUi = config.adapters!.main!.transform!;

it("extracts UI copy while preserving protocol values, comparisons, keys and user content", async () => {
  const source = `
    const badge = <span>Static badge</span>;
    function SidebarBrandMark() { return <span>Code</span>; }
    export function Example({ content, status }) {
      const noticeTitle = status === "Some" ? "Connected" : "Disconnected";
      const options = { "Connect": true, type: "Failure", title: "Choose device" };
      switch (status) { case "Ready": break; }
      useEffect(() => { toastManager.add({ title: "Connection failed" }); }, []);
      return <div data-state="Pending"><span>{status === "Idle" ? "Ready to start" : "Working"}</span><p>{content}</p><pre>Keep code unchanged</pre><svg><text>Code</text></svg></div>;
    }
  `;
  const result = await transformUi({
    content: source,
    filename: "src/Example.tsx",
    index: new IndexTracker(true),
    expr: { plain: "getRuntime()", reactive: "useRuntime()" },
    matchUrl: () => null,
  });
  const texts = result.txts.map((text) => text.body);
  expect(texts).toEqual(
    expect.arrayContaining([
      "Connected",
      "Disconnected",
      "Choose device",
      "Connection failed",
      "Ready to start",
      "Working",
    ]),
  );
  for (const value of [
    "Some",
    "Connect",
    "Failure",
    "Ready",
    "Pending",
    "Idle",
    "Static badge",
    "Keep code unchanged",
    "Code",
  ])
    expect(texts).not.toContain(value);
  const output = result.output("").code!;
  expect(output).toContain('status === "Some"');
  expect(output).toContain('"Connect": true');
  expect(output).toContain('case "Ready"');
  expect(output).toContain("{content}");
  expect(output.match(/useRuntime\(\)/g)).toHaveLength(1);
});

it("emits bound translations for mixed JSX with conditional siblings", async () => {
  for (const [source, label] of [
    [
      'export function Files({enabled, selected, total}) { return <section title="Changed files">{enabled && <input/>}<span>Files</span>{selected && <span>{selected} of {total}</span>}</section> }',
      "Files",
    ],
    [
      'export function Units() { return <Label title="Changed files">Unit<Select><SelectTrigger/><SelectPopup><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem></SelectPopup></Select></Label> }',
      "Minutes",
    ],
  ]) {
    const result = await transformUi({
      content: source!,
      filename: "src/Files.tsx",
      index: new IndexTracker(true),
      expr: { plain: "getRuntime()", reactive: "useRuntime()" },
      matchUrl: () => null,
    });
    expect(result.txts.map((text) => text.body)).toContain("Changed files");
    const output = result.output("").code!;
    expect(result.txts.map((text) => text.body)).toContain(label);
    expect(output).not.toContain(`>${label}</`);
  }
});

it("acquires React hooks in components and memo components, and uses plain runtimes in callbacks", () => {
  expect(reactiveUiScope([{ type: "function", name: "SettingsPanel" }])).toBe(true);
  expect(
    reactiveUiScope([
      { type: "function", name: "SettingsPanel" },
      { type: "call", kind: "function", name: "useEffect" },
      { type: "funcexpr", kind: "arrow" },
    ]),
  ).toBe(false);
  expect(
    reactiveUiScope([
      { type: "assignment", left: false, targets: ["Row"] },
      { type: "call", kind: "function", name: "memo" },
      { type: "funcexpr", kind: "function" },
    ]),
  ).toBe(true);
  expect(reactiveUiScope([])).toBe(null);
});
