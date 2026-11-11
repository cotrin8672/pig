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

/** A partial marker edit opens its payload instead of destroying hidden text. */
export function editFoldedText(
  previous: string,
  next: string,
  pastes: { id: string; marker: string; text: string }[],
) {
  if (!pastes.length || previous === next) return { text: next, pastes };
  let start = 0,
    end = previous.length,
    tail = next.length;
  while (start < end && start < tail && previous[start] === next[start])
    start++;
  while (end > start && tail > start && previous[end - 1] === next[tail - 1]) {
    end--;
    tail--;
  }
  const keys = new Set(pastes.map((p) => p.marker));
  let from = start,
    to = end;
  for (const hit of previous.matchAll(
    /\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]/g,
  )) {
    if (!keys.has(hit[0])) continue;
    const after = hit.index + hit[0].length;
    if (hit.index < start && start < after) from = after;
    if (hit.index < end && end < after) to = hit.index;
  }
  if (from === start && to === end) return { text: next, pastes };
  // Keep both partially selected pastes; an insertion inside one goes after its text.
  const prefix = previous.slice(0, from);
  const suffix = previous.slice(Math.max(from, to));
  return {
    text:
      unfoldPastes(prefix, pastes) +
      next.slice(start, tail) +
      unfoldPastes(suffix, pastes),
    pastes: [],
  };
}

export function unfoldPastes(
  text: string,
  pastes: readonly { marker: string; text: string }[],
) {
  if (!pastes.length) return text;
  const values = new Map(pastes.map((p) => [p.marker, p.text]));
  return text.replace(
    /\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]/g,
    (marker) => values.get(marker) ?? marker,
  );
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
