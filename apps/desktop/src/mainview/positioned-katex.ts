import type { Element, Root, RootContent } from "hast";
import rehypeKatex from "rehype-katex";

declare module "hast" {
  interface ElementData {
    pendingMath?: true;
    hasPendingMath?: true;
  }
  interface RootData {
    hasPendingMath?: true;
  }
}

const classes = (node: Element) =>
  Array.isArray(node.properties.className) ? node.properties.className : [];

/** Whether a fenced block's closing fence is in the source (EOF is not one). */
export function complete(scope: Element, math: Element, source: string) {
  if (classes(math).includes("math-inline")) return true;
  const start = scope.position?.start.offset;
  const end = scope.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const lines = source.slice(start, end).split(/\r\n?|\n/);
  const opening = /^(\${2,}|`{3,}|~{3,})/.exec(lines[0]);
  const last = lines.at(-1) ?? "";
  const closing = /^[>\t ]*(\${2,}|`{3,}|~{3,})[\t ]*$/.exec(last);
  if (
    !opening ||
    !closing ||
    opening[1][0] !== closing[1][0] ||
    opening[1].length > closing[1].length
  )
    return false;
  const value = math.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "");
  // A delimiter-looking line inside an open container is still equation text.
  // Require the parser to have excluded both fence lines from its body.
  const bodyLines = value.split(/\r\n?|\n/);
  return (
    lines.length > (value ? bodyLines.length : 0) + 1 &&
    bodyLines.at(-1)?.trim() !== last.trim()
  );
}

/** KaTeX replaces pre/code and loses its Markdown position. Restore only
 * completed source ranges; EOF is not a closing fence for a growing equation. */
export function positionedKatex({
  streaming = false,
  cache,
}: {
  streaming?: boolean;
  cache?: Map<string, RootContent[]>;
} = {}) {
  const transform = rehypeKatex();
  return (tree: Root, file: Parameters<typeof transform>[1]) => {
    const source = String(file.value);
    // Keep the first eligible formulas from this parse. FIFO would evict all
    // hits on every append when a document contains more than 32 distinct ones.
    const next = cache && new Map<string, RootContent[]>();
    const visit = (parent: Root | Element): boolean => {
      const children: RootContent[] = parent.children;
      let pending = false;
      for (let index = 0; index < children.length; index++) {
        const node = children[index];
        if (node.type !== "element") continue;
        const math = node.tagName === "pre" ? node.children[0] : node;
        if (
          math?.type !== "element" ||
          !classes(math).some((name) =>
            ["language-math", "math-display", "math-inline"].includes(
              String(name),
            ),
          )
        ) {
          pending = visit(node) || pending;
          continue;
        }
        const closed = complete(node, math, source);
        if (
          streaming &&
          !closed &&
          node.position?.start.offset !== undefined &&
          node.position.end.offset !== undefined
        ) {
          children[index] = {
            type: "element",
            tagName: "span",
            properties: { className: ["markdown-pending-source"] },
            data: { pendingMath: true, position: {} },
            position: node.position,
            children: [
              {
                type: "text",
                value: source.slice(
                  node.position.start.offset,
                  node.position.end.offset,
                ),
              },
            ],
          };
          pending = true;
          continue;
        }
        const fragment: Root = { type: "root", children: [node] };
        const position = closed ? node.position : undefined;
        const literal =
          math.children.length === 1 && math.children[0].type === "text"
            ? math.children[0].value
            : undefined;
        const key =
          cache && closed && literal !== undefined && literal.length <= 512
            ? JSON.stringify([
                node.tagName,
                math.tagName,
                classes(math),
                literal,
              ])
            : undefined;
        const hit = key && (next?.get(key) ?? cache?.get(key));
        if (hit && next) {
          fragment.children = structuredClone(hit);
          if (next.size < 32) next.set(key, hit);
        } else {
          const messages = file.messages.length;
          transform(fragment, file);
          if (
            next &&
            next.size < 32 &&
            key &&
            fragment.children[0] !== node &&
            messages === file.messages.length &&
            JSON.stringify(fragment.children).length <= 16384
          ) {
            next.set(key, structuredClone(fragment.children));
          }
        }
        for (const rendered of fragment.children) rendered.position = position;
        children.splice(index, 1, ...fragment.children);
        index += fragment.children.length - 1;
      }
      if (pending) parent.data = { ...parent.data, hasPendingMath: true };
      return pending;
    };
    visit(tree);
    if (cache && next) {
      cache.clear();
      for (const [key, nodes] of next) cache.set(key, nodes);
    }
  };
}
