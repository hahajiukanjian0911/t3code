export interface RawSelectionRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly lineLeft: number;
  readonly lineRight: number;
  readonly scopeKey: string;
}

export interface SelectionBand {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly radiusTopLeft: number;
  readonly radiusTopRight: number;
  readonly radiusBottomRight: number;
  readonly radiusBottomLeft: number;
}

export interface MergeSelectionBandsOptions {
  readonly startsBeforeRoot: boolean;
  readonly endsAfterRoot: boolean;
  readonly cornerRadius?: number;
  readonly verticalPad?: number;
  readonly maxSeamGap?: number;
}

interface MutableLine {
  left: number;
  right: number;
  top: number;
  bottom: number;
  lineLeft: number;
  lineRight: number;
  scopeKey: string;
}

const DEFAULT_CORNER_RADIUS = 3;
const DEFAULT_VERTICAL_PAD = 1.5;
const DEFAULT_MAX_SEAM_GAP = 18;
const LEFT_EDGE_SNAP_PX = 4;

const SELECTION_OVERLAY_ATTR = "data-chat-markdown-selection-overlay";
const SELECTION_ACTIVE_ATTR = "data-chat-markdown-selection-active";
const SELECTION_BAND_ATTR = "data-chat-markdown-selection-band";
const SKIPPED_ANCESTOR_SELECTOR =
  '[aria-hidden="true"], .select-none, pre, .chat-markdown-codeblock, button:not(.chat-markdown-file-link)';

/**
 * Merges raw text-run client rects (already relative to the markdown root) into
 * continuous full-line selection bands with closed vertical seams and clean outer corners.
 */
export function mergeSelectionBands(
  rawRects: ReadonlyArray<RawSelectionRect>,
  options: MergeSelectionBandsOptions,
): SelectionBand[] {
  if (rawRects.length === 0) return [];

  const cornerRadius = options.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const verticalPad = options.verticalPad ?? DEFAULT_VERTICAL_PAD;
  const maxSeamGap = options.maxSeamGap ?? DEFAULT_MAX_SEAM_GAP;

  // Group horizontally adjacent rects on the same visual line within the same horizontal scope
  // (main prose column or an individual table cell).
  const lines: MutableLine[] = [];
  for (const rect of rawRects) {
    const height = rect.bottom - rect.top;
    const width = rect.right - rect.left;
    if (width < 0.5 || height < 0.5) continue;

    let matched: MutableLine | null = null;
    for (const line of lines) {
      if (line.scopeKey !== rect.scopeKey) continue;
      const lineHeight = line.bottom - line.top;
      const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
      const minHeight = Math.min(lineHeight, height);
      if (overlap >= minHeight * 0.35) {
        matched = line;
        break;
      }
    }

    if (matched) {
      matched.left = Math.min(matched.left, rect.left);
      matched.right = Math.max(matched.right, rect.right);
      matched.top = Math.min(matched.top, rect.top);
      matched.bottom = Math.max(matched.bottom, rect.bottom);
    } else {
      lines.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        lineLeft: rect.lineLeft,
        lineRight: rect.lineRight,
        scopeKey: rect.scopeKey,
      });
    }
  }

  if (lines.length === 0) return [];

  // Keep each horizontal scope's lines grouped in document order, sorted top-to-bottom within
  // each scope so side-by-side table cells do not interleave when sorting by `top`.
  const scopeOrder = new Map<string, number>();
  for (const line of lines) {
    if (!scopeOrder.has(line.scopeKey)) scopeOrder.set(line.scopeKey, scopeOrder.size);
  }
  lines.sort((a, b) => {
    const scopeDiff = (scopeOrder.get(a.scopeKey) ?? 0) - (scopeOrder.get(b.scopeKey) ?? 0);
    if (scopeDiff !== 0) return scopeDiff;
    return Math.abs(a.top - b.top) > 1 ? a.top - b.top : a.left - b.left;
  });

  // Pad each line slightly so ascenders/descenders and inline code borders sit comfortably inside.
  for (const line of lines) {
    line.top -= verticalPad;
    line.bottom += verticalPad;
  }

  const isMultiLine = lines.length > 1 || options.startsBeforeRoot || options.endsAfterRoot;

  if (isMultiLine) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isFirst = i === 0 && !options.startsBeforeRoot;
      const isLast = i === lines.length - 1 && !options.endsAfterRoot;

      if (!isFirst || line.left - line.lineLeft <= LEFT_EDGE_SNAP_PX) {
        line.left = line.lineLeft;
      }

      if (!isLast) {
        line.right = Math.max(line.right, line.lineRight);
      }
    }
  }

  // Close vertical gaps between consecutive lines in the same scope so multi-line blocks
  // render as one uninterrupted shape without white horizontal stripes.
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i]!;
    const next = lines[i + 1]!;
    if (current.scopeKey !== next.scopeKey) continue;
    const gap = next.top - current.bottom;
    if (gap > -4 && gap <= maxSeamGap) {
      const seam = (current.bottom + next.top) / 2;
      current.bottom = seam;
      next.top = seam;
    }
  }

  return lines.map((line, i) => {
    const prev = i > 0 ? lines[i - 1]! : null;
    const next = i < lines.length - 1 ? lines[i + 1]! : null;
    const touchesPrev =
      prev !== null && prev.scopeKey === line.scopeKey && Math.abs(line.top - prev.bottom) <= 0.75;
    const touchesNext =
      next !== null && next.scopeKey === line.scopeKey && Math.abs(next.top - line.bottom) <= 0.75;

    const topLeftCovered = touchesPrev && prev.left <= line.left + 1;
    const topRightCovered = touchesPrev && prev.right >= line.right - 1;
    const bottomLeftCovered = touchesNext && next.left <= line.left + 1;
    const bottomRightCovered = touchesNext && next.right >= line.right - 1;

    return {
      left: line.left,
      top: line.top,
      width: Math.max(0, line.right - line.left),
      height: Math.max(0, line.bottom - line.top),
      radiusTopLeft: topLeftCovered ? 0 : cornerRadius,
      radiusTopRight: topRightCovered ? 0 : cornerRadius,
      radiusBottomRight: bottomRightCovered ? 0 : cornerRadius,
      radiusBottomLeft: bottomLeftCovered ? 0 : cornerRadius,
    };
  });
}

