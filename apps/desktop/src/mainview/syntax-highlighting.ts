import ansiRegex from "ansi-regex";
import type { HighlighterCore, ThemedToken } from "shiki/core";

// Explicit imports keep the full language/WASM bundles out of the desktop view.
const languages = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
};
type Language = keyof typeof languages;
const aliases: Record<string, Language> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  md: "markdown",
  yml: "yaml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  patch: "diff",
};

export function codeLanguage(language?: string): Language | "ansi" | undefined {
  const name = language?.toLowerCase();
  if (name === "ansi") return name;
  if (name && Object.hasOwn(languages, name)) return name as Language;
  return name && Object.hasOwn(aliases, name) ? aliases[name] : undefined;
}

export function languageFromPath(path: string) {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (/^dockerfile(?:\.|$)/.test(name)) return "dockerfile";
  if (/^\.(?:bashrc|zshrc|profile)$/.test(name)) return "shellscript";
  return codeLanguage(name.includes(".") ? name.split(".").at(-1) : name);
}

const escapes = ansiRegex();
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI parsing requires control codes.
const sgr = /^(?:\u001b\[|\u009b)[\d;]*m$/;
// Hide a partial CSI/OSC suffix until the next streaming snapshot completes it.
const pendingEscape =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI parsing requires control codes.
  /(?:\u001b\][^\u0007\u009c\u001b]*(?:\u001b)?|(?:\u001b\[|\u009b)[0-?]*[ -/]*|\u001b)$/;

/** Terminal output is data, not HTML or terminal cursor instructions. */
export function terminalText(text: string, keepColors = false) {
  return text.replace(pendingEscape, "").replace(escapes, (sequence) =>
    keepColors && sgr.test(sequence)
      ? `\u001b[${sequence
          .slice(sequence.startsWith("\u009b") ? 1 : 2, -1)
          .split(";")
          .map((part) => part || "0")
          .join(";")}m`
      : "",
  );
}

let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<Language, Promise<void>>();
function getHighlighter() {
  highlighter ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/nord.mjs"),
  ])
    .then(
      ([{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme]) =>
        createHighlighterCore({
          engine: createJavaScriptRegexEngine(),
          themes: [theme.default],
          langs: [],
        }),
    )
    .catch((error) => {
      highlighter = undefined;
      throw error;
    });
  return highlighter;
}

// shortcut: very large previews stay complete but plain; use a worker if they need coloring.
export const MAX_HIGHLIGHT_LENGTH = 100_000;
export const MAX_HIGHLIGHT_LINES = 2_000;
export function canHighlight(text: string) {
  return (
    text.length <= MAX_HIGHLIGHT_LENGTH &&
    text.split("\n").length <= MAX_HIGHLIGHT_LINES
  );
}

type Cached = {
  promise: Promise<ThemedToken[][] | undefined>;
  tokens?: ThemedToken[][];
};
// Bounded across sessions and streaming snapshots, not an ever-growing transcript cache.
const cache = new Map<string, Cached>();
const cacheKey = (text: string, language?: string) =>
  `${codeLanguage(language)}\0${text}`;
export function cachedHighlight(text: string, language?: string) {
  if (!codeLanguage(language) || !canHighlight(text)) return undefined;
  return cache.get(cacheKey(text, language))?.tokens;
}

export async function highlightCode(text: string, language?: string) {
  const lang = codeLanguage(language);
  if (!lang || !text || !canHighlight(text)) return undefined;
  const key = cacheKey(text, lang);
  const cached = cache.get(key);
  if (cached) return cached.promise;
  const entry: Cached = {
    promise: (async () => {
      const instance = await getHighlighter();
      if (lang !== "ansi") {
        let loaded = loading.get(lang);
        if (!loaded) {
          loaded = instance.loadLanguage(languages[lang]).catch((error) => {
            loading.delete(lang);
            throw error;
          });
          loading.set(lang, loaded);
        }
        await loaded;
      }
      const tokens = instance.codeToTokensBase(
        lang === "ansi" ? terminalText(text, true) : text,
        {
          lang,
          theme: "nord",
          tokenizeMaxLineLength: 2_000,
          // Cold JS grammar compilation must not cache a half-tokenized first line.
          tokenizeTimeLimit: 0,
        },
      );
      if (lang === "ansi") {
        const foreground = instance.getTheme("nord").fg;
        for (const line of tokens)
          for (const token of line)
            if (token.color === foreground) token.color = undefined;
      }
      // Never let tokenization change copied text, including CRLF or lone-CR sources.
      const lines = (lang === "ansi" ? terminalText(text) : text).split("\n");
      if (tokens.length !== lines.length) return undefined;
      for (let i = 0; i < lines.length; i++) {
        const content = tokens[i].map((token) => token.content).join("");
        if (lines[i].endsWith("\r") && content === lines[i].slice(0, -1))
          tokens[i].push({ content: "\r", offset: 0 });
        else if (content !== lines[i]) return undefined;
      }
      return tokens;
    })().catch(() => {
      cache.delete(key);
      return undefined;
    }),
  };
  cache.set(key, entry);
  if (cache.size > 32) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  entry.tokens = await entry.promise;
  return entry.tokens;
}
