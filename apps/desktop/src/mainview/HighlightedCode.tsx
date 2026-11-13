import {
  Fragment,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ThemedToken } from "shiki/core";
import {
  type HighlightSnapshot,
  retainedHighlight,
} from "./retained-highlighting";
import {
  cachedHighlight,
  canHighlight,
  highlightCode,
  languageFromPath,
  terminalText,
} from "./syntax-highlighting";
import { sameTokens, terminalRuns, tokenRuns } from "./token-runs";

function useHighlightedLines(text: string, language?: string) {
  const [result, setResult] = useState<HighlightSnapshot | undefined>(() => {
    const tokens = cachedHighlight(text, language);
    return tokens ? { text, language, tokens } : undefined;
  });
  useEffect(() => {
    const controller = new AbortController();
    void highlightCode(text, language, controller.signal).then((tokens) => {
      if (!controller.signal.aborted && tokens)
        startTransition(() => setResult({ text, language, tokens }));
    });
    return () => controller.abort();
  }, [text, language]);
  // Prefer exact tokens; while loading, retain only text that is still unchanged.
  return (
    cachedHighlight(text, language) ??
    (result?.text === text && result.language === language
      ? result.tokens
      : retainedHighlight(text, language, result))
  );
}

const TokenLine = memo(
  function TokenLine({
    tokens,
    text,
  }: {
    tokens?: ThemedToken[];
    text: string;
  }) {
    if (!tokens) return text;
    return tokenRuns(tokens).map((token, index) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: Tokens retain source order.
        key={index}
        className={[
          "syntax-token",
          token.fontStyle && token.fontStyle & 1 ? "syntax-italic" : "",
          token.fontStyle && token.fontStyle & 2 ? "syntax-bold" : "",
          token.fontStyle && token.fontStyle & 4 ? "syntax-underline" : "",
          token.fontStyle && token.fontStyle & 8 ? "syntax-strike" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ color: token.color, backgroundColor: token.bgColor }}
      >
        {token.content}
      </span>
    ));
  },
  (previous, next) =>
    previous.text === next.text && sameTokens(previous.tokens, next.tokens),
);

/** Inline contents only: callers keep their original pre/code and scrolling. */
export const CodeText = memo(function CodeText({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  const tokens = useHighlightedLines(text, language);
  if (!tokens) return text;
  return text.split("\n").map((line, index, lines) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: Source lines are ordered.
    <Fragment key={index}>
      <TokenLine tokens={tokens[index]} text={line} />
      {index < lines.length - 1 ? "\n" : ""}
    </Fragment>
  ));
});

/** Colours only the lines the tool already prefixed with a verdict glyph. */
function lineTone(line: string) {
  const head = line.trimStart()[0];
  if (head === "✓" || head === "✔") return "ok";
  if (head === "✗" || head === "✘" || head === "×") return "bad";
  return undefined;
}

export const TerminalOutput = memo(function TerminalOutput({
  text,
}: {
  text: string;
}) {
  const colored = terminalText(text, true);
  const plain = terminalText(colored);
  const tokens = useHighlightedLines(
    text,
    colored !== plain ? "ansi" : undefined,
  );
  const lines = plain.split("\n");
  // No pending ANSI enhancement can replace these plain log nodes. Preserve
  // every byte/line while avoiding thousands of unstyled wrapper spans.
  if (colored === plain && lines.length > 200)
    return terminalRuns(lines).map((run) => (
      <span key={run.start} className={run.tone}>
        {run.text}
      </span>
    ));
  return lines.map((line, index, lines) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: Output lines retain source order.
      key={index}
      className={lineTone(line)}
    >
      <TokenLine tokens={tokens?.[index]} text={line} />
      {index < lines.length - 1 ? "\n" : ""}
    </span>
  ));
});

type DiffLine = {
  prefix: string;
  text: string;
  tone?: "add" | "del";
  code: boolean;
};
/** Separate gaps/headers so lexical state never leaks between unrelated hunks. */
export function diffHunks(text: string, numbered = false): DiffLine[][] {
  const groups: DiffLine[][] = [];
  let hunk: DiffLine[] = [];
  for (const raw of text.split("\n")) {
    const code = /^[ +-]/.test(raw) && !/^(?:--- |\+\+\+ | *\.\.\.$)/.test(raw);
    const match = code && numbered ? /^([ +-] *\d+ )(.*)$/.exec(raw) : null;
    const line: DiffLine = {
      prefix: code ? (match?.[1] ?? raw[0]) : "",
      text: code ? (match?.[2] ?? raw.slice(1)) : raw,
      tone: raw[0] === "+" ? "add" : raw[0] === "-" ? "del" : undefined,
      code,
    };
    if (!code) {
      if (hunk.length) groups.push(hunk);
      groups.push([line]);
      hunk = [];
    } else hunk.push(line);
  }
  if (hunk.length) groups.push(hunk);
  return groups;
}

const DiffRow = memo(
  function DiffRow({
    line,
    tokens,
    newline,
  }: {
    line: DiffLine;
    tokens?: ThemedToken[];
    newline: boolean;
  }) {
    return (
      <>
        <span className={line.tone ?? ""}>
          {line.prefix}
          <TokenLine tokens={tokens} text={line.text} />
        </span>
        {newline ? "\n" : ""}
      </>
    );
  },
  (a, b) =>
    a.line.prefix === b.line.prefix &&
    a.line.text === b.line.text &&
    a.line.tone === b.line.tone &&
    a.newline === b.newline &&
    sameTokens(a.tokens, b.tokens),
);

function DiffHunk({
  lines,
  language,
  last,
}: {
  lines: DiffLine[];
  language?: string;
  last: boolean;
}) {
  const [beforeText, afterText] = useMemo(
    () => [
      lines
        .filter((line) => line.code && line.tone !== "add")
        .map((line) => line.text)
        .join("\n"),
      lines
        .filter((line) => line.code && line.tone !== "del")
        .map((line) => line.text)
        .join("\n"),
    ],
    [lines],
  );
  const before = useHighlightedLines(beforeText, language);
  const after = useHighlightedLines(afterText, language);
  let oldIndex = 0;
  let newIndex = 0;
  return lines.map((line, index) => {
    const tokens = line.code
      ? line.tone === "del"
        ? before?.[oldIndex]
        : after?.[newIndex]
      : undefined;
    if (line.code && line.tone !== "add") oldIndex++;
    if (line.code && line.tone !== "del") newIndex++;
    return (
      <DiffRow
        // biome-ignore lint/suspicious/noArrayIndexKey: Diff lines retain source order.
        key={index}
        line={line}
        tokens={tokens}
        newline={!last || index < lines.length - 1}
      />
    );
  });
}

export function HighlightedDiff({
  text,
  path = "",
  numbered = false,
}: {
  text: string;
  path?: string;
  numbered?: boolean;
}) {
  const groups = useMemo(() => diffHunks(text, numbered), [text, numbered]);
  const language = canHighlight(text) ? languageFromPath(path) : undefined;
  return (
    <pre className="tool-diff">
      {groups.map((lines, index) => (
        <DiffHunk
          // biome-ignore lint/suspicious/noArrayIndexKey: Hunks retain source order.
          key={index}
          lines={lines}
          language={language}
          last={index === groups.length - 1}
        />
      ))}
    </pre>
  );
}
