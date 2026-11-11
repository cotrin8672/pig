import { Component, type ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import {
  customPresentation,
  dataText,
  rendererOrFallback,
} from "./custom-data";
import { useT } from "./i18n";

function BasicRecord({
  record,
  images,
}: {
  record: TranscriptRecord;
  images?: ReactNode;
}) {
  const t = useT();
  const view = customPresentation(record);
  if (view.hidden) return null;
  const blocks = Array.isArray(view.content) ? view.content : [view.content];
  return (
    <section className="custom-record">
      <small>
        {view.label === "Cancelled queued prompt" ? t.Cancelled : view.label}
      </small>
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
class RendererBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
/** Renderer failures retain the message body without exposing internal records. */
export function RecordData({
  record,
  renderer,
  images,
}: {
  record: TranscriptRecord;
  renderer?: (record: TranscriptRecord) => ReactNode;
  images?: ReactNode;
}) {
  const fallback = <BasicRecord record={record} images={images} />;
  return (
    <RendererBoundary
      key={`${record.id}:${record.rendererKey ?? "basic"}`}
      fallback={fallback}
    >
      {rendererOrFallback(
        renderer ? () => renderer(record) : undefined,
        () => fallback,
      )}
    </RendererBoundary>
  );
}
