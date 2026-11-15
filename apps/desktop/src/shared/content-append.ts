export type ContentAppend = {
  index: number;
  field: "text" | "thinking";
  from: number;
};
type TextBlock = { type: string; field: ContentAppend["field"]; value: string };
export type ContentBase = (TextBlock | undefined)[];

function textBlock(value: unknown): TextBlock | undefined {
  if (!value || typeof value !== "object") return;
  const block = value as Record<string, unknown>;
  const field =
    block.type === "text"
      ? "text"
      : block.type === "thinking"
        ? "thinking"
        : undefined;
  if (field && typeof block[field] === "string")
    return { type: block.type as string, field, value: block[field] };
}

/** Only the latest live strings are retained, not messages, images or details. */
export function contentBase(content: unknown): ContentBase | undefined {
  return Array.isArray(content) ? content.map(textBlock) : undefined;
}

export function encodeContentAppend<T>(
  content: T[],
  previous?: ContentBase,
): { content: T[]; appends: ContentAppend[] } | undefined {
  if (!previous) return;
  const appends: ContentAppend[] = [];
  const encoded = content.map((value, index) => {
    const block = textBlock(value);
    const old = previous[index];
    if (
      !block ||
      !old ||
      block.type !== old.type ||
      old.value.length < 128 ||
      !block.value.startsWith(old.value)
    )
      return value;
    appends.push({ index, field: block.field, from: old.value.length });
    return {
      ...(value as Record<string, unknown>),
      [block.field]: block.value.slice(old.value.length),
    } as T;
  });
  return appends.length ? { content: encoded, appends } : undefined;
}

export function expandContentAppend<T>(
  content: T[],
  previous: unknown,
  appends: ContentAppend[],
): T[] | undefined {
  if (!Array.isArray(previous) || !Array.isArray(appends) || !appends.length)
    return;
  const expanded = [...content];
  const seen = new Set<number>();
  for (const patch of appends) {
    if (
      !patch ||
      typeof patch !== "object" ||
      !Number.isSafeInteger(patch.index) ||
      patch.index < 0 ||
      seen.has(patch.index)
    )
      return;
    const block = textBlock(content[patch.index]);
    const old = textBlock(previous[patch.index]);
    if (
      !block ||
      !old ||
      block.type !== old.type ||
      patch.field !== block.field ||
      patch.field !== old.field ||
      patch.from !== old.value.length
    )
      return;
    seen.add(patch.index);
    expanded[patch.index] = {
      ...(content[patch.index] as Record<string, unknown>),
      [patch.field]: old.value + block.value,
    } as T;
  }
  return expanded;
}
