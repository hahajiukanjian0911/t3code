import { useAtomMount } from "@effect/atom-react";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { selectThreadBranchBaseRef, useDiffPanelStore } from "../../diffPanelStore";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { reviewEnvironment } from "../../state/review";
import { revisionedQuery } from "../../state/revisionedQuery";
import { vcsEnvironment, vcsStatusRevalidation } from "../../state/vcs";
import { resolveBranchToolbarPrBranch, type EnvMode } from "../BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "../BranchToolbarBranchSelector";
import { resolveChangesTotals } from "../GitActionsControl.logic";
import { resolveDisplayedThreadPr } from "../ThreadStatusIndicators";
import { ThreadDetailsIssueRows } from "./ThreadDetailsIssueRows";
import { ThreadDetailsThreadPrRows } from "./ThreadDetailsPrRows";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { THREAD_DETAILS_PANEL_SURFACE_CARD_CLASS } from "./threadDetailsPanelStyles";

const VISIBLE_CHANGED_FILES_LIMIT = 6;
const VISIBLE_RECENT_COMMITS_LIMIT = 5;

function fileBasename(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function formatCommitRelativeTime(isoTimestamp: string, locale: string): string {
  const parsedMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsedMs)) return "";
  const deltaSeconds = Math.round((parsedMs - Date.now()) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (absSeconds < 60) return formatter.format(deltaSeconds, "second");
  if (absSeconds < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (absSeconds < 86_400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (absSeconds < 2_592_000) return formatter.format(Math.round(deltaSeconds / 86_400), "day");
  if (absSeconds < 31_536_000)
    return formatter.format(Math.round(deltaSeconds / 2_592_000), "month");
  return formatter.format(Math.round(deltaSeconds / 31_536_000), "year");
}

interface ThreadDetailsGitSummaryCardProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly isServerThread: boolean;
  readonly draftId?: DraftId;
  readonly gitCwd: string;
  readonly workspaceMutationId: string | null;
  readonly envLocked: boolean;
  readonly envMode: EnvMode;
  readonly forceNewWorktree?: boolean;
  readonly activeThreadBranchOverride?: string | null;
  readonly onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  readonly startFromOrigin: boolean;
  readonly onStartFromOriginChange: (startFromOrigin: boolean) => void;
  readonly onCheckoutPullRequestRequest?: (reference: string) => void;
  readonly onComposerFocusRequest: () => void;
  readonly onOpenChanges?: () => void;
  readonly showBranch: boolean;
  readonly showChanges: boolean;
}

export function ThreadDetailsGitSummaryCard(props: ThreadDetailsGitSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const locale = useClientSettings((settings) => settings.uiLocale);
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    props.draftId ? store.getDraftSession(props.draftId) : store.getDraftThreadByRef(threadRef),
  );
  const canReadFiles = useFilesystemReadAccess(props.environmentId);

  useAtomMount(
    vcsStatusRevalidation({
      environmentId: props.environmentId,
      cwd: props.gitCwd,
    }),
  );
  const vcsStatusQuery = useEnvironmentQuery(
    revisionedQuery(
      vcsEnvironment.status({
        environmentId: props.environmentId,
        input: { cwd: props.gitCwd },
      }),
      props.workspaceMutationId,
    ),
  );
  const gitStatus = vcsStatusQuery.data ?? null;

  const branchCommitsQuery = useEnvironmentQuery(
    canReadFiles
      ? revisionedQuery(
          reviewEnvironment.branchCommits({
            environmentId: props.environmentId,
            input: {
              cwd: props.gitCwd,
              includeHistory: true,
              limit: VISIBLE_RECENT_COMMITS_LIMIT,
            },
          }),
          props.workspaceMutationId,
        )
      : null,
  );

  const selectedChangesBaseRef = useDiffPanelStore((state) =>
    selectThreadBranchBaseRef(state, threadRef),
  );
  const changesBaseDiffPreview = useEnvironmentQuery(
    props.showChanges && canReadFiles && selectedChangesBaseRef
      ? revisionedQuery(
          reviewEnvironment.diffPreview({
            environmentId: props.environmentId,
            input: {
              cwd: props.gitCwd,
              baseRef: selectedChangesBaseRef,
              sourceKind: "branch-range",
              metadataOnly: true,
            },
          }),
          props.workspaceMutationId,
        )
      : null,
  );
  const selectedChangesSource = changesBaseDiffPreview.data?.sources.find(
    (source) => source.kind === "branch-range",
  );
  const changesTotals = resolveChangesTotals(
    gitStatus,
    selectedChangesBaseRef ? (selectedChangesSource ?? null) : null,
  ) ?? { insertions: 0, deletions: 0, baseRef: null, breakdown: null };

  const workingTreeFiles = gitStatus?.workingTree.files ?? [];
  const dirtyFileCount = workingTreeFiles.length;
  const hasDiffStats = changesTotals.insertions > 0 || changesTotals.deletions > 0;
  const isDirty = dirtyFileCount > 0 || gitStatus?.hasWorkingTreeChanges === true;
  const aheadCount = gitStatus?.aheadCount ?? 0;
  const behindCount = gitStatus?.behindCount ?? 0;
  const totalCommits = branchCommitsQuery.data?.totalCount;
  const recentCommits = branchCommitsQuery.data?.commits ?? [];

  const activeThreadBranch =
    props.activeThreadBranchOverride !== undefined
      ? props.activeThreadBranchOverride
      : (serverThread?.branch ?? draftThread?.branch ?? null);
  const branchPrBranch = resolveBranchToolbarPrBranch({
    activeThreadBranch,
    resolvedActiveBranch:
      props.envMode === "worktree" && props.worktreePath === null
        ? null
        : (activeThreadBranch ?? gitStatus?.refName ?? null),
  });
  const branchPr = resolveDisplayedThreadPr({
    threadBranch: branchPrBranch,
    gitStatus,
  });
  const linkedIssues = serverThread?.issues ?? [];

  const syncPill =
    aheadCount > 0 || behindCount > 0 ? (
      <span className="shrink-0 font-mono text-2xs font-medium tabular-nums text-muted-foreground">
        {aheadCount > 0 ? `↑${aheadCount}` : ""}
        {aheadCount > 0 && behindCount > 0 ? " " : ""}
        {behindCount > 0 ? `↓${behindCount}` : ""}
      </span>
    ) : null;

  const commitCountLabel =
    totalCommits !== undefined ? (
      totalCommits === 1 ? (
        <>1 commit</>
      ) : (
        <>{totalCommits.toLocaleString(locale)} commits</>
      )
    ) : (
      <>Commits</>
    );

  const openWorkingTreeDiff = () => {
    if (!props.onOpenChanges) return;
    useDiffPanelStore.getState().selectGitScope(threadRef, "unstaged");
    props.onOpenChanges();
  };

  const openCommitDiff = (sha: string) => {
    if (!props.onOpenChanges) return;
    useDiffPanelStore.getState().selectCommit(threadRef, sha);
    props.onOpenChanges();
  };

  const visibleFiles = workingTreeFiles.slice(0, VISIBLE_CHANGED_FILES_LIMIT);
  const remainingFileCount = Math.max(0, workingTreeFiles.length - visibleFiles.length);

  return (
    <div className="flex flex-col gap-1.5" data-thread-details-git-summary="">
      <div className={cn(THREAD_DETAILS_PANEL_SURFACE_CARD_CLASS, "px-2.5 py-2")}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {props.showBranch ? (
              <BranchToolbarBranchSelector
                displayMode="summary"
                summaryTrailing={syncPill}
                environmentId={props.environmentId}
                threadId={props.threadId}
                {...(props.draftId ? { draftId: props.draftId } : {})}
                envLocked={props.envLocked}
                effectiveEnvModeOverride={props.envMode}
                forceNewWorktree={props.forceNewWorktree ?? false}
                {...(props.activeThreadBranchOverride !== undefined
                  ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
                  : {})}
                {...(props.onActiveThreadBranchOverrideChange
                  ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
                  : {})}
                startFromOrigin={props.startFromOrigin}
                onStartFromOriginChange={props.onStartFromOriginChange}
                {...(props.onCheckoutPullRequestRequest
                  ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
                  : {})}
                onComposerFocusRequest={props.onComposerFocusRequest}
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-semibold text-foreground">
                  {gitStatus?.refName ?? "HEAD"}
                </span>
                {syncPill}
              </div>
            )}
          </div>

          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border/75 bg-muted/45 px-2 text-2xs font-medium tabular-nums text-foreground/80 outline-none transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          >
            <span>{commitCountLabel}</span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3 text-muted-foreground transition-transform duration-150",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>

        {props.showChanges ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="mt-1.5 flex w-full cursor-pointer items-center justify-between gap-2 border-t border-border/55 pt-1.5 text-left text-xs outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate tabular-nums text-muted-foreground">
              {dirtyFileCount > 0 ? (
                dirtyFileCount === 1 ? (
                  <>1 file changed</>
                ) : (
                  <>{dirtyFileCount} files changed</>
                )
              ) : isDirty || hasDiffStats ? (
                <>Changes</>
              ) : (
                <>Working tree clean</>
              )}
            </span>
            {isDirty || hasDiffStats ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-2xs font-medium tabular-nums">
                <span
                  className={
                    changesTotals.insertions > 0
                      ? "text-diff-addition-foreground"
                      : "text-muted-foreground"
                  }
                >
                  +{formatDiffCount(changesTotals.insertions)}
                </span>
                <span
                  className={
                    changesTotals.deletions > 0
                      ? "text-diff-deletion-foreground"
                      : "text-muted-foreground"
                  }
                >
                  -{formatDiffCount(changesTotals.deletions)}
                </span>
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-success-foreground">
                <CheckIcon aria-hidden className="size-3" />
                Clean
              </span>
            )}
          </button>
        ) : null}

        {expanded ? (
          <div className="mt-2 space-y-2 border-t border-border/55 pt-2">
            {visibleFiles.length > 0 ? (
              <div className="space-y-0.5">
                {visibleFiles.map((file) => (
                  <Tooltip key={file.path}>
                    <TooltipTrigger
                      delay={300}
                      render={
                        <button
                          type="button"
                          disabled={!props.onOpenChanges}
                          onClick={openWorkingTreeDiff}
                          className="flex h-6 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 text-left text-xs text-foreground/90 outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default dark:hover:bg-white/[0.06]"
                        />
                      }
                    >
                      <span className="min-w-0 truncate">{fileBasename(file.path)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs tabular-nums">
                        {file.insertions > 0 ? (
                          <span className="text-diff-addition-foreground">
                            +{formatDiffCount(file.insertions)}
                          </span>
                        ) : null}
                        {file.deletions > 0 ? (
                          <span className="text-diff-deletion-foreground">
                            -{formatDiffCount(file.deletions)}
                          </span>
                        ) : null}
                      </span>
                    </TooltipTrigger>
                    <TooltipPopup side="left">{file.path}</TooltipPopup>
                  </Tooltip>
                ))}
                {remainingFileCount > 0 ? (
                  <button
                    type="button"
                    disabled={!props.onOpenChanges}
                    onClick={openWorkingTreeDiff}
                    className="flex h-6 w-full cursor-pointer items-center rounded-md px-1.5 text-left text-2xs font-medium text-muted-foreground outline-none transition-colors hover:bg-black/[0.04] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.06]"
                  >
                    +{remainingFileCount} more files
                  </button>
                ) : null}
              </div>
            ) : null}

            {recentCommits.length > 0 ? (
              <div className="space-y-0.5">
                <div className="px-1 text-2xs font-medium text-muted-foreground">
                  Recent commits
                </div>
                {recentCommits.map((commit, index) => {
                  const shortSha = commit.sha.slice(0, 7);
                  const relativeTime = formatCommitRelativeTime(commit.committedAt, locale);
                  const refs = commit.refs?.slice(0, 2) ?? [];
                  return (
                    <button
                      key={commit.sha}
                      type="button"
                      disabled={!props.onOpenChanges}
                      onClick={() => openCommitDiff(commit.sha)}
                      className="flex w-full cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default dark:hover:bg-white/[0.06]"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          index === 0
                            ? "bg-primary ring-2 ring-primary/20"
                            : "bg-muted-foreground/55",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium leading-snug text-foreground/90">
                          {commit.subject}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs tabular-nums text-muted-foreground">
                          {refs.map((ref) => {
                            const isRemote = ref.includes("/");
                            return (
                              <span
                                key={ref}
                                className={cn(
                                  "inline-flex h-4 max-w-28 items-center truncate rounded px-1 font-mono text-3xs font-semibold",
                                  isRemote
                                    ? "bg-muted/80 text-muted-foreground"
                                    : "bg-primary/12 text-primary",
                                )}
                              >
                                {ref}
                              </span>
                            );
                          })}
                          <span className="font-mono">{shortSha}</span>
                          {relativeTime ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{relativeTime}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex items-center gap-1.5 pt-0.5">
              {props.onOpenChanges ? (
                <button
                  type="button"
                  onClick={props.onOpenChanges}
                  className="inline-flex h-6 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/75 bg-muted/40 px-2 text-2xs font-medium text-foreground/85 outline-none transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
                >
                  <FileDiffIcon aria-hidden className="size-3 text-muted-foreground" />
                  <span>Open Diff</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-md px-2 text-2xs font-medium text-muted-foreground outline-none transition-colors hover:bg-black/[0.04] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.06]"
              >
                Collapse
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {props.showBranch && project ? (
        <ThreadDetailsThreadPrRows
          threadRef={threadRef}
          project={project}
          branchPr={branchPr}
          branchSourceControlProvider={gitStatus?.sourceControlProvider}
          onActed={() => vcsStatusQuery.refresh()}
        />
      ) : null}

      {props.showBranch && linkedIssues.length > 0 ? (
        <ThreadDetailsIssueRows
          links={linkedIssues}
          onOpenLink={(event, link) => {
            event.stopPropagation();
            useRightPanelStore.getState().openIssue(threadRef, {
              projectId: link.projectId,
              tracker: link.tracker,
              host: link.host,
              scope: link.scope,
              key: link.key,
              url: link.url,
            });
          }}
        />
      ) : null}
    </div>
  );
}
