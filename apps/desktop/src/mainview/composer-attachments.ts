import {
  AttachmentReads,
  imageLimitMessage,
  imageSizeMessage,
} from "./attachment-reads";
import { drafts } from "./draft-store";
import { getT } from "./i18n";
import { subscribeOwnership } from "./runtime-events";
import { showError } from "./store";

export const attachmentReads = new AttachmentReads(drafts, (message) =>
  showError(
    message === imageLimitMessage || message === imageSizeMessage
      ? getT()[message]
      : message,
  ),
);
subscribeOwnership((previous, next) =>
  attachmentReads.transfer(previous, next),
);

export function clipboardFiles(data: DataTransfer) {
  const files = Array.from(data.files);
  if (!files.length)
    for (const item of Array.from(data.items)) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  return files;
}

export function discardOpeningAttachments(key: string) {
  for (const read of attachmentReads.read(key)) attachmentReads.cancel(read.id);
  drafts.forgetOpening(key);
}
