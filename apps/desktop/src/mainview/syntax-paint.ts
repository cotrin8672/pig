import type { ThemedToken } from "shiki/core";
import type { SyntaxLine } from "./syntax-text";
import { tokenRuns } from "./token-runs";

type Source = {
  element: HTMLElement;
  lines: readonly SyntaxLine[];
  tokens?: (ThemedToken[] | undefined)[];
  nodes: HTMLElement[][];
};
type Group = { element: Element; sources: Source[]; dirty: boolean };
type Clip = { top: number; bottom: number };
const groups = new Map<Element, Group>();
const targets = new Map<Element, number>();
const paints = new Map<string, { name: string; highlight: Highlight }>();
const rangePool: Range[] = [];
let style: HTMLStyleElement | undefined;
let observer: ResizeObserver | undefined;
let frame: number | undefined;
let nextPaint = 0;

function schedule() {
  frame ??= requestAnimationFrame(draw);
}

function clip(element: Element): Clip {
  let top = -innerHeight;
  let bottom = innerHeight * 2;
  for (
    let parent: Element | null = element;
    parent;
    parent = parent.parentElement
  ) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))
      continue;
    const rect = parent.getBoundingClientRect();
    const start = rect.top + parent.clientTop;
    top = Math.max(top, start);
    bottom = Math.min(bottom, start + parent.clientHeight);
  }
  return { top, bottom };
}

/** Rectangles are monotonic in source order, including wrapped logical lines. */
function visible(
  count: number,
  bounds: (index: number) => DOMRect,
  viewport: Clip,
): [number, number] {
  const margin = Math.max(320, viewport.bottom - viewport.top);
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (bounds(mid).bottom < viewport.top - margin) low = mid + 1;
    else high = mid;
  }
  const first = low;
  high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (bounds(mid).top <= viewport.bottom + margin) low = mid + 1;
    else high = mid;
  }
  return [first, low];
}

function paint(color?: string, background?: string) {
  const key = JSON.stringify([color, background]);
  let entry = paints.get(key);
  if (!entry) {
    if (!style) {
      style = document.createElement("style");
      document.head.append(style);
    }
    const sheet = style.sheet;
    if (!sheet) return undefined;
    const name = `pig-syntax-${nextPaint++}`;
    const index = sheet.insertRule(`::highlight(${name}) {}`);
    const rule = sheet.cssRules[index] as CSSStyleRule;
    if (color) rule.style.color = color;
    if (background) rule.style.backgroundColor = background;
    const highlight = new Highlight();
    highlight.priority = -1;
    CSS.highlights.set(name, highlight);
    entry = { name, highlight };
    paints.set(key, entry);
  }
  return entry.highlight;
}

