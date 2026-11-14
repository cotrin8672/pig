import { FileText } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { grepPattern, type parseGrepOutput } from "../shared/grep-output";
import "./grep.css";

function MatchText({ text, pattern }: { text: string; pattern?: RegExp }) {
  if (!pattern) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    if (!found[0]) continue;
    parts.push(
      text.slice(last, found.index),
      <mark key={found.index}>{found[0]}</mark>,
    );
    last = found.index + found[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** The surrounding ToolRow owns disclosure, search identity and scroll restoration. */
export function GrepOutput({
  result,
  args,
}: {
  result: ReturnType<typeof parseGrepOutput>;
  args: Record<string, unknown>;
}) {
  const { pattern, literal, ignoreCase } = args;
  const expression = useMemo(
    () => grepPattern({ pattern, literal, ignoreCase }),
    [pattern, literal, ignoreCase],
  );
  return (
    <pre className="tool-code tool-grep-output">
      {result.files.map((file) => {
        const parts = file.path.replaceAll("\\", "/").split("/");
        const name = parts.pop();
        return (
          <span className="tool-grep-file" key={file.path}>
            <span className="tool-grep-file-head" title={file.path}>
              <FileText size={12} aria-hidden="true" />
              <strong>{name}</strong>
              <small>{parts.join("/")}</small>
              <span className="tool-grep-count">{file.matches}</span>
            </span>
            {file.lines.map((line, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: Ordered output can repeat line numbers.
                key={index}
                className={`tool-grep-line${line.match ? "" : " tool-grep-context"}`}
              >
                <span className="tool-grep-number">{line.line}</span>
                <code>
                  {line.match ? (
                    <MatchText text={line.text} pattern={expression} />
                  ) : (
                    line.text
                  )}
                </code>
              </span>
            ))}
          </span>
        );
      })}
      {result.notices && (
        <span className="tool-grep-notice">{result.notices}</span>
      )}
    </pre>
  );
}
