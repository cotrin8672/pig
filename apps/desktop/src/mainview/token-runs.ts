import type { ThemedToken } from "shiki/core";

type TokenStyle = Pick<ThemedToken, "color" | "bgColor" | "fontStyle">;
const sameStyle = (a: TokenStyle, b: TokenStyle) =>
  a.color === b.color && a.bgColor === b.bgColor && a.fontStyle === b.fontStyle;

type CodeRun = TokenStyle & {
  key: string;
  parts: { key: string; text: string }[];
};

/** Keep separate text leaves so appending a line never replaces an earlier selection. */
export function codeRuns(
  text: string,
  tokens: readonly (readonly ThemedToken[] | undefined)[],
): CodeRun[] {
  const runs: CodeRun[] = [];
  const append = (key: string, value: string, style: TokenStyle) => {
    if (!value) return;
    let run = runs.at(-1);
    if (!run || !sameStyle(run, style)) {
      run = {
        key,
        color: style.color,
        bgColor: style.bgColor,
        fontStyle: style.fontStyle,
        parts: [],
      };
      runs.push(run);
    }
    run.parts.push({ key, text: value });
  };
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = tokens[index] ?? [{ content: lines[index], offset: 0 }];
    for (const [part, token] of tokenRuns(line).entries())
      append(`${index}:${part}`, token.content, token);
    if (index === lines.length - 1) continue;
    const previous = runs.at(-1);
    const next = tokens[index + 1]?.find((token) => token.content);
    // A newline must not acquire a background or decoration from its neighbours.
    const bridge =
      previous &&
      next &&
      !previous.bgColor &&
      !previous.fontStyle &&
      sameStyle(previous, next);
    append(`${index}:newline`, "\n", bridge ? previous : {});
  }
  return runs;
}
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
