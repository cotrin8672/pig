import { type DraftAnnotation, withAnnotations } from "./annotations";

/** A non-image file already stored by the host; the agent receives only its path. */
export type DraftFile = { id: string; path: string; name: string };

/** Only host-managed, content-addressed attachment lines are hidden from the bubble. */
export function splitAttachmentPaths(text: string) {
  const lines = text.split("\n");
  const paths: string[] = [];
  while (
    lines.length &&
    /^(?:[A-Za-z]:[\\/]|\/).*[/\\]attachments[/\\][a-f0-9]{64}(?:\.[a-z0-9]{1,10})?$/i.test(
      lines[lines.length - 1],
    )
  )
    paths.unshift(lines.pop() as string);
  return { body: paths.length ? lines.join("\n").trimEnd() : text, paths };
}

/** Attachment paths follow the text after a blank line, one per line, so extensions can find them. */
export const withAttachmentPaths = (text: string, paths: string[]) =>
  [text, paths.join("\n")].filter(Boolean).join("\n\n");

export const withDraftFiles = (
  text: string,
  files: DraftFile[] = [],
  annotations: DraftAnnotation[] = [],
) =>
  withAttachmentPaths(
    withAnnotations(text, annotations),
    files.map((file) => file.path),
  );
