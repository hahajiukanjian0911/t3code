import { describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";
import type { TimelineViewport } from "./timelineViewport";
import {
  measuredEndOffset,
  settleListScroll,
  startTimelinePositionRestore,
} from "./useTimelinePositionRestore";

describe("settleListScroll", () => {
  it("hands off when a streaming reply keeps moving the end", async () => {
    vi.useFakeTimers();
    // The node test environment has no animation frames; fake ones run on the fake clock.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16),
    );
    // Every correction lands, then the reply grows before the next frame.
    const element = { scrollTop: 0, scrollHeight: 5_000, clientHeight: 800 };
    const list = {
      getScrollableNode: () => element as unknown as HTMLElement,
      scrollToOffset: async ({ offset }: { offset: number }) => {
        element.scrollTop = offset;
        element.scrollHeight += 40;
      },
    };

    let settled = false;
    void settleListScroll(list, measuredEndOffset, () => false).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    vi.unstubAllGlobals();

    expect(settled).toBe(true);
  });
});

describe("startTimelinePositionRestore", () => {
  it("shows a fully measured short conversation before the pending scroll-to-end completes", () => {
    const element = { clientHeight: 750, scrollHeight: 750, scrollTop: 0 };
    const scroll = Promise.withResolvers<void>();
    const list = {
      getState: () => ({ data: [{ id: "reply" }], sizes: new Map([["reply", 80]]) }),
      getScrollableNode: () => element,
      scrollToEnd: () => scroll.promise,
      cancelScroll: () => scroll.resolve(),
    } as unknown as LegendListRef;
    const viewport = {
      scrollNode: element,
      holdProgrammaticScroll: () => () => {},
      subscribe: () => () => {},
    } as unknown as TimelineViewport;
    const onAligned = vi.fn();
    const cancel = startTimelinePositionRestore({
      list,
      viewport,
      listIdentityKey: "env:short",
      listOpenedOn: null,
      rememberedPosition: undefined,
      citationPending: false,
      releaseForFind: false,
      isResizing: () => false,
      onAligned,
      onPositioned: vi.fn(),
    });
    try {
      expect(onAligned).toHaveBeenCalledOnce();
    } finally {
      cancel();
    }
  });

  it("settles to the measured end when a remounted list opens on a thread whose initialScrollAtEnd fell short", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16),
    );
    const element = { scrollTop: 0, scrollHeight: 4_000, clientHeight: 800 };
    const list = {
      getState: () => ({ data: [{ id: "row-1" }, { id: "row-2" }] }),
      getScrollableNode: () => element as unknown as HTMLElement,
      scrollToOffset: async ({ offset }: { offset: number }) => {
        element.scrollTop = offset;
      },
      scrollToEnd: async () => {
        element.scrollTop = element.scrollHeight - element.clientHeight;
      },
    } as unknown as LegendListRef;
    const viewport = {
      scrollNode: element as unknown as HTMLElement,
      navigate: vi.fn(),
      holdProgrammaticScroll: () => () => {},
      subscribe: () => () => {},
      followReleased: vi.fn(),
      onFollowReleased: () => () => {},
    } as unknown as TimelineViewport;

    let resizing = true;
    let positionedAtScrollTop: number | null = null;
    const aligned = vi.fn(() => {
      expect(element.scrollTop).toBe(3_200);
      expect(positionedAtScrollTop).toBeNull();
    });
    startTimelinePositionRestore({
      list,
      viewport,
      listIdentityKey: "env:thread-b",
      listOpenedOn: "env:thread-b",
      rememberedPosition: undefined,
      citationPending: false,
      releaseForFind: false,
      onAligned: aligned,
      isResizing: () => resizing,
      onPositioned: () => {
        positionedAtScrollTop = element.scrollTop;
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(aligned).toHaveBeenCalledTimes(1);
    expect(positionedAtScrollTop).toBeNull();
    element.scrollHeight += 200;
    resizing = false;
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    vi.unstubAllGlobals();

    expect(positionedAtScrollTop).toBe(3_400);
    expect(aligned).toHaveBeenCalledTimes(1);
    expect(element.scrollTop).toBe(3_400);
  });
});
