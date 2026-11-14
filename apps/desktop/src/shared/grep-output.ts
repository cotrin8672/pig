/** SDK grep output: matches use path:line: text, surrounding lines path-line- text. */
export interface GrepLine {
  line: number;
  text: string;
  match: boolean;
}
export interface GrepFile {
  path: string;
  lines: GrepLine[];
  matches: number;
}

export function parseGrepOutput(text: string) {
  const files = new Map<string, GrepFile>();
  const notices: string[] = [];
  let matches = 0;
  for (const raw of text.split(/\r?\n/)) {
    const found = /^(.+?)([:-])(\d+)\2 ?(.*)$/.exec(raw);
    if (!found) {
      if (raw !== "--") notices.push(raw);
      continue;
    }
    const [, path, separator, number, content] = found;
    const file = files.get(path) ?? { path, lines: [], matches: 0 };
    const match = separator === ":";
    file.lines.push({ line: Number(number), text: content, match });
    if (match) {
      file.matches++;
      matches++;
    }
    files.set(path, file);
  }
  return {
    files: [...files.values()],
    matches,
    notices: notices.join("\n").replace(/^\n+|\n+$/g, ""),
  };
}

export function grepPattern(args: Record<string, unknown>) {
  if (typeof args.pattern !== "string" || !args.pattern) return undefined;
  const pattern = args.literal
    ? args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : args.pattern;
  try {
    return new RegExp(pattern, args.ignoreCase ? "gi" : "g");
  } catch {
    // ripgrep's regex dialect can differ from JavaScript's; keep the text literal.
    return undefined;
  }
}
