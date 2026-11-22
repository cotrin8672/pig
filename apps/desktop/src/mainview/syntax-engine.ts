import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import dockerfile from "shiki/langs/dockerfile.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsonc from "shiki/langs/jsonc.mjs";
import jsx from "shiki/langs/jsx.mjs";
import julia from "shiki/langs/julia.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import markdown from "shiki/langs/markdown.mjs";
import powershell from "shiki/langs/powershell.mjs";
import python from "shiki/langs/python.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import nord from "shiki/themes/nord.mjs";
import {
  canHighlight,
  codeLanguage,
  type Language,
  terminalText,
} from "./syntax-source";
import { syntaxThemeColor } from "./syntax-theme";

// Static grammar data makes the worker a self-contained blob (also on views://).
// Regex compilation still happens only for the requested language, off the UI thread.
const languages = {
  javascript,
  typescript,
  jsx,
  tsx,
  json,
  jsonc,
  html,
  css,
  markdown,
  yaml,
  toml,
  shellscript,
  powershell,
  python,
  julia,
  ruby,
  rust,
  go,
  java,
  kotlin,
  c,
  cpp,
  csharp,
  sql,
  diff,
  dockerfile,
};
let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<Language, Promise<void>>();
let grammarRevision = 0;
function getHighlighter() {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [nord],
    langs: [],
  }).catch((error) => {
    highlighter = undefined;
    throw error;
  });
  return highlighter;
}
function normalizeTokens(
  tokens: ThemedToken[][],
  text: string,
  lang: Language | "ansi",
  instance: HighlighterCore,
  offset = 0,
) {
  if (lang === "ansi") {
    const foreground = instance.getTheme("nord").fg;
    for (const line of tokens)
      for (const token of line)
        if (token.color === foreground) token.color = undefined;
  } else {
    // Explicit ANSI colours (including truecolor) are deliberately untouched.
    for (const line of tokens)
      for (const token of line) {
        token.color = syntaxThemeColor(token.color);
        token.bgColor = syntaxThemeColor(token.bgColor);
        token.offset += offset;
      }
  }
  const lines = (lang === "ansi" ? terminalText(text) : text).split("\n");
  if (tokens.length !== lines.length) return undefined;
  for (let i = 0; i < lines.length; i++) {
    const content = tokens[i].map((token) => token.content).join("");
    if (lines[i].endsWith("\r") && content === lines[i].slice(0, -1))
      tokens[i].push({ content: "\r", offset: 0 });
    else if (content !== lines[i]) return undefined;
  }
  return tokens;
}

type Checkpoint = {
  lang: Language;
  revision: number;
  prefix: string;
  tokens: ThemedToken[][];
  state: GrammarState;
};

/** One previous complete-line prefix, local to this worker (or SSR tokenizer).
 * Keep the unfinished last line out: its lexical state may still change. */
export function createCodeTokenizer() {
  let checkpoint: Checkpoint | undefined;
  return async (text: string, language?: string) => {
    const lang = codeLanguage(language);
    if (!lang || !text || !canHighlight(text)) {
      checkpoint = undefined;
      return undefined;
    }
    const instance = await getHighlighter();
    if (lang !== "ansi") {
      let loaded = loading.get(lang);
      if (!loaded) {
        loaded = instance
          .loadLanguage(languages[lang])
          .then(() => {
            // A newly registered grammar can affect embedded/injected rules.
            grammarRevision++;
          })
          .catch((error) => {
            loading.delete(lang);
            throw error;
          });
        loading.set(lang, loaded);
      }
      await loaded;
    }
    const options = {
      lang,
      theme: "nord",
      tokenizeMaxLineLength: 2_000,
      tokenizeTimeLimit: 0,
    };
    const previous = checkpoint;
    // A failed/invalid computation must not publish a partly advanced checkpoint.
    checkpoint = undefined;
    const complete = text.lastIndexOf("\n") + 1;
    if (lang === "ansi" || !complete)
      return normalizeTokens(
        instance.codeToTokensBase(
          lang === "ansi" ? terminalText(text, true) : text,
          options,
        ),
        text,
        lang,
        instance,
      );

    let next =
      previous?.lang === lang &&
      previous.revision === grammarRevision &&
      text.startsWith(previous.prefix)
        ? previous
        : undefined;
    const start = next?.prefix.length ?? 0;
    if (complete > start) {
      const part = text.slice(start, complete);
      // Include LF (and CRLF) intact. Shiki's final empty line does not advance
      // grammar state; discard only that extra token row, not source characters.
      const raw = instance.codeToTokensBase(part, {
        ...options,
        grammarState: next?.state,
      });
      const state = instance.getLastGrammarState(raw);
      const tokens = normalizeTokens(raw, part, lang, instance, start);
      if (!tokens) return undefined;
      if (!state)
        return normalizeTokens(
          instance.codeToTokensBase(text, options),
          text,
          lang,
          instance,
        );
      next = {
        lang,
        revision: grammarRevision,
        prefix: text.slice(0, complete),
        tokens: [...(next?.tokens ?? []), ...tokens.slice(0, -1)],
        state,
      };
    }
    if (!next) throw new Error("Missing syntax prefix state");
    const tail = text.slice(complete);
    const tokens = normalizeTokens(
      instance.codeToTokensBase(tail, {
        ...options,
        grammarState: next.state,
      }),
      tail,
      lang,
      instance,
      complete,
    );
    if (!tokens) return undefined;
    checkpoint = next;
    return [...next.tokens, ...tokens];
  };
}

export const tokenizeCode = createCodeTokenizer();
