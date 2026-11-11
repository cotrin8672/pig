/** A non-image file already stored by the host; the agent receives only its path. */
export type DraftFile = { id: string; path: string; name: string };

/** Attachment paths follow the text after a blank line, one per line, so extensions can find them. */
export const withAttachmentPaths = (text: string, paths: string[]) =>
  [text, paths.join("\n")].filter(Boolean).join("\n\n");

export const withDraftFiles = (text: string, files: DraftFile[] = []) =>
  withAttachmentPaths(
    text,
    files.map((file) => file.path),
  );
