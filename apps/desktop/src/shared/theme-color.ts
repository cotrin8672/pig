/** Persist the seed, not generated colours; the palette is reproducible locally. */
export const defaultThemeColor = "#8faee8";

export function normalizeThemeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex))
    return `#${[...hex].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}
