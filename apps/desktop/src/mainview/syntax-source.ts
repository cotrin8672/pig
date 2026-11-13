import ansiRegex from "ansi-regex";

export const languageNames = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "jsonc",
  "html",
  "css",
  "markdown",
  "yaml",
  "toml",
  "shellscript",
  "powershell",
  "python",
  "ruby",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "sql",
  "diff",
  "dockerfile",
] as const;
export type Language = (typeof languageNames)[number];
const names = new Set<string>(languageNames);
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
  if (name && names.has(name)) return name as Language;
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
const pendingEscape =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Hide incomplete streaming ANSI sequences.
  /(?:\u001b\][^\u0007\u009c\u001b]*(?:\u001b)?|(?:\u001b\[|\u009b)[0-?]*[ -/]*|\u001b)$/;
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
export const MAX_HIGHLIGHT_LENGTH = 100_000;
export const MAX_HIGHLIGHT_LINES = 2_000;
export function canHighlight(text: string) {
  return (
    text.length <= MAX_HIGHLIGHT_LENGTH &&
    text.split("\n").length <= MAX_HIGHLIGHT_LINES
  );
}
