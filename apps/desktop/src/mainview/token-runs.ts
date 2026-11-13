import type { ThemedToken } from "shiki/core";

const sameStyle = (a: ThemedToken, b: ThemedToken) =>
  a.color === b.color && a.bgColor === b.bgColor && a.fontStyle === b.fontStyle;
/** Adjacent lexical tokens with identical visible styling need one DOM span,
 * not one span per punctuation/space. Text and style boundaries stay exact. */
export function tokenRuns(tokens: readonly ThemedToken[]): ThemedToken[] {
  const result: ThemedToken[] = [];
  for (let start = 0; start < tokens.length; ) {
    let end = start + 1;
    while (end < tokens.length && sameStyle(tokens[start], tokens[end])) end++;
    result.push(
      end === start + 1
        ? tokens[start]
        : {
            ...tokens[start],
            content: tokens
              .slice(start, end)
              .map((token) => token.content)
              .join(""),
          },
    );
    start = end;
  }
  return result;
}
export function sameTokens(
  a?: readonly ThemedToken[],
  b?: readonly ThemedToken[],
) {
  return (
    a === b ||
    !!(
      a &&
      b &&
      a.length === b.length &&
      a.every(
        (token, index) =>
          token.content === b[index].content && sameStyle(token, b[index]),
      )
    )
  );
}
export function terminalRuns(lines: readonly string[]) {
  const runs: { start: number; text: string; tone?: "ok" | "bad" }[] = [];
  let start = 0;
  const tone = (line: string) =>
    /^[✓✔]/.test(line.trimStart())
      ? ("ok" as const)
      : /^[✗✘×]/.test(line.trimStart())
        ? ("bad" as const)
        : undefined;
  while (start < lines.length) {
    const current = tone(lines[start]);
    let end = start + 1;
    while (end < lines.length && tone(lines[end]) === current) end++;
    runs.push({
      start,
      text:
        lines.slice(start, end).join("\n") + (end < lines.length ? "\n" : ""),
      tone: current,
    });
    start = end;
  }
  return runs;
}
