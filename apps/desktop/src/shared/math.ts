// Fenced blocks first, then inline code spans; both are left untouched.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

/**
 * remark-math only understands `$…$` / `$$…$$`, and Markdown would otherwise
 * eat the backslash of LaTeX's `\(…\)` / `\[…\]`. Rewrite those delimiters
 * outside code so both styles render.
 */
export function normalizeMath(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return markdown;
  return markdown
    .split(CODE)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(
              /\\\[([\s\S]+?)\\\]/g,
              (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`,
            )
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => `$${tex}$`),
    )
    .join("");
}
