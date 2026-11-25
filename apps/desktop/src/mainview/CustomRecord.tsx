import type { ChatRendererProps } from "@pig/chat-renderers";
import type { ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { ChatContent } from "./ChatContent";
import { CompactionRecord } from "./CompactionRenderer";
import { customImageSources, customPresentation } from "./custom-data";
import { ImageGallery } from "./ImageGallery";
import { RecordData } from "./RecordData";
import { InboundMessage } from "./SenderBubble";

export function BuiltinCustomRecord({ data }: ChatRendererProps<"custom">) {
  const record = data.raw as TranscriptRecord;
  const images = <ImageGallery sources={customImageSources(data.content)} />;
  // Extension messages reach the agent like a prompt; draw them as one.
  if (record.kind === "message" && record.message.role === "custom")
    return <InboundMessage record={record} images={images} />;
  return <RecordData record={record} images={images} />;
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
  if (record.kind === "session-entry" && record.entryType === "compaction")
    return <CompactionRecord record={record} />;
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
