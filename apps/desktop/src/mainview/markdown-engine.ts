import type { Root } from "hast";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownUrl } from "./markdown-url";

export type ParsedMarkdown = { tree: Root; nodes: number };

/** Use react-markdown's own processor and post-processing, including URL/raw-HTML
 * safety. Only the serializable HAST crosses the worker boundary, never HTML. */
export function parseMarkdown(text: string): ParsedMarkdown {
  let tree: Root | undefined;
  ReactMarkdown({
    children: text,
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeKatex, { throwOnError: false }],
      () => (value: Root) => {
        tree = value;
      },
    ],
    urlTransform: markdownUrl,
  });
  if (!tree) throw new Error("Markdown processor returned no tree");
  let nodes = 0;
  const visit = (node: { children?: unknown[] }) => {
    nodes++;
    for (const child of node.children ?? [])
      visit(child as { children?: unknown[] });
  };
  visit(tree);
  return { tree, nodes };
}
