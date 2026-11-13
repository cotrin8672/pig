import type { Root, RootContent } from "hast";
import type { ParsedMarkdown } from "./markdown-engine";

type Cached = {
  controller: AbortController;
  users: number;
  done: boolean;
  promise: Promise<ParsedMarkdown | undefined>;
  value?: ParsedMarkdown;
};
const cache = new Map<string, Cached>();
function trim() {
  const size = (source: string, entry: Cached) =>
    source.length * 2 + (entry.value?.nodes ?? 0) * 128;
  let weight = [...cache].reduce(
    (total, [source, entry]) => total + size(source, entry),
    0,
  );
  while (cache.size && (cache.size > 8 || weight > 8 * 1024 * 1024)) {
    const [source, entry] = cache.entries().next().value as [string, Cached];
    cache.delete(source);
    weight -= size(source, entry);
  }
}
export const cachedMarkdown = (text: string) => cache.get(text)?.value;
// Plain prose needs no parser/KaTeX. Keep exact paragraph geometry immediately,
// including soft breaks, so a cold worker cannot shift a plain-text conversation.
export function plainMarkdown(text: string): Root | undefined {
  if (/^[ \t\r\n]*$/.test(text)) return { type: "root", children: [] };
  if (
    !/^[\p{L}\p{M}\p{N} ,.!?…（）()。、！？'"\n-]+$/u.test(text) ||
    /www\.|^\d+[.)](?: |$)|^-/im.test(text)
  )
    return undefined;
  const content = text.replace(/^\n+|\n+$/g, "");
  if (content.split("\n").some((line) => line && line !== line.trim()))
    return undefined;
  const children: RootContent[] = [];
  let offset = text.indexOf(content);
  for (const part of content.split(/\n\n+/)) {
    const start = text.indexOf(part, offset);
    if (children.length) children.push({ type: "text", value: "\n" });
    children.push({
      type: "element",
      tagName: "p",
      properties: {},
      position: {
        start: { line: 1, column: 1, offset: start },
        end: { line: 1, column: part.length + 1, offset: start + part.length },
      },
      children: [{ type: "text", value: part }],
    });
    offset = start + part.length;
  }
  return { type: "root", children };
}
export const browserMarkdown = () =>
  typeof window !== "undefined" && typeof window.Worker === "function";
export async function prepareMarkdown(
  text: string,
  signal?: AbortSignal,
): Promise<ParsedMarkdown | undefined> {
  if (signal?.aborted) return undefined;
  let entry = cache.get(text);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      users: 0,
      done: false,
      promise: Promise.resolve(undefined),
    };
    const current = entry;
    current.promise = (async () => {
      if (browserMarkdown()) {
        try {
          const { markdownWorker } = await import("./markdown-worker-client");
          return await markdownWorker.run({ text }, controller.signal);
        } catch {
          if (controller.signal.aborted) return undefined;
        }
      }
      const { parseMarkdown } = await import("./markdown-engine");
      return controller.signal.aborted ? undefined : parseMarkdown(text);
    })().then(
      (value) => {
        current.done = true;
        current.value = value;
        trim();
        return value;
      },
      (error) => {
        current.done = true;
        if (cache.get(text) === current) cache.delete(text);
        throw error;
      },
    );
    cache.set(text, current);
    trim();
  }
  const current = entry;
  current.users++;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      current.users--;
      signal?.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!release()) return;
      if (!current.done && !current.users) {
        current.controller.abort();
        if (cache.get(text) === current) cache.delete(text);
      }
      resolve(undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then(
      (value) => {
        if (release()) resolve(value);
      },
      (error) => {
        if (release()) reject(error);
      },
    );
  });
}

/** Keep complete, unchanged blocks mounted while a newer parse is pending.
 * Changed/unparsed source remains visible as escaped text, never stale content. */
