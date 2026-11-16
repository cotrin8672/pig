import type { ThemedToken } from "shiki/core";
import { createHighlightCache } from "./highlight-cache";
import { canHighlight, codeLanguage } from "./syntax-source";

export {
  canHighlight,
  codeLanguage,
  languageFromPath,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHT_LINES,
  terminalText,
} from "./syntax-source";

const cache = createHighlightCache(compute);
export function cachedHighlight(text: string, language?: string) {
  const lang = codeLanguage(language);
  if (!lang || !canHighlight(text)) return undefined;
  return cache.peek(text, lang);
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
  return cache.run(text, lang, signal);
}
