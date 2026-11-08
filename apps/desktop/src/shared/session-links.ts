export function sessionLink(id: string) {
  return `pig://session/${encodeURIComponent(id)}`;
}
export function sessionIdFromLink(value: string): string | undefined {
  try {
    // Match before URL normalization can erase traversal or empty query/fragment markers.
    const match = /^pig:\/\/session\/([^/?#]+)$/i.exec(value.trim());
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    if (
      !id ||
      id === "." ||
      id === ".." ||
      id.length > 128 ||
      /[\\/\p{Cc}\s]/u.test(id)
    )
      return;
    return id;
  } catch {
    return;
  }
}
