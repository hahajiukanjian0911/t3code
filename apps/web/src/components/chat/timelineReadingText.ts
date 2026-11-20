const ROW_SELECTOR = "[data-timeline-row-id]";
const BODY_SELECTOR = "[data-thread-find-text]";
const IGNORE_SELECTOR = "svg, [data-thread-find-ignore], [role=toolbar]";

export interface TimelineReadingText {
  readonly textOffset: number;
  readonly viewportOffset: number;
}

function* rowTextNodes(row: Element): Generator<Text> {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest(BODY_SELECTOR) && !parent.closest(IGNORE_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Text;
}

function charRect(range: Range, node: Text, offset: number) {
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  return range.getBoundingClientRect();
}

function captureRowText(row: HTMLElement, viewport: DOMRect, selection?: Range) {
  const range = row.ownerDocument.createRange();
  let textOffset = 0;
  for (const node of rowTextNodes(row)) {
    const start = textOffset;
    textOffset += node.length;
    if (!node.length || (selection && !selection.intersectsNode(node))) continue;
    const from = selection?.startContainer === node ? selection.startOffset : 0;
    const to = selection?.endContainer === node ? selection.endOffset : node.length;
    if (from >= to) continue;
    const fold = node.parentElement?.closest("[data-thread-find-fold]");
    const bottom = Math.min(viewport.bottom, fold?.getBoundingClientRect().bottom ?? Infinity);
    range.setStart(node, from);
    range.setEnd(node, to);
    const bounds = range.getBoundingClientRect();
    const top = viewport.top - 0.5;
    if (!bounds.width || bounds.bottom <= top || bounds.top >= bottom) continue;
    // A single text node can span hundreds of lines. Search its line positions logarithmically.
    let low = from;
    let high = to - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const rect = charRect(range, node, middle);
      if (selection ? rect.bottom <= top : rect.top < top) low = middle + 1;
      else high = middle;
    }
    for (let offset = low; offset < to; offset += 1) {
      const rect = charRect(range, node, offset);
      if (rect.top >= bottom) break;
      if (
        rect.width > 0 &&
        rect.right > viewport.left &&
        rect.left < viewport.right &&
        (selection ? rect.bottom > top : rect.top >= top)
      ) {
        return { textOffset: start + offset, viewportOffset: rect.top - viewport.top };
      }
    }
  }
  return undefined;
}

export function captureTimelineReadingText(
  node: HTMLElement,
  composerInset: number,
): (TimelineReadingText & { readonly rowId: string }) | undefined {
  const bounds = node.getBoundingClientRect();
  if (bounds.height <= composerInset || !bounds.width) return undefined;
  const viewport = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height - composerInset);
  const selection = node.ownerDocument.getSelection();
  const range =
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount &&
    node.contains(selection.anchorNode) &&
    node.contains(selection.focusNode)
      ? selection.getRangeAt(0)
      : undefined;
  const rows = [...node.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  for (const selected of range ? [range, undefined] : [undefined]) {
    for (const row of rows) {
      const rowId = row.dataset.timelineRowId;
      if (!rowId || (selected && !selected.intersectsNode(row))) continue;
      const text = captureRowText(row, viewport, selected);
      if (text) return { rowId, ...text };
    }
  }
  return undefined;
}

export function timelineReadingTextTop(
  row: Element,
  text: TimelineReadingText,
): number | undefined {
  let offset = text.textOffset;
  for (const node of rowTextNodes(row)) {
    if (offset < node.length) {
      const rect = charRect(row.ownerDocument.createRange(), node, offset);
      const fold = node.parentElement?.closest("[data-thread-find-fold]");
      return rect.width && (!fold || rect.top < fold.getBoundingClientRect().bottom)
        ? rect.top
        : undefined;
    }
    offset -= node.length;
  }
  return undefined;
}
