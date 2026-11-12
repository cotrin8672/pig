/** Quote a single installed family so commas and quotes never become CSS syntax. */
export function fontFamilyValue(family: string, fallback: string): string {
  return family
    ? `"${family.replace(/["\\]/g, "\\$&")}", ${fallback}`
    : fallback;
}
