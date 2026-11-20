import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ScopedThreadRef,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const SCRATCH_ROOT = "/home/user/.t3/scratch";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  folder: "",
  pullRequests: [] as unknown[],
  configLoaded: true,
  isRepo: false,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "project",
          environmentId: "environment",
          title: state.workspaceRoot === SCRATCH_ROOT ? "No project" : "plain",
          workspaceRoot: state.workspaceRoot,
          scripts: [],
        }) as never,
  useProjects: (() => []) as never,
  useQuietThreadShell: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "thread",
          environmentId: "environment",
          projectId: "project",
          worktreePath: state.folder,
          branch: null,
          pullRequests: state.pullRequests,
        }) as never,
  useServerConfigs: (() =>
    new Map(
      state.configLoaded
        ? [
            [
              EnvironmentId.make("environment"),
              {
                scratchWorkspaceRoot: SCRATCH_ROOT,
                environment: { capabilities: { pullRequests: true } },
              },
            ],
          ]
        : [],
    )) as never,
}));
vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const status = (isRepo: boolean) =>
    Atom.make(
      AsyncResult.success({
        isRepo,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: isRepo ? "main" : null,
        hasWorkingTreeChanges: isRepo,
        workingTree: {
          files: isRepo ? [{ path: "apps/web/src/App.tsx", insertions: 12, deletions: 3 }] : [],
          insertions: isRepo ? 12 : 0,
          deletions: isRepo ? 3 : 0,
        },
        hasUpstream: false,
        aheadCount: isRepo ? 2 : 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      }),
    );
  const notARepo = status(false);
  const repo = status(true);
  return {
    ...actual,
    vcsEnvironment: {
      ...actual.vcsEnvironment,
      status: (() => (state.isRepo ? repo : notARepo)) as never,
    },
  };
});
vi.mock(import("~/state/review"), async (importOriginal) => {
  const actual = await importOriginal();
  const commitsAtom = Atom.make(
    AsyncResult.success({
      commits: [
        {
          sha: "c99ca5431a000000000000000000000000000000",
          subject: "Refine details panel layout",
          committedAt: new Date().toISOString(),
          refs: ["main", "origin/main"],
        },
      ],
      truncated: false,
      totalCount: 215,
    }),
  );
  return {
    ...actual,
    reviewEnvironment: {
      ...actual.reviewEnvironment,
      branchCommits: (() => commitsAtom) as never,
    },
  };
});
vi.mock(import("~/state/filesystem"), async (importOriginal) => ({
  ...(await importOriginal()),
  useFilesystemReadAccess: (() => true) as never,
}));

import { render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { PopoverCreateHandle } from "../ui/popover";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout } from "./chatCanvasLayout";
import { ThreadDetailsPanel } from "./ThreadDetailsPanel";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const container = { width: 1200, height: 800 };
const placement = { x: 908, y: 0, right: 12, width: 280, height: 400 } as const;
const linkedPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "pingdotgg/t3code",
  number: 27513,
  url: "https://github.com/pingdotgg/t3code/pull/27513",
  source: "manual",
  linkedAt: "2026-10-30T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

function setup(input: {
  workspaceRoot: string;
  folder: string;
  pullRequests?: ThreadPullRequestLink[];
  configLoaded?: boolean;
}) {
  state.configLoaded = input.configLoaded ?? true;
  state.isRepo = false;
  state.workspaceRoot = input.workspaceRoot;
  state.folder = input.folder;
  state.pullRequests = input.pullRequests ?? [];
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  const anchor = document.createElement("div");
  document.body.append(anchor);
  return {
    anchor: { current: anchor },
    handle: PopoverCreateHandle(),
    [Symbol.dispose]: () => anchor.remove(),
  };
}

