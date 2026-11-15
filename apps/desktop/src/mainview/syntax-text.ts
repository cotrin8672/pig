import type { ThemedToken } from "shiki/core";
import { MAX_HIGHLIGHT_LINES } from "./syntax-source";
import { tokenRuns } from "./token-runs";

export type SyntaxLine = { text: string; newline: boolean };
export type SyntaxPart = { text: string; style?: ThemedToken };

/** Keep an oversized, unhighlighted tail intact, not one DOM row per log line. */
export function syntaxLines(text: string): SyntaxLine[] {
  const lines: SyntaxLine[] = [];
  let start = 0;
  while (lines.length < MAX_HIGHLIGHT_LINES - 1) {
    const end = text.indexOf("\n", start);
    if (end < 0) break;
    lines.push({ text: text.slice(start, end), newline: true });
    start = end + 1;
  }
  lines.push({ text: text.slice(start), newline: false });
  return lines;
}

/** Color needs no element. Keep real spans for font/decorations, including spaces. */
export function syntaxParts(
  text: string,
  tokens?: readonly ThemedToken[],
): SyntaxPart[] {
  const parts: SyntaxPart[] = [];
  const plain = (value: string) => {
    const previous = parts.at(-1);
    if (previous && !previous.style) previous.text += value;
    else parts.push({ text: value });
  };
  let offset = 0;
  for (const token of tokens ? tokenRuns(tokens) : []) {
    if (text.slice(offset, offset + token.content.length) !== token.content)
      break;
    if (token.fontStyle) parts.push({ text: token.content, style: token });
    else plain(token.content);
    offset += token.content.length;
  }
  plain(text.slice(offset));
  return parts;
}

/** CharacterData edits preserve live Range endpoints in the unchanged prefix/suffix.
 * React's whole-node value assignment would collapse them even on an append. */
export function updateSyntaxText(
  node: Pick<Text, "data" | "replaceData">,
  value: string,
) {
  const previous = node.data;
  if (previous === value) return;
  let start = 0;
  while (
    start < previous.length &&
    start < value.length &&
    previous[start] === value[start]
  )
    start++;
  let end = 0;
  while (
    end < previous.length - start &&
    end < value.length - start &&
    previous[previous.length - 1 - end] === value[value.length - 1 - end]
  )
    end++;
  node.replaceData(
    start,
    previous.length - start - end,
    value.slice(start, value.length - end),
  );
}
