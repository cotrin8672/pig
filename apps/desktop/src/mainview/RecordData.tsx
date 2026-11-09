import { Component, type ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import {
  customPresentation,
  dataText,
  rendererOrFallback,
} from "./custom-data";

function BasicRecord({
  record,
  images,
}: {
  record: TranscriptRecord;
  images?: ReactNode;
}) {
  const view = customPresentation(record);
  return (
    <details className="custom-record" open={!view.hidden}>
      <summary>
        {view.label}{" "}
        <small>
          {record.entryId ? "saved" : "live"}
          {view.hidden ? " · hidden content / metadata" : ""}
        </small>
      </summary>
      {images}
      <pre>{dataText(view.content)}</pre>
      {view.details !== undefined && (
        <details>
          <summary>Details</summary>
          <pre>{dataText(view.details)}</pre>
        </details>
      )}
      <details>
        <summary>Raw record · {record.entryId ?? record.id}</summary>
        <pre>{dataText(record)}</pre>
      </details>
    </details>
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
/** Renderer-independent, inert basic data is mandatory for saved AND live records. */
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
