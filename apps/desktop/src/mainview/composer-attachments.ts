import { AttachmentReads } from "./attachment-reads";
import { drafts } from "./draft-store";
import { subscribeOwnership } from "./runtime-events";
import { showError } from "./store";

export const attachmentReads = new AttachmentReads(drafts, showError);
subscribeOwnership((previous, next) =>
  attachmentReads.transfer(previous, next),
);
