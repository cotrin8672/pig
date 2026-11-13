// Retain Nord's lexical scopes, not its fixed palette. Variables let a theme
// change recolour already-tokenized/cached/worker output without parsing again.
const roles: Record<string, string> = {
  "#81a1c1": "keyword",
  "#5e81ac": "keyword",
  "#88c0d0": "function",
  "#8fbcbb": "type",
  "#a3be8c": "string",
  "#b48ead": "number",
  "#616e88": "comment",
  "#ebcb8b": "constant",
  "#d08770": "decorator",
  "#d8dee9": "text",
  "#eceff4": "text",
};
export function syntaxThemeColor(color?: string) {
  if (!color) return color;
  const normalized = color.toLowerCase().replace(/^(#[\da-f]{6})ff$/, "$1");
  if (normalized === "#bf616a") return `var(--ds-error, ${color})`;
  const role = roles[normalized];
  return role ? `var(--ds-syntax-${role}, ${color})` : color;
}
