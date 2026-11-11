import { useDeferredValue, useMemo, useState } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { customPresentation, dataText } from "./custom-data";
import { useT } from "./i18n";

export type TranscriptSearchTarget = {
  toolCallId?: string;
  blockIndex?: number;
  details?: boolean;
};

export function findMessages(records: TranscriptRecord[], query: string) {
  const needle = query.trim().toLowerCase();
  const matches: ({
    id: string;
    recordId: string;
    snippet: string;
  } & TranscriptSearchTarget)[] = [];
  if (!needle) return matches;
  const calls = new Map<string, string>();
  for (const record of records) {
    const { content, hidden, details: metadata } = customPresentation(record);
    if (hidden) continue;
    const details =
      record.kind === "message" && record.message.role !== "custom"
        ? metadata
        : undefined;
    let id = record.id;
    let toolCallId: string | undefined;
    if (record.kind === "message") {
      const msg = record.message;
      if (msg.role === "assistant") {
        for (const b of msg.content)
          if (b.type === "toolCall") calls.set(b.id, id);
      } else if (msg.role === "toolResult") {
        const owner = calls.get(msg.toolCallId);
        if (!owner) continue;
        id = owner;
        toolCallId = msg.toolCallId;
      }
    }
    const blocks = Array.isArray(content) ? content : [content];
    for (const [blockIndex, part] of (details === undefined
      ? blocks
      : [...blocks, details]
    ).entries()) {
      if (part?.type === "image") continue;
      const body =
        typeof part === "string"
          ? part
          : part?.type === "text"
            ? part.text
            : part?.type === "thinking"
              ? part.thinking
              : dataText(part, true);
      if (typeof body !== "string") continue;
      const at = body.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      matches.push({
        id,
        recordId: record.id,
        snippet: body.slice(Math.max(0, at - 35), at + needle.length + 65),
        toolCallId:
          toolCallId ?? (part?.type === "toolCall" ? part.id : undefined),
        blockIndex:
          record.kind === "message" &&
          record.message.role === "assistant" &&
          blockIndex < blocks.length
            ? blockIndex
            : undefined,
        details: blockIndex === blocks.length || undefined,
      });
      break;
    }
    if (matches.length === 51) break;
  }
  return matches;
}

export function TranscriptSearch({
  records,
  onSelect,
}: {
  records: TranscriptRecord[];
  onSelect(id: string, target?: TranscriptSearchTarget): void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const matches = useMemo(
    () => findMessages(records, deferred),
    [records, deferred],
  );
  return (
    <details
      className="transcript-search"
      onToggle={(e) => {
        if (!e.currentTarget.open) setQuery("");
      }}
    >
      <summary>{t.searchLoaded}</summary>
      <input
        type="search"
        aria-label={t.searchLoaded}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <output>
          {matches.length > 50 ? "50+" : matches.length || t.noMatches}
        </output>
      )}
      {matches.slice(0, 50).map(({ id, recordId, snippet, ...target }) => (
        <button
          key={recordId}
          type="button"
          onClick={() => onSelect(id, target)}
        >
          {snippet}
        </button>
      ))}
    </details>
  );
}
