export const TEXT_PAGE_CHARS = 16_384;

/** Bound both long lines and many short lines without splitting a surrogate pair. */
export function textRange(text: string, start: number) {
  let end = Math.min(text.length, start + TEXT_PAGE_CHARS);
  let next = start;
  for (let lines = 0; lines < 200; lines++) {
    const newline = text.indexOf("\n", next);
    if (newline < 0 || newline >= end) break;
    next = newline + 1;
    if (lines === 199) end = next;
  }
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return { start, end, text: text.slice(start, end) };
}

export function lastLines(text: string, count = 2) {
  let start = text.length;
  for (let i = 0; i < count; i++) {
    start = text.lastIndexOf("\n", start - 1);
    if (start < 0) return text;
  }
  return text.slice(start + 1);
}

export function lineCount(text: string) {
  let lines = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    lines++;
  return lines;
}
