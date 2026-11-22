import type { Element, Root, RootContent } from "hast";
import type { ParsedMarkdown } from "./markdown-engine";
import { codeLanguage } from "./syntax-source";

type Cached = {
  controller: AbortController;
  users: number;
  done: boolean;
  promise: Promise<ParsedMarkdown | undefined>;
  value?: ParsedMarkdown;
};
/** Completed parses, bounded below. In-flight parses are shared separately so
 * the budget can never evict one and start a duplicate parse of the same text. */
const cache = new Map<string, Cached>();
const pending = new Map<string, Cached>();
const cacheKey = (text: string, streaming: boolean) =>
  `${streaming ? 1 : 0}\0${text}`;
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
export const cachedMarkdown = (text: string, streaming = false) =>
  cache.get(cacheKey(text, streaming))?.value;
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
  streaming = false,
): Promise<ParsedMarkdown | undefined> {
  if (signal?.aborted) return undefined;
  const key = cacheKey(text, streaming);
  let entry = cache.get(key) ?? pending.get(key);
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
          return await markdownWorker.run(
            { text, streaming },
            controller.signal,
          );
        } catch {
          if (controller.signal.aborted) return undefined;
        }
      }
      const { parseMarkdown } = await import("./markdown-engine");
      return controller.signal.aborted
        ? undefined
        : parseMarkdown(text, streaming);
    })().then(
      (value) => {
        current.done = true;
        current.value = value;
        if (pending.get(key) === current) {
          pending.delete(key);
          if (value) {
            cache.set(key, current);
            trim();
          }
        }
        return value;
      },
      (error) => {
        current.done = true;
        if (pending.get(key) === current) pending.delete(key);
        throw error;
      },
    );
    pending.set(key, current);
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
        if (pending.get(key) === current) pending.delete(key);
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

type OpenCodeFence = {
  text: string;
  tree: Root;
  pre: Element;
  code: Element;
  bodyStart: number;
  closing: RegExp;
};

const codeLiteral = (body: string) =>
  body.endsWith("\n") ? body : `${body}\n`;

/** Seed only from a full parse. No other Markdown block can depend on text
 * appended inside this still-open, top-level literal. */
export function openCodeFence(
  text: string,
  tree: Root,
): OpenCodeFence | undefined {
  const pre = tree.children.at(-1);
  if (pre?.type !== "element" || pre.tagName !== "pre") return;
  const position = pre.position;
  if (
    !position ||
    position.start.column !== 1 ||
    position.start.offset === undefined ||
    position.end.offset !== text.length
  )
    return;
  const code = pre.children[0];
  const literal = code?.type === "element" ? code.children[0] : undefined;
  if (
    code?.type !== "element" ||
    code.tagName !== "code" ||
    code.children.length !== 1 ||
    literal?.type !== "text"
  )
    return;
  // shortcut: simple LF fences only, broaden only with full-parser equivalence.
  const start = position.start.offset;
  const opening = /^(`{3,}|~{3,})[ \t]*([a-z0-9-]+)?[ \t]*\n/i.exec(
    text.slice(start),
  );
  if (!opening || (opening[2] && !codeLanguage(opening[2]))) return;
  const bodyStart = start + opening[0].length;
  const body = text.slice(bodyStart);
  const marker = opening[1];
  const closing = new RegExp(`(?:^|\\n) {0,3}${marker[0]}{${marker.length},}`);
  if (
    !body ||
    body.includes("\r") ||
    body.includes("\0") ||
    closing.test(body) ||
    literal.value !== codeLiteral(body)
  )
    return;
  return { text, tree, pre, code, bodyStart, closing };
}

export function appendOpenCodeFence(
  text: string,
  previous: OpenCodeFence | undefined,
): OpenCodeFence | undefined {
  if (!previous || !text.startsWith(previous.text)) return;
  if (text === previous.text) return previous;
  const added = text.slice(previous.text.length);
  // A closing delimiter can straddle two samples. Even a possible close goes
  // to the parser; it may change earlier references or start new Markdown.
  const lastLine = previous.text.lastIndexOf("\n") + 1;
  if (
    added.includes("\r") ||
    added.includes("\0") ||
    previous.closing.test(text.slice(lastLine))
  )
    return;
  const code: Element = {
    ...previous.code,
    children: [
      { type: "text", value: codeLiteral(text.slice(previous.bodyStart)) },
    ],
  };
  const pre: Element = { ...previous.pre, children: [code] };
  return {
    ...previous,
    text,
    pre,
    code,
    tree: {
      ...previous.tree,
      children: [...previous.tree.children.slice(0, -1), pre],
    },
  };
}

function appendMarkdownText(
  node: RootContent,
  end: number,
  text: string,
): Element | undefined {
  if (node.type !== "element" || node.position?.end.offset !== end)
    return undefined;
  const raw = node.children[0];
  if (node.data?.pendingMath && raw?.type === "text")
    return {
      ...node,
      children: [{ ...raw, value: raw.value + text }],
    };
  let index = node.children.length - 1;
  while (index >= 0 && node.children[index].type !== "element") index--;
  const child = node.children[index];
  const appended = child && appendMarkdownText(child, end, text);
  if (appended)
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === index ? appended : child,
      ),
    };
  if (!/^(?:p|h[1-6]|li)$/.test(node.tagName)) return undefined;
  return {
    ...node,
    children: [...node.children, { type: "text", value: text }],
  };
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
  // Append within the current text block, including nested list/quote prose,
  // rather than temporarily moving the suffix onto a separate visual line.
  const appended =
    appending &&
    last &&
    (!/[\r\n]/.test(text.slice(prefix)) ||
      (last.type === "element" &&
        (last.data?.hasPendingMath || last.data?.pendingMath)))
      ? appendMarkdownText(last, prefix, text.slice(prefix))
      : undefined;
  if (appended)
    return {
      tree: {
        ...previous.tree,
        children: [...previous.tree.children.slice(0, -1), appended],
      },
      tail: "",
    };
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
    // HAST inserts unpositioned newlines between blocks; they do not mark a change.
    if (
      offset === undefined &&
      node.type === "text" &&
      /^\s*$/.test(node.value)
    ) {
      children.push(node);
      continue;
    }
    if (offset === undefined || offset > prefix) break;
    children.push(node);
    end = offset;
  }
  return {
    tree: children.length ? { type: "root", children } : undefined,
    tail: text.slice(end),
  };
}