function getInlinePaddingBox(textNode: Text, root: HTMLElement): HTMLElement | null {
  let el = textNode.parentElement;
  while (el && el !== root) {
    if (el.tagName === "CODE" && el.closest("pre") === null) return el;
    if (el.classList.contains("chat-markdown-file-link")) return el;
    el = el.parentElement;
  }
  return null;
}

function getLineHorizontalScope(
  textNode: Text,
  root: HTMLElement,
  rootRect: DOMRect,
  cellScopes: WeakMap<Element, string>,
  nextCellId: { value: number },
): { scopeKey: string; lineLeft: number; lineRight: number } {
  const cell = textNode.parentElement?.closest("td, th");
  if (cell && root.contains(cell)) {
    let key = cellScopes.get(cell);
    if (!key) {
      key = `cell:${nextCellId.value++}`;
      cellScopes.set(cell, key);
    }
    const cellRect = cell.getBoundingClientRect();
    return {
      scopeKey: key,
      lineLeft: Math.max(0, cellRect.left - rootRect.left),
      lineRight: Math.min(rootRect.width, cellRect.right - rootRect.left),
    };
  }
  return {
    scopeKey: "prose",
    lineLeft: 0,
    lineRight: rootRect.width,
  };
}

function resolveTextOffsets(textNode: Text, range: Range): { start: number; end: number } | null {
  const len = textNode.length;
  if (len === 0) return null;

  let start = 0;
  let end = len;
  if (textNode === range.startContainer) {
    start = range.startOffset;
  } else if (range.comparePoint(textNode, 0) < 0) {
    return null;
  }

  if (textNode === range.endContainer) {
    end = range.endOffset;
  } else if (range.comparePoint(textNode, len) > 0) {
    return null;
  }

  if (end <= start) return null;
  return { start, end };
}

function isRangeOutsideRootEdge(
  root: HTMLElement,
  range: Range,
): {
  startsBeforeRoot: boolean;
  endsAfterRoot: boolean;
} {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  const startsBeforeRoot = !root.contains(startNode);
  const endsAfterRoot = !root.contains(endNode);
  return { startsBeforeRoot, endsAfterRoot };
}