export function retainedMarkdown(
  text: string,
  previous?: { text: string; tree: Root },
): { tree?: Root; tail: string } {
  if (!previous) return { tail: text };
  let prefix = 0;
  while (
    prefix < text.length &&
    prefix < previous.text.length &&
    text[prefix] === previous.text[prefix]
  )
    prefix++;
  if (text === previous.text) return { tree: previous.tree, tail: "" };
  const appending = prefix === previous.text.length;
  const last = previous.tree.children.at(-1);
  // Keep the same paragraph/inline DOM when a streamed suffix is still on its
  // current line; never push it outside the paragraph into a new visual line.
  if (
    appending &&
    last?.type === "element" &&
    last.tagName === "p" &&
    last.position?.end.offset === prefix &&
    !text.slice(prefix).includes("\n")
  ) {
    return {
      tree: {
        ...previous.tree,
        children: [
          ...previous.tree.children.slice(0, -1),
          {
            ...last,
            children: [
              ...last.children,
              { type: "text", value: text.slice(prefix) },
            ],
          },
        ],
      },
      tail: "",
    };
  }
  // A changed fenced-code body can be updated without reparsing Markdown.
  // Keep the existing pre/code components (and their selected/highlighted DOM).
  let suffix = 0;
  while (
    suffix < text.length - prefix &&
    suffix < previous.text.length - prefix &&
    text[text.length - 1 - suffix] ===
      previous.text[previous.text.length - 1 - suffix]
  )
    suffix++;
  const oldEnd = previous.text.length - suffix;
  const delta = text.length - previous.text.length;
  for (let index = 0; index < previous.tree.children.length; index++) {
    const node = previous.tree.children[index];
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (
      start === undefined ||
      end === undefined ||
      start > prefix ||
      end < oldEnd ||
      node.type !== "element" ||
      node.tagName !== "pre"
    )
      continue;
    const code = node.children[0];
    if (code?.type !== "element" || code.tagName !== "code") continue;
    const oldBlock = previous.text.slice(start, end);
    const opening = /^( {0,3})(`{3,}|~{3,})[^\n]*\n/.exec(oldBlock);
    const block = text.slice(start, end + delta);
    if (
      !opening ||
      !block.startsWith(opening[0]) ||
      prefix < start + opening[0].length
    )
      continue;
    const marker = opening[2][0],
      minimum = opening[2].length;
    const rawBody = block.slice(opening[0].length);
    const closing = new RegExp(
      `^ {0,3}${marker}{${minimum},}[\\t ]*(?:\\r?\\n|$)`,
      "m",
    ).exec(rawBody);
    const atEnd =
      index === previous.tree.children.length - 1 &&
      end === previous.text.length;
    if (
      (!closing && !atEnd) ||
      (closing &&
        closing.index + closing[0].length < rawBody.length &&
        !appending)
    )
      continue;
    let body = rawBody
      .slice(0, closing?.index ?? rawBody.length)
      .replace(/\r\n?/g, "\n");
    const indent = (node.position?.start.column ?? 1) - 1 + opening[1].length;
    if (indent) {
      if (indent > 3 || /^[ \t]*\t/m.test(body)) continue;
      body = body.replace(new RegExp(`^ {0,${indent}}`, "gm"), "");
    }
    if (body && !body.endsWith("\n")) body += "\n";
    const children = [...previous.tree.children];
    children[index] = {
      ...node,
      children: [{ ...code, children: [{ type: "text", value: body }] }],
    };
    const tail =
      appending && closing
        ? text.slice(
            start + opening[0].length + closing.index + closing[0].length,
          )
        : "";
    return { tree: { ...previous.tree, children }, tail };
  }
  const children: RootContent[] = [];
  let end = 0;
  for (const node of previous.tree.children) {
    const offset = node.position?.end.offset;
    if (offset === undefined || offset > prefix) break;
    children.push(node);
    end = offset;
  }
  return {
    tree: children.length ? { type: "root", children } : undefined,
    tail: text.slice(end),
  };
}
