import {
  createContext,
  Fragment,
  memo,
  type ReactNode,
  startTransition,
  useContext,
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
  SyntaxRangesContext,
  SyntaxText,
  syntaxRangesAvailable,
} from "./SyntaxText";
import {
  cachedHighlight,
  canHighlight,
  codeLanguage,
  highlightCode,
  languageFromPath,
  terminalText,
} from "./syntax-highlighting";
import { codeRuns, sameTokens, terminalRuns, tokenRuns } from "./token-runs";

export const SavedOutputContext = createContext(false);

function renderToken(
  key: string | number,
  token: Pick<ThemedToken, "color" | "bgColor" | "fontStyle">,
  children: ReactNode,
  plain = false,
) {
  if (plain) return <Fragment key={key}>{children}</Fragment>;
  return (
    <span
      key={key}
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
      {children}
    </span>
  );
}

function plainToken(
  token: Pick<ThemedToken, "color" | "bgColor" | "fontStyle">,
  whitespace: boolean,
) {
  return !token.bgColor && !token.fontStyle && (!token.color || whitespace);
}

function useHighlightedLines(text: string, language?: string) {
  const saved = useContext(SavedOutputContext);
  const [result, setResult] = useState<HighlightSnapshot | undefined>(() => {
    const tokens = cachedHighlight(text, language, saved);
    return tokens ? { text, language, tokens } : undefined;
  });
  useEffect(() => {
    const controller = new AbortController();
    void highlightCode(text, language, controller.signal, saved).then((tokens) => {
      if (!controller.signal.aborted && tokens)
        startTransition(() => setResult({ text, language, tokens }));
    });
    return () => controller.abort();
  }, [text, language, saved]);
  // Prefer exact tokens; while loading, retain only text that is still unchanged.
  return (
    cachedHighlight(text, language, saved) ??
    (result?.text === text && result.language === language
      ? result.tokens
      : retainedHighlight(text, language, result))
  );
}

const TokenLine = memo(
  function TokenLine({
    tokens,
    text,
    compact = false,
  }: {
    tokens?: ThemedToken[];
    text: string;
    compact?: boolean;
  }) {
    if (!tokens) return text;
    return tokenRuns(tokens).map((token, index) =>
      renderToken(
        index,
        token,
        token.content,
        compact && plainToken(token, !token.content.trim()),
      ),
    );
  },
  (previous, next) =>
    previous.text === next.text &&
    previous.compact === next.compact &&
    sameTokens(previous.tokens, next.tokens),
);

/** Inline contents only: callers keep their original pre/code and scrolling. */
export const CodeText = memo(function CodeText({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  const saved = useContext(SavedOutputContext);
  const enabled = useContext(SyntaxRangesContext);
  const [ranges] = useState(
    () =>
      enabled &&
      !!codeLanguage(language) &&
      canHighlight(text) &&
      syntaxRangesAvailable(),
  );
  // Never switch a mounted streaming output to a different DOM representation.
  const [compact] = useState(saved);
  const tokens = useHighlightedLines(text, language);
  if (ranges)
    return (
      <SyntaxText
        text={codeLanguage(language) === "ansi" ? terminalText(text) : text}
        tokens={tokens}
      />
    );
  if (!tokens) return text;
  if (compact)
    return codeRuns(text, tokens).map((run) =>
      renderToken(
        run.key,
        run,
        run.parts.map((part) => (
          <Fragment key={part.key}>{part.text}</Fragment>
        )),
        plainToken(
          run,
          run.parts.every((part) => !part.text.trim()),
        ),
      ),
    );
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
    compact,
    highlighted,
  }: {
    line: DiffLine;
    tokens?: ThemedToken[];
    newline: boolean;
    compact: boolean;
    highlighted: boolean;
  }) {
    const enabled = useContext(SyntaxRangesContext);
    const [ranges] = useState(
      () => enabled && highlighted && syntaxRangesAvailable(),
    );
    return (
      <>
        <span className={line.tone ?? ""}>
          {line.prefix}
          {ranges ? (
            <SyntaxText
              text={line.text}
              tokens={tokens ? [tokens] : undefined}
            />
          ) : (
            <TokenLine tokens={tokens} text={line.text} compact={compact} />
          )}
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
    a.compact === b.compact &&
    a.highlighted === b.highlighted &&
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
  const saved = useContext(SavedOutputContext);
  const [compact] = useState(saved);
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
        compact={compact}
        highlighted={!!language}
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
