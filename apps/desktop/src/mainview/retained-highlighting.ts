import type { ThemedToken } from "shiki/core";
import {
  canHighlight,
  codeLanguage,
  terminalText,
} from "./syntax-highlighting";

export type HighlightSnapshot = {
  text: string;
  language?: string;
  tokens: ThemedToken[][];
};

/** Keep only the unchanged prefix: later lines may have a new lexical state. */
export function retainedHighlight(
  text: string,
  language: string | undefined,
  previous?: HighlightSnapshot,
): (ThemedToken[] | undefined)[] | undefined {
  const lang = codeLanguage(language);
  if (
    !previous ||
    !lang ||
    lang !== codeLanguage(previous.language) ||
    !canHighlight(text)
  )
    return undefined;

  let prefix = 0;
  while (
    prefix < text.length &&
    prefix < previous.text.length &&
    text[prefix] === previous.text[prefix]
  )
    prefix++;
  // ANSI control changes can alter colors even when the visible text is identical.
  const plain = lang === "ansi" ? terminalText(text) : text;
  let remaining =
    lang === "ansi" ? terminalText(text.slice(0, prefix)).length : prefix;
  // Do not split a Unicode surrogate pair across differently styled spans.
  if (remaining > 0 && /[\uDC00-\uDFFF]/.test(plain[remaining] ?? ""))
    remaining--;
  if (!remaining) return undefined;

  return plain.split("\n").map((line, index) => {
    const length = Math.min(line.length, Math.max(0, remaining));
    remaining -= line.length + 1;
    const old = previous.tokens[index];
    if (!length || !old) return undefined;
    if (
      length === line.length &&
      old.map((token) => token.content).join("") === line
    )
      return old;

    let available = length;
    const tokens: ThemedToken[] = [];
    for (const token of old) {
      if (available <= 0) break;
      tokens.push(
        token.content.length <= available
          ? token
          : { ...token, content: token.content.slice(0, available) },
      );
      available -= token.content.length;
    }
    if (length < line.length)
      tokens.push({ content: line.slice(length), offset: length });
    return tokens;
  });
}
