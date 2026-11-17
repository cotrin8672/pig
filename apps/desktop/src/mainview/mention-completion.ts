/** The `@path` token at an unselected cursor; `@"…"` allows spaces. */
export function mentionContext(text: string, start: number, end: number) {
  if (start !== end || start > text.length) return undefined;
  const before = text.slice(0, start);
  const after = text.slice(start);
  const quoted = /(?:^|\s)@"([^"\n]*)$/.exec(before);
  if (quoted) {
    const suffix = /^[^"\n]*"?/.exec(after)?.[0] ?? "";
    return {
      prefix: quoted[1],
      start: start - quoted[1].length - 2,
      end: start + suffix.length,
    };
  }
  const plain = /(?:^|\s)@([^\s@"]*)$/.exec(before);
  if (!plain) return undefined;
  const suffix = /^[^\s]*/.exec(after)?.[0] ?? "";
  return {
    prefix: plain[1],
    start: start - plain[1].length - 1,
    end: start + suffix.length,
  };
}

/** A folder stays open (no closing quote or space) so its children complete next. */
export function applyMention(
  text: string,
  context: NonNullable<ReturnType<typeof mentionContext>>,
  path: string,
  directory: boolean,
) {
  const value = directory ? `${path}/` : path;
  const quote = /\s/.test(value);
  let replacement = `@${quote ? `"${value}` : value}`;
  if (!directory) {
    if (quote) replacement += '"';
    if (!/^\s/.test(text.slice(context.end))) replacement += " ";
  }
  return {
    text: text.slice(0, context.start) + replacement + text.slice(context.end),
    cursor: context.start + replacement.length,
  };
}