function draw() {
  frame = undefined;
  let used = 0;
  for (const entry of paints.values()) entry.highlight.clear();
  const measure = new Range();
  for (const group of groups.values()) {
    const rect = group.element.getBoundingClientRect();
    if (
      !rect.height ||
      rect.bottom < -innerHeight ||
      rect.top > innerHeight * 2
    )
      continue;
    const viewport = clip(group.element);
    if (viewport.bottom <= viewport.top) continue;
    if (group.dirty) {
      group.sources.sort((a, b) =>
        a.element.compareDocumentPosition(b.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      group.dirty = false;
    }
    const [first, last] = visible(
      group.sources.length,
      (index) => group.sources[index].element.getBoundingClientRect(),
      viewport,
    );
    for (let index = first; index < last; index++) {
      const source = group.sources[index];
      if (!source.element.isConnected || !source.tokens) continue;
      const lineBounds = (line: number) => {
        const nodes = source.nodes[line];
        if (!nodes?.length) return source.element.getBoundingClientRect();
        const last = nodes[nodes.length - 1];
        measure.setStart(nodes[0], 0);
        measure.setEnd(last, last.childNodes.length);
        const rect = measure.getBoundingClientRect();
        // Empty text has no glyph rectangle, but its inline box still has a
        // source position. Do not make blank lines break the binary search.
        return rect.height ? rect : nodes[0].getBoundingClientRect();
      };
      const [start, end] = visible(source.lines.length, lineBounds, viewport);
      for (let line = start; line < end; line++) {
        const nodes = source.nodes[line];
        if (!nodes?.length) continue;
        let nodeIndex = 0;
        let nodeOffset = 0;
        let offset = 0;
        for (const token of tokenRuns(source.tokens[line] ?? [])) {
          const length = token.content.length;
          if (
            source.lines[line].text.slice(offset, offset + length) !==
            token.content
          )
            break;
          while (
            nodeIndex < nodes.length - 1 &&
            nodeOffset + (nodes[nodeIndex].textContent?.length ?? 0) <= offset
          ) {
            nodeOffset += nodes[nodeIndex].textContent?.length ?? 0;
            nodeIndex++;
          }
          if (
            length &&
            !token.fontStyle &&
            (token.bgColor || (token.color && token.content.trim()))
          ) {
            const node = nodes[nodeIndex].firstChild;
            if (
              node instanceof Text &&
              offset + length <= nodeOffset + node.length
            ) {
              let range = rangePool[used];
              if (!range) {
                range = new Range();
                rangePool.push(range);
              }
              used++;
              range.setStart(node, offset - nodeOffset);
              range.setEnd(node, offset - nodeOffset + length);
              paint(token.color, token.bgColor)?.add(range);
            }
          }
          offset += length;
        }
      }
    }
  }
  // Keep only currently painted ranges, not every line ever visited.
  rangePool.length = used;
  for (const [key, entry] of paints) {
    if (entry.highlight.size) continue;
    CSS.highlights.delete(entry.name);
    paints.delete(key);
    const sheet = style?.sheet;
    if (sheet)
      for (let index = sheet.cssRules.length - 1; index >= 0; index--)
        if (
          (sheet.cssRules[index] as CSSStyleRule).selectorText ===
          `::highlight(${entry.name})`
        )
          sheet.deleteRule(index);
  }
}

function watch(element: Element, delta: number) {
  const next = (targets.get(element) ?? 0) + delta;
  if (next > 0) {
    if (!targets.has(element)) observer?.observe(element);
    targets.set(element, next);
  } else {
    targets.delete(element);
    observer?.unobserve(element);
  }
}

/** Group diff rows by their shared pre; never scan all row rectangles per scroll. */
export function registerSyntaxPaint(element: HTMLElement) {
  if (!groups.size) {
    observer = new ResizeObserver(schedule);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
  }
  const parent = element.closest("pre") ?? element.parentElement ?? element;
  let group = groups.get(parent);
  if (!group) {
    group = { element: parent, sources: [], dirty: true };
    groups.set(parent, group);
  }
  const source: Source = { element, lines: [], nodes: [] };
  group.sources.push(source);
  group.dirty = true;
  const transcript = element.closest(".transcript");
  watch(parent, 1);
  if (transcript) watch(transcript, 1);
  return {
    update(
      lines: readonly SyntaxLine[],
      tokens?: (ThemedToken[] | undefined)[],
    ) {
      source.lines = lines;
      source.tokens = tokens;
      source.nodes = lines.map(() => []);
      for (const child of element.children) {
        if (child instanceof HTMLElement) {
          const index = Number(child.dataset.syntaxLine);
          source.nodes[index]?.push(child);
        }
      }
      schedule();
    },
    dispose() {
      group.sources.splice(group.sources.indexOf(source), 1);
      watch(parent, -1);
      if (transcript) watch(transcript, -1);
      if (!group.sources.length) groups.delete(parent);
      if (groups.size) schedule();
      else {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        for (const entry of paints.values()) CSS.highlights.delete(entry.name);
        paints.clear();
        rangePool.length = 0;
        style?.remove();
        style = undefined;
        nextPaint = 0;
      }
    },
  };
}
