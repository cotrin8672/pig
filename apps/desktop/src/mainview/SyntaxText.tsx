import { createContext, memo, useLayoutEffect, useMemo, useRef } from "react";
import type { ThemedToken } from "shiki/core";
import { registerSyntaxPaint } from "./syntax-paint";
import { syntaxLines, syntaxParts, updateSyntaxText } from "./syntax-text";
import { sameTokens } from "./token-runs";

// Trusted custom renderers keep their original representation.
export const SyntaxRangesContext = createContext(true);
export const syntaxRangesAvailable = () =>
  typeof CSS !== "undefined" &&
  "highlights" in CSS &&
  typeof Highlight === "function";

const SyntaxPart = memo(function SyntaxPart({
  text,
  style,
  line,
}: {
  text: string;
  style?: ThemedToken;
  line: number;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const node = useRef<Text | undefined>(undefined);
  useLayoutEffect(() => {
    if (!element.current) return;
    if (!node.current) {
      node.current = document.createTextNode(text);
      element.current.append(node.current);
    } else updateSyntaxText(node.current, text);
  }, [text]);
  const flags = style?.fontStyle ?? 0;
  return (
    <span
      ref={element}
      data-syntax-line={line}
      className={
        style
          ? [
              "syntax-token",
              flags & 1 ? "syntax-italic" : "",
              flags & 2 ? "syntax-bold" : "",
              flags & 4 ? "syntax-underline" : "",
              flags & 8 ? "syntax-strike" : "",
            ]
              .filter(Boolean)
              .join(" ")
          : "syntax-text"
      }
      style={
        style
          ? { color: style.color, backgroundColor: style.bgColor }
          : undefined
      }
    />
  );
});

const SyntaxLine = memo(
  function SyntaxLine({
    text,
    newline,
    tokens,
    index,
  }: {
    text: string;
    newline: boolean;
    tokens?: ThemedToken[];
    index: number;
  }) {
    return (
      <>
        {syntaxParts(text, tokens).map((part, indexInLine) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Font runs retain their ordered slots within one source line.
          <SyntaxPart key={indexInLine} {...part} line={index} />
        ))}
        {newline ? "\n" : ""}
      </>
    );
  },
  (a, b) =>
    a.text === b.text &&
    a.newline === b.newline &&
    a.index === b.index &&
    sameTokens(a.tokens, b.tokens),
);

/** Own only the text leaves; React continues to own all surrounding UI/state. */
export function SyntaxText({
  text,
  tokens,
}: {
  text: string;
  tokens?: (ThemedToken[] | undefined)[];
}) {
  const element = useRef<HTMLSpanElement>(null);
  const painter = useRef<ReturnType<typeof registerSyntaxPaint> | undefined>(
    undefined,
  );
  const lines = useMemo(() => syntaxLines(text), [text]);
  useLayoutEffect(() => {
    if (!element.current) return;
    const current = registerSyntaxPaint(element.current);
    painter.current = current;
    return () => {
      current.dispose();
      painter.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    painter.current?.update(lines, tokens);
  }, [lines, tokens]);
  return (
    <span ref={element} className="syntax-source">
      {lines.map((line, index) => (
        <SyntaxLine
          // biome-ignore lint/suspicious/noArrayIndexKey: Source line slots remain stable while streaming.
          key={index}
          {...line}
          tokens={tokens?.[index]}
          index={index}
        />
      ))}
    </span>
  );
}