function collectRootSelectionBands(root: HTMLElement, range: Range): SelectionBand[] {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return [];

  const scratch = document.createRange();
  const rawRects: RawSelectionRect[] = [];
  const cellScopes = new WeakMap<Element, string>();
  const nextCellId = { value: 0 };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIPPED_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current !== null) {
    const textNode = current as Text;
    const offsets = resolveTextOffsets(textNode, range);
    if (offsets) {
      scratch.setStart(textNode, offsets.start);
      scratch.setEnd(textNode, offsets.end);
      const clientRects = scratch.getClientRects();
      if (clientRects.length > 0) {
        const scope = getLineHorizontalScope(textNode, root, rootRect, cellScopes, nextCellId);
        const inlineBox = getInlinePaddingBox(textNode, root);
        const inlineBoxRect = inlineBox ? inlineBox.getBoundingClientRect() : null;
        const expandLeft = inlineBoxRect !== null && offsets.start === 0;
        const expandRight = inlineBoxRect !== null && offsets.end === textNode.length;

        for (let i = 0; i < clientRects.length; i++) {
          const r = clientRects[i]!;
          if (r.width < 0.5 || r.height < 0.5) continue;
          let left = r.left - rootRect.left;
          let right = r.right - rootRect.left;
          const top = r.top - rootRect.top;
          const bottom = r.bottom - rootRect.top;

          if (expandLeft && i === 0 && inlineBoxRect) {
            const boxLeft = inlineBoxRect.left - rootRect.left;
            if (Math.abs(left - boxLeft) <= 28) left = Math.min(left, boxLeft);
          }
          if (expandRight && i === clientRects.length - 1 && inlineBoxRect) {
            const boxRight = inlineBoxRect.right - rootRect.left;
            if (Math.abs(boxRight - right) <= 16) right = Math.max(right, boxRight);
          }

          rawRects.push({
            left: Math.max(scope.lineLeft, left),
            right: Math.min(scope.lineRight, right),
            top,
            bottom,
            lineLeft: scope.lineLeft,
            lineRight: scope.lineRight,
            scopeKey: scope.scopeKey,
          });
        }
      }
    }
    current = walker.nextNode();
  }

  if (rawRects.length === 0) return [];
  const edges = isRangeOutsideRootEdge(root, range);
  return mergeSelectionBands(rawRects, edges);
}

const registeredRoots = new Set<HTMLElement>();
const activeOverlays = new Map<HTMLElement, HTMLDivElement>();
let listenersAttached = false;
let rafId: number | null = null;

function clearRootOverlay(root: HTMLElement): void {
  const overlay = activeOverlays.get(root);
  if (overlay) {
    overlay.remove();
    activeOverlays.delete(root);
  }
  root.removeAttribute(SELECTION_ACTIVE_ATTR);
}

function clearAllOverlays(): void {
  for (const root of activeOverlays.keys()) {
    clearRootOverlay(root);
  }
}

function renderRootOverlay(root: HTMLElement, bands: ReadonlyArray<SelectionBand>): void {
  if (bands.length === 0) {
    clearRootOverlay(root);
    return;
  }

  let overlay = activeOverlays.get(root);
  if (!overlay || overlay.parentElement !== root) {
    overlay = document.createElement("div");
    overlay.setAttribute(SELECTION_OVERLAY_ATTR, "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "select-none";
    root.append(overlay);
    activeOverlays.set(root, overlay);
  }

  root.setAttribute(SELECTION_ACTIVE_ATTR, "");

  // Reuse existing band nodes to avoid churn while drag-selecting.
  while (overlay.childElementCount > bands.length) {
    overlay.lastElementChild?.remove();
  }
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    let node = overlay.children[i] as HTMLSpanElement | undefined;
    if (!node) {
      node = document.createElement("span");
      node.setAttribute(SELECTION_BAND_ATTR, "");
      overlay.append(node);
    }
    node.style.left = `${band.left}px`;
    node.style.top = `${band.top}px`;
    node.style.width = `${band.width}px`;
    node.style.height = `${band.height}px`;
    node.style.borderRadius = `${band.radiusTopLeft}px ${band.radiusTopRight}px ${band.radiusBottomRight}px ${band.radiusBottomLeft}px`;
  }
}

function syncActiveSelection(): void {
  rafId = null;
  if (registeredRoots.size === 0) {
    clearAllOverlays();
    return;
  }

  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearAllOverlays();
    return;
  }

  const range = selection.getRangeAt(0);
  const visited = new Set<HTMLElement>();

  for (const root of registeredRoots) {
    if (!root.isConnected || !range.intersectsNode(root)) continue;
    visited.add(root);
    const bands = collectRootSelectionBands(root, range);
    renderRootOverlay(root, bands);
  }

  for (const root of activeOverlays.keys()) {
    if (!visited.has(root)) clearRootOverlay(root);
  }
}

function scheduleSelectionSync(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(syncActiveSelection);
}

function handleSelectionChange(): void {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    clearAllOverlays();
    return;
  }
  scheduleSelectionSync();
}

function handleResize(): void {
  if (activeOverlays.size === 0) return;
  scheduleSelectionSync();
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("selectionchange", handleSelectionChange);
  window.addEventListener("resize", handleResize);
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  document.removeEventListener("selectionchange", handleSelectionChange);
  window.removeEventListener("resize", handleResize);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * Registers a `.chat-markdown` root for continuous full-line selection rendering.
 * Keeps a single shared document `selectionchange` listener across all mounted messages.
 */
export function registerChatMarkdownSelectionRoot(root: HTMLElement): () => void {
  registeredRoots.add(root);
  attachListeners();
  return () => {
    registeredRoots.delete(root);
    clearRootOverlay(root);
    if (registeredRoots.size === 0) {
      detachListeners();
    }
  };
}
