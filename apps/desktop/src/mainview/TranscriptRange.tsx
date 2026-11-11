import { type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { DisclosureContext } from "./LazyDetails";
import { useStore } from "./store";

export const TRANSCRIPT_PAGE_SIZE = 100;

/** One message can itself contain hundreds of calls; record paging is insufficient. */
export function TranscriptRange<T>({
  items,
  children,
  target,
}: {
  items: readonly T[];
  children: (item: T, index: number) => ReactNode;
  target?: { index: number; serial: number };
}) {
  const ja = useStore((s) => s.settings.language === "ja");
  const { pages, scope } = useContext(DisclosureContext);
  const [page, setPage] = useState(() =>
    target
      ? Math.floor(Math.max(0, target.index) / TRANSCRIPT_PAGE_SIZE)
      : (pages?.[scope] ?? 0),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Selecting the same result again must restore its page before focus moves.
  useLayoutEffect(() => {
    if (target && target.index >= 0)
      setPage(Math.floor(target.index / TRANSCRIPT_PAGE_SIZE));
  }, [target?.index, target?.serial]);
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(items.length / TRANSCRIPT_PAGE_SIZE) - 1),
  );
  const start = current * TRANSCRIPT_PAGE_SIZE;
  useLayoutEffect(() => {
    if (pages) pages[scope] = current;
  }, [pages, scope, current]);
  return (
    <>
      {items.length > TRANSCRIPT_PAGE_SIZE && (
        <div className="text-range">
          <span role="status">
            {ja ? "項目" : "Items"} {start + 1}–
            {Math.min(start + TRANSCRIPT_PAGE_SIZE, items.length)} /{" "}
            {items.length}
          </span>{" "}
          <button
            type="button"
            disabled={!start}
            onClick={() => setPage(current - 1)}
          >
            {ja ? "前へ" : "Previous"}
          </button>{" "}
          <button
            type="button"
            disabled={start + TRANSCRIPT_PAGE_SIZE >= items.length}
            onClick={() => setPage(current + 1)}
          >
            {ja ? "次へ" : "Next"}
          </button>
        </div>
      )}
      {items
        .slice(start, start + TRANSCRIPT_PAGE_SIZE)
        .map((item, i) => children(item, start + i))}
    </>
  );
}
