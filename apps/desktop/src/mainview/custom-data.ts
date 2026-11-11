import type { TranscriptRecord } from "../shared/transcript";

/** Text only: never HTML, executable renderer source, or inferred Plan/Goal semantics. */
export function dataText(value: unknown, omitImages = false): string {
  if (typeof value === "string") return value;
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(
        value,
        (_key, item: unknown) => {
          if (typeof item === "bigint") return String(item);
          if (item && typeof item === "object") {
            if (omitImages && "type" in item && item.type === "image")
              return undefined;
            if (seen.has(item)) return "[Circular]";
            seen.add(item);
          }
          return item;
        },
        2,
      ) ?? String(value)
    );
  } catch {
    return "[Data could not be formatted]";
  }
}
export function customPresentation(record: TranscriptRecord) {
  if (record.kind === "custom-entry")
    return {
      label: record.customType,
      content: record.data,
      details: undefined,
      hidden: false,
    };
  if (record.kind === "session-entry")
    return {
      label: record.entryType,
      content: record.data,
      details: undefined,
      hidden: true,
    };
  const message = record.message;
  if (message.role === "custom")
    return {
      label: message.customType,
      content: message.content,
      details: message.details ?? record.details,
      hidden: !message.display,
    };
  return {
    label: record.customType ?? message.role,
    content: message.content,
    details: record.details,
    hidden: record.display === false,
  };
}
export function rendererOrFallback<T>(
  render: (() => T) | undefined,
  fallback: () => T,
): T {
  try {
    return render ? render() : fallback();
  } catch {
    return fallback();
  }
}

/** Nested custom images are inert data URLs with approved raster MIME types only. */
export function customImageSources(value: unknown): string[] {
  const pending: unknown[] = [value];
  const sources = new Set<string>();
  const seen = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (
      "type" in item &&
      item.type === "image" &&
      "mimeType" in item &&
      typeof item.mimeType === "string" &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        item.mimeType,
      ) &&
      "data" in item &&
      typeof item.data === "string"
    )
      sources.add(`data:${item.mimeType};base64,${item.data}`);
    for (const child of Object.values(item)) pending.push(child);
  }
  return [...sources];
}
