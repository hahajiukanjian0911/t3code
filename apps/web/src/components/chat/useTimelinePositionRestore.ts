import type { LegendListRef } from "@legendapp/list/react";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { RememberedTimelinePosition } from "./timelineScrollAnchoring";
import type { TimelineViewport } from "./timelineViewport";
import { timelineReadingTextTop } from "./timelineReadingText";

// A streaming reply moves the end every frame, so the target may never hold
// still. Past this many frames the list's own end maintenance takes over.
const SETTLE_MAX_FRAMES = 60;

/**
 * Index and end scrolling start from estimated row sizes, so they can stop
 * short of a tall row. Corrects against the DOM until the viewport holds the
 * target for two layout frames, the frame budget runs out, the caller cancels,
 * or the target disappears.
 */
export function settleListScroll(
  list: Pick<LegendListRef, "getScrollableNode" | "scrollToOffset">,
  target: (element: HTMLElement) => number | undefined,
  isCancelled: () => boolean,
  restore?: { onAligned: () => void; isResizing: () => boolean },
): Promise<void> {
  return new Promise((resolve) => {
    let onAligned = restore?.onAligned;
    let stableFrames = 0;
    let frames = 0;
    const reconcile = () => {
      if (isCancelled()) return resolve();
      const element = list.getScrollableNode();
      const offset = element ? target(element) : undefined;
      // Rewrapping can move the saved row again even after two aligned frames.
      const resizing = restore?.isResizing() ?? false;
      frames = resizing ? 0 : frames + 1;
      if (!element || offset === undefined || frames > SETTLE_MAX_FRAMES) return resolve();
      if (Math.abs(element.scrollTop - offset) > 1) {
        stableFrames = 0;
        void list.scrollToOffset({ offset, animated: false }).then(() => {
          requestAnimationFrame(reconcile);
        });
        return;
      }
      stableFrames += 1;
      if (stableFrames >= 2) {
        if (element.clientHeight > 0 && onAligned) {
          onAligned();
          onAligned = undefined;
        }
        if (!resizing) return resolve();
      }
      requestAnimationFrame(reconcile);
    };
    if (restore) reconcile();
    else requestAnimationFrame(reconcile);
  });
}

export const measuredEndOffset = (element: HTMLElement) =>
  element.scrollHeight - element.clientHeight;

export function timelineReadingOffset(
  list: LegendListRef,
  element: HTMLElement,
  position: RememberedTimelinePosition,
): number | undefined {
  const state = list.getState();
  const index = state.indexByKey(position.rowId);
  const row = index === undefined ? undefined : state.elementAtIndex(index);
  if (!row) return undefined;
  const text = position.text;
  const textTop = text ? timelineReadingTextTop(row, text) : undefined;
  const target =
    text && textTop !== undefined
      ? textTop - text.viewportOffset
      : row.getBoundingClientRect().top + position.offsetWithinRow;
  return Math.max(
    0,
    Math.min(
      element.scrollTop + target - element.getBoundingClientRect().top,
      measuredEndOffset(element),
    ),
  );
}

/**
 * Scrolls a newly shown thread back to where the user left it, or to its end,
 * and reports the thread positioned once the saved row settles. Any navigation
 * on the viewport cancels it where it is. Returns the cancel for the
 * operation's owner.
 */
