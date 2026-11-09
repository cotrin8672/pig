import type { ReactNode } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { customImageSources, customPresentation } from "./custom-data";
import { ImageGallery } from "./ImageGallery";
import { RecordData } from "./RecordData";

/** Optional UI renderers never gate basic data or the existing GUI image gallery. */
export function CustomRecord({
  record,
  renderer,
}: {
  record: TranscriptRecord;
  renderer?: (record: TranscriptRecord) => ReactNode;
}) {
  return (
    <RecordData
      record={record}
      renderer={renderer}
      images={
        <ImageGallery
          sources={customImageSources(customPresentation(record).content)}
        />
      }
    />
  );
}
