import type { ChatRendererProps } from "@pig/chat-renderers";
import type { ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { ChatContent } from "./ChatContent";
import { customImageSources, customPresentation } from "./custom-data";
import { ImageGallery } from "./ImageGallery";
import { RecordData } from "./RecordData";

export function BuiltinCustomRecord({ data }: ChatRendererProps<"custom">) {
  return (
    <RecordData
      record={data.raw as TranscriptRecord}
      images={<ImageGallery sources={customImageSources(data.content)} />}
    />
  );
}

/** Saved and live extension JSON use the same renderer contract. */
export function CustomRecord({
  record,
  renderer,
}: {
  record: TranscriptRecord;
  renderer?: (record: TranscriptRecord) => ReactNode;
}) {
  const view = customPresentation(record);
  if (renderer)
    return (
      <RecordData
        record={record}
        renderer={renderer}
        images={<ImageGallery sources={customImageSources(view.content)} />}
      />
    );
  return (
    <ChatContent
      kind="custom"
      contentKey={record.id}
      builtin={BuiltinCustomRecord}
      data={{
        id: record.id,
        entryId: record.entryId,
        customType: view.label,
        content: view.content,
        details: view.details,
        raw: record,
      }}
    />
  );
}
