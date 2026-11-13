import type { ThemedToken } from "shiki/core";
import { canHighlight, codeLanguage } from "./syntax-source";

export {
  canHighlight,
  codeLanguage,
  languageFromPath,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHT_LINES,
  terminalText,
} from "./syntax-source";

type Cached = {
  promise: Promise<ThemedToken[][] | undefined>;
  controller: AbortController;
  users: number;
  done: boolean;
  tokens?: ThemedToken[][];
};
const cache = new Map<string, Cached>();
const cacheKey = (text: string, language?: string) =>
  `${codeLanguage(language)}\0${text}`;
export function cachedHighlight(text: string, language?: string) {
  if (!codeLanguage(language) || !canHighlight(text)) return undefined;
  return cache.get(cacheKey(text, language))?.tokens;
}
async function compute(text: string, language: string, signal: AbortSignal) {
  if (typeof window !== "undefined" && typeof window.Worker === "function") {
    try {
      const { syntaxWorker } = await import("./syntax-worker-client");
      return await syntaxWorker.run({ text, language }, signal);
    } catch {
      // Preserve coloring if a host/CSP cannot start workers; normal browsers
      // never compile/tokenize on the input thread. SSR uses the same engine.
      if (signal.aborted) return undefined;
    }
  }
  const { tokenizeCode } = await import("./syntax-engine");
  return signal.aborted ? undefined : tokenizeCode(text, language);
}
export function highlightCode(
  text: string,
  language?: string,
  signal?: AbortSignal,
): Promise<ThemedToken[][] | undefined> {
  const lang = codeLanguage(language);
  if (signal?.aborted || !lang || !text || !canHighlight(text))
    return Promise.resolve(undefined);
  const key = cacheKey(text, lang);
  let entry = cache.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      users: 0,
      done: false,
      promise: Promise.resolve(undefined),
    };
    const created = entry;
    created.promise = compute(text, lang, controller.signal)
      .catch(() => undefined)
      .then((tokens) => {
        created.done = true;
        created.tokens = tokens;
        if (!tokens && cache.get(key) === created) cache.delete(key);
        return tokens;
      });
    cache.set(key, created);
    if (cache.size > 32) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  const current = entry;
  current.users++;
  return new Promise((resolve) => {
    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener("abort", abort);
      current.users--;
      return true;
    };
    const abort = () => {
      if (!release()) return;
      if (!current.users && !current.done) {
        current.controller.abort();
        if (cache.get(key) === current) cache.delete(key);
      }
      resolve(undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then((tokens) => {
      if (release()) resolve(tokens);
    });
  });
}
