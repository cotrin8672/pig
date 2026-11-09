export function sessionLink(id: string) {
  return `pig://session/${encodeURIComponent(id)}`;
}
export function sessionIdFromLink(value: string): string | undefined {
  try {
    if (value.length > 1024) return;
    // Validate before URL normalization can erase traversal/query delimiters.
    const match = /^pig:\/\/session\/([^/?#]+)$/i.exec(value.trim());
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    if (id.length > 128) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) || /^[\d-]+$/.test(id)) return;
    return id;
  } catch {
    return;
  }
}