function Panel({
  fixture,
  isRepo = false,
}: {
  fixture: ReturnType<typeof setup>;
  isRepo?: boolean;
}) {
  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;
  return (
    <ChatCanvasContext
      value={{
        container,
        lane: { padding: 48, minChatWidth: 640 },
        layout: resolveChatCanvasLayout({ container, preview: null }),
        previewKey: null,
        registerTimeline: noop,
        measureDetailsCard: noop,
        detailsCardTopInset: 0,
        preferredDetailsCard: placement,
        detailsCardPlacement: placement,
      }}
    >
      <ThreadDetailsPanel
        anchor={fixture.anchor}
        handle={fixture.handle}
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        projectId={ProjectId.make("project")}
        composerDraftTarget={threadRef}
        worktreePath={state.folder}
        isServerThread
        activeProjectName={state.workspaceRoot === SCRATCH_ROOT ? "No project" : "plain"}
        activeProjectScripts={undefined}
        preferredScriptId={null}
        keybindings={[]}
        availableEditors={[]}
        showOpenInPicker={false}
        openInShortcutEnabled={false}
        gitCwd={state.folder}
        workspaceMutationId={null}
        isGitRepo={isRepo}
        envLocked
        availableEnvironments={[]}
        onEnvModeChange={noop}
        envMode="local"
        startFromOrigin={false}
        onStartFromOriginChange={noop}
        onComposerFocusRequest={noop}
        onRunProjectScript={noop}
        onAddProjectScript={scriptResult}
        onUpdateProjectScript={scriptResult}
        onDeleteProjectScript={scriptResult}
        usage={{} as never}
      />
    </ChatCanvasContext>
  );
}

it("offers no git controls in a No project thread, but shows its linked pull request", async () => {
  using fixture = setup({
    workspaceRoot: SCRATCH_ROOT,
    folder: `${SCRATCH_ROOT}/thread`,
    pullRequests: [linkedPullRequest],
  });
  await using _screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByText("#27513")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Initialize Git" }))
    .not.toBeInTheDocument();
});

it("shows linked pull requests in a plain folder and a collapsed git summary card once it is a repository", async () => {
  using fixture = setup({
    workspaceRoot: "/work/plain",
    folder: "/work/plain",
    pullRequests: [linkedPullRequest],
  });
  await using screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByRole("region", { name: "Workspace" })).toBeVisible();
  await expect.element(page.getByText("#27513")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Initialize Git" }))
    .not.toBeInTheDocument();
  state.isRepo = true;
  await screen.rerender(<Panel fixture={fixture} isRepo />);
  // Default collapsed state shows branch, commit count, and change summary without recent commits.
  const branchButton = page.getByRole("combobox", { name: "Branch: main" });
  await expect.element(branchButton).toBeVisible();
  const branchLabel = branchButton.element().querySelector<HTMLElement>("span.truncate")!;
  expect(branchLabel.textContent).toBe("main");
  expect(branchLabel.scrollWidth).toBeLessThanOrEqual(branchLabel.clientWidth);
  const commitsToggle = page.getByRole("button", { name: /215 commits/i });
  await expect.element(commitsToggle).toBeVisible();
  await expect.element(page.getByText("1 file changed")).toBeVisible();
  await expect.element(page.getByText("+12")).toBeVisible();
  await expect.element(page.getByText("-3")).toBeVisible();
  await expect.element(page.getByText("Refine details panel layout")).not.toBeInTheDocument();
  await expect.element(page.getByRole("group", { name: "Git actions" })).not.toBeInTheDocument();

  // Clicking expands changed files and recent commits in place.
  await commitsToggle.click();
  await expect.element(page.getByText("App.tsx")).toBeVisible();
  await expect.element(page.getByText("Refine details panel layout")).toBeVisible();
});

it("offers no Initialize Git before the server config says where No project lives", async () => {
  using fixture = setup({
    workspaceRoot: SCRATCH_ROOT,
    folder: `${SCRATCH_ROOT}/thread`,
    configLoaded: false,
  });
  await using _screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByRole("region", { name: "Workspace" })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Initialize Git" }))
    .not.toBeInTheDocument();
});
