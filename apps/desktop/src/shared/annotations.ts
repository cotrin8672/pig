/** A comment on a passage the user selected in an agent response. */
export type DraftAnnotation = { id: string; quote: string; comment: string };

const block = ({ quote, comment }: Omit<DraftAnnotation, "id">) =>
  [
    "<annotation>",
    "<quote>",
    quote,
    "</quote>",
    ...(comment ? ["<comment>", comment, "</comment>"] : []),
    "</annotation>",
  ].join("\n");

/** Annotations lead the prompt as tagged blocks, so the model and the UI can both read them back. */
export const withAnnotations = (
  text: string,
  annotations: readonly Omit<DraftAnnotation, "id">[] = [],
) => [...annotations.map(block), text].filter(Boolean).join("\n\n");

const leading =
  /^<annotation>\n<quote>\n([\s\S]*?)\n<\/quote>\n(?:<comment>\n([\s\S]*?)\n<\/comment>\n)?<\/annotation>(?:\n\n|$)/;

/** Inverse of withAnnotations; text without leading annotation blocks is returned unchanged. */
export function parseAnnotations(text: string) {
  const annotations: Omit<DraftAnnotation, "id">[] = [];
  let body = text;
  for (let match = leading.exec(body); match; match = leading.exec(body)) {
    annotations.push({ quote: match[1], comment: match[2] ?? "" });
    body = body.slice(match[0].length);
  }
  return { annotations, body };
}
