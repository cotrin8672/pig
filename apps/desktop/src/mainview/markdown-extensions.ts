import type { Element, Root } from "hast";
import { complete } from "./positioned-katex";

export const alertKinds = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;
export type AlertKind = (typeof alertKinds)[number];

const ALERT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;
const isElement = (node: unknown): node is Element =>
  (node as Element | undefined)?.type === "element";
const classes = (node: Element) =>
  Array.isArray(node.properties.className) ? node.properties.className : [];

/** GitHub alert: `> [!NOTE]` alone on the blockquote's first line. */
function alert(quote: Element) {
  const first = quote.children.find(isElement);
  const text = first?.tagName === "p" ? first.children[0] : undefined;
  const match = text?.type === "text" ? ALERT.exec(text.value) : null;
  if (!first || text?.type !== "text" || !match) return;
  text.value = text.value.slice(match[0].length);
  if (!text.value) first.children.shift();
  if (!first.children.length)
    quote.children.splice(quote.children.indexOf(first), 1);
  quote.properties.dataAlert = match[1].toLowerCase();
}

/** Marks render-ready Mermaid fences and GitHub alerts. While streaming, a
 * Mermaid fence counts only once its closing fence arrives (EOF is not one),
 * so a growing diagram is never laid out mid-source. */
export function markdownExtensions({
  streaming = false,
}: {
  streaming?: boolean;
} = {}) {
  return (tree: Root, file: { value?: unknown }) => {
    const source = String(file.value ?? "");
    const visit = (children: Root["children"]) => {
      for (const node of children) {
        if (!isElement(node)) continue;
        const code = node.tagName === "pre" ? node.children[0] : undefined;
        if (
          isElement(code) &&
          classes(code).includes("language-mermaid") &&
          (!streaming || complete(node, code, source))
        )
          code.properties.dataMermaid = "";
        if (node.tagName === "blockquote") alert(node);
        visit(node.children);
      }
    };
    visit(tree.children);
  };
}
