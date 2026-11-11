import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { Transcript, TranscriptRecord } from "../shared/transcript";
import { isVisibleRecord } from "./custom-data";

function lastVisibleId(transcript: Transcript): string | null {
  for (let index = transcript.records.length - 1; index >= 0; index--)
    if (isVisibleRecord(transcript.records[index]))
      return transcript.records[index].id;
  return null;
}

type NotifyEvent = Extract<ExtensionUIEvent, { type: "notify" }>;
export interface ExtensionNotice {
  id: string;
  level: NotifyEvent["level"];
  message: string;
  /** undefined until the first snapshot; null means before the first record. */
  after?: string | null;
  revision?: string;
}

// Display-only: never append extension notices to the SDK transcript or notification history.
export function alignExtensionNotices(
  notices: ExtensionNotice[],
  transcript: Transcript,
): ExtensionNotice[] {
  const revision = transcript.history?.revision;
  if (
    notices.every(
      (notice) =>
        notice.after !== undefined &&
        (notice.revision === undefined || notice.revision === revision),
    )
  )
    return notices;
  return notices.flatMap((notice) => {
    if (notice.revision !== undefined && notice.revision !== revision)
      return [];
    if (notice.after !== undefined) return [notice];
    return [{ ...notice, after: lastVisibleId(transcript), revision }];
  });
}

export function appendExtensionNotice(
  notices: ExtensionNotice[],
  event: NotifyEvent,
  transcript?: Transcript,
): ExtensionNotice[] {
  const after = transcript ? lastVisibleId(transcript) : undefined;
  const revision = transcript?.history?.revision;
  const last = notices.at(-1);
  const lastAfter = last?.after
    ? (transcript?.liveToEntry[last.after] ?? last.after)
    : last?.after;
  if (
    event.level === "info" &&
    last?.level === "info" &&
    lastAfter === after &&
    last.revision === revision
  )
    return [...notices.slice(0, -1), { ...last, message: event.message }];
  return [
    ...notices,
    {
      id: crypto.randomUUID(),
      level: event.level,
      message: event.message,
      after,
      revision,
    },
  ];
}

type ChatItem =
  | { record: TranscriptRecord; index: number }
  | { notice: ExtensionNotice };

export function interleaveExtensionNotices(
  transcript: Transcript,
  notices: readonly ExtensionNotice[],
): ChatItem[] {
  const groups = new Map<string | null | undefined, ExtensionNotice[]>();
  for (const notice of notices) {
    if (
      notice.revision !== undefined &&
      notice.revision !== transcript.history?.revision
    )
      continue;
    const after = notice.after
      ? (transcript.liveToEntry[notice.after] ?? notice.after)
      : notice.after;
    const group = groups.get(after) ?? [];
    group.push(notice);
    groups.set(after, group);
  }
  const items: ChatItem[] = [];
  const append = (after: string | null | undefined) => {
    for (const notice of groups.get(after) ?? []) items.push({ notice });
  };
  append(null);
  transcript.records.forEach((record, index) => {
    items.push({ record, index });
    append(record.id);
  });
  append(undefined);
  return items;
}

export function ExtensionNoticeLine({ notice }: { notice: ExtensionNotice }) {
  return (
    <p
      className={`extension-notice ${notice.level === "info" ? "muted" : notice.level}`}
      role={notice.level === "error" ? "alert" : "status"}
    >
      {notice.level === "warning"
        ? "Warning: "
        : notice.level === "error"
          ? "Error: "
          : ""}
      {notice.message}
    </p>
  );
}
