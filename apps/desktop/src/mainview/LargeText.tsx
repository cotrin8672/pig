import { type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { DisclosureContext } from "./LazyDetails";
import { showError, useStore } from "./store";
import { textRange } from "./text-range";

/** Explicit ranges keep huge tool results readable and fully copyable. */
export function LargeText({
  text,
  className,
  render,
}: {
  text: string;
  className?: string;
  render?: (text: string) => ReactNode;
}) {
  const ja = useStore((s) => s.settings.language === "ja");
  const { textRanges, scope } = useContext(DisclosureContext);
  const [starts, setStarts] = useState(() => textRanges?.[scope] ?? [0]);
  const offsets =
    (starts.at(-1) ?? 0) < Math.max(1, text.length) ? starts : [0];
  useLayoutEffect(() => {
    if (textRanges) textRanges[scope] = offsets;
    if (offsets !== starts) setStarts(offsets);
  }, [textRanges, scope, offsets, starts]);
  const range = textRange(text, offsets.at(-1) ?? 0);
  const paged = range.start > 0 || range.end < text.length;
  return (
    <>
      {paged && (
        <div className="text-range">
          <span role="status">
            {ja ? "文字" : "Characters"} {range.start + 1}–{range.end} /{" "}
            {text.length}
          </span>{" "}
          <button
            type="button"
            disabled={!range.start}
            onClick={() => setStarts(offsets.slice(0, -1))}
          >
            {ja ? "前へ" : "Previous"}
          </button>{" "}
          <button
            type="button"
            disabled={range.end === text.length}
            onClick={() => setStarts([...offsets, range.end])}
          >
            {ja ? "次へ" : "Next"}
          </button>{" "}
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(text).catch(showError)
            }
          >
            {ja ? "全文コピー" : "Copy full text"}
          </button>
        </div>
      )}
      {render ? (
        render(range.text)
      ) : (
        <pre className={className}>{range.text}</pre>
      )}
    </>
  );
}
