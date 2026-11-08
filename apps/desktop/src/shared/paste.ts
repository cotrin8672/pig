const normalize = (text: string) => text.replace(/\r\n/g, "\n");

export function shouldCollapse(text: string): boolean {
  const normalized = normalize(text);
  return normalized.split("\n").length > 10 || normalized.length > 1000;
}

export function makeMarker(id: number, text: string): string {
  const normalized = normalize(text);
  const lines = normalized.split("\n").length;
  return lines > 10
    ? `[paste #${id} +${lines} lines]`
    : `[paste #${id} ${normalized.length} chars]`;
}

export function expandMarkers(
  text: string,
  pastes: ReadonlyMap<number, string>,
): string {
  // A single replace pass never scans the inserted paste contents.
  return text.replace(
    /\[paste #(\d+) (?:\+\d+ lines|\d+ chars)\]/g,
    (marker, id: string) => {
      const pasted = pastes.get(Number(id));
      return pasted !== undefined && marker === makeMarker(Number(id), pasted)
        ? normalize(pasted)
        : marker;
    },
  );
}
