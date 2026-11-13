import { createHighlighterCore, type HighlighterCore } from "shiki/core";
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
  ruby,
  rust,
  go,
  java,
  c,
  cpp,
  csharp,
  sql,
  diff,
  dockerfile,
};
let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<Language, Promise<void>>();
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
export async function tokenizeCode(text: string, language?: string) {
  const lang = codeLanguage(language);
  if (!lang || !text || !canHighlight(text)) return undefined;
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
      tokenizeTimeLimit: 0,
    },
  );
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
