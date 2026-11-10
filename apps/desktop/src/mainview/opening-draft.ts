import type { DraftContent } from "../shared/runtime-contract";

/** Keep startup extension content as well as text entered before the session was ready. */
export function mergeOpeningText(
  content: DraftContent,
  text: string,
): DraftContent {
  return {
    ...content,
    text:
      content.text && text ? `${content.text}\n${text}` : content.text || text,
  };
}