export function startTimelinePositionRestore({
  list,
  viewport,
  listIdentityKey,
  listOpenedOn,
  rememberedPosition: position,
  citationPending,
  releaseForFind,
  onAligned,
  isResizing,
  onPositioned,
}: {
  readonly list: LegendListRef;
  readonly viewport: TimelineViewport;
  readonly listIdentityKey: string;
  /** The identity the mounted list opened on, until it shows another; see nextListOpening. */
  readonly listOpenedOn: string | null;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly citationPending: boolean;
  /**
   * Find was open when the list started showing the thread. Opening find is
   * navigation, so follow lets go; the thread still opens where it was left,
   * and MessagesTimeline holds find's reveal until this reports it positioned.
   */
  readonly releaseForFind: boolean;
  readonly onAligned: () => void;
  readonly isResizing: () => boolean;
  readonly onPositioned: () => void;
}): () => void {
  if (citationPending) {
    // The citation scroll owns positioning once the list has mounted.
    onPositioned();
    return () => {};
  }
  let cancelled = false;
  let checkFitFrame = 0;
  const state = list.getState();
  const rows = state.data as ReadonlyArray<MessagesTimelineRow>;
  const index = position ? rows.findIndex((row) => row.id === position.rowId) : -1;
  // Reading history or finding: follow lets go before the restore claims the viewport.
  if (position?.atEnd === false || releaseForFind) viewport.navigate({ releasesFollow: true });
  const releaseScrollHold = viewport.holdProgrammaticScroll();
  const stop = () => {
    cancelled = true;
    if (checkFitFrame) cancelAnimationFrame(checkFitFrame);
    releaseScrollHold();
    unsubscribe();
  };
  const unsubscribe = viewport.subscribe((navigation) => {
    if (cancelled || (navigation.source === "pointer" && !navigation.onScrollbar)) return;
    stop();
    void list.scrollToOffset({ offset: viewport.scrollNode.scrollTop, animated: false });
    onPositioned();
  });
  const finish = () => {
    stop();
    onPositioned();
  };
  let revealed = false;
  const reveal = () => {
    if (revealed || cancelled) return;
    revealed = true;
    onAligned();
  };
  // A short thread can be painted before LegendList resolves its queued end scroll.
  const revealIfItFits = () => {
    const node = viewport.scrollNode;
    if (!rows.length || !node.clientHeight || node.scrollHeight > node.clientHeight || isResizing())
      return;
    if (rows.every((row) => state.sizes.has(row.id))) {
      reveal();
      return;
    }
    const mounted = node.querySelectorAll<HTMLElement>("[data-timeline-row-id]");
    if (mounted.length !== rows.length) return;
    const ids = new Set(rows.map((row) => row.id));
    const bounds = node.getBoundingClientRect();
    for (const item of mounted) {
      const rect = item.getBoundingClientRect();
      if (
        !ids.delete(item.dataset.timelineRowId!) ||
        !rect.height ||
        rect.top < bounds.top - 1 ||
        rect.bottom > bounds.bottom + 1
      )
        return;
    }
    reveal();
  };
  if (!releaseForFind) {
    revealIfItFits();
    if (!revealed && viewport.scrollNode.scrollHeight === viewport.scrollNode.clientHeight) {
      checkFitFrame = requestAnimationFrame(revealIfItFits);
    }
  }
  const scrolling =
    position?.atEnd === false
      ? index >= 0
        ? list.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0,
            viewOffset: -position.offsetWithinRow,
          })
        : list.scrollToOffset({ offset: position.scrollOffset, animated: false })
      : // initialScrollAtEnd measured this target; scrollToEnd would replace it with an estimate.
        listOpenedOn === listIdentityKey
        ? undefined
        : list.scrollToEnd({ animated: false });
  // Even when LegendList freshly opened on this thread (initialScrollAtEnd), tall rows
  // or delayed hydration can leave scrollTop short of the real end; verify and settle
  // against measuredEndOffset before marking positioned so handleScroll never records atEnd=false.
  const settlesAtEnd = position?.atEnd !== false;
  const handoff = { onAligned: reveal, isResizing };
  void Promise.resolve(scrolling).then(async () => {
    if (cancelled) return;
    if (settlesAtEnd) {
      await settleListScroll(list, measuredEndOffset, () => cancelled, handoff);
    } else if (position?.atEnd === false && index >= 0) {
      // Keep the saved row mounted until its measured position and the DOM agree.
      await settleListScroll(
        list,
        (element) => timelineReadingOffset(list, element, position),
        () => cancelled,
        handoff,
      );
    }
    if (!cancelled) finish();
  });
  return () => {
    if (cancelled) return;
    stop();
    list.cancelScroll();
  };
}
