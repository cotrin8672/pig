import type { ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { customPresentation, dataText } from "./custom-data";

export function RecordData({
  record,
  images,
}: {
  record: TranscriptRecord;
  images?: ReactNode;
}) {
  const view = customPresentation(record);
  if (view.hidden) return null;
  const blocks = Array.isArray(view.content) ? view.content : [view.content];
  return (
    <section className="custom-record">
      <small>{view.label}</small>
      {images}
      {blocks.map((block, index) => {
        if (block == null || block?.type === "image") return null;
        const text =
          typeof block === "string"
            ? block
            : block?.type === "text" && typeof block.text === "string"
              ? block.text
              : undefined;
        return text !== undefined ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Content blocks retain their indexes.
          <p key={index} style={{ whiteSpace: "pre-wrap" }}>
            {text}
          </p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Content blocks retain their indexes.
          <pre key={index}>{dataText(block, true)}</pre>
        );
      })}
    </section>
  );
}
