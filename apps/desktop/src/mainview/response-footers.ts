import {
  type ResponseStats,
  responseStats,
  type TranscriptRecord,
} from "../shared/transcript";

type Turn = Extract<TranscriptRecord, { kind: "message" }>;
type Footer = { stats: ResponseStats; user?: Turn };
type CachedFooter = Footer & { turns: Turn[]; start: number };

/** Each response is scanned once; unchanged responses keep their stats and copy text. */
export function createResponseFooterIndex() {
  let previous = new Map<string, CachedFooter>();
  let previousRevision: string | undefined;
  return (
    records: readonly TranscriptRecord[],
    running: boolean,
    revision?: string,
  ): ReadonlyMap<string, Footer> => {
    if (revision !== previousRevision) previous.clear();
    previousRevision = revision;
    const next = new Map<string, CachedFooter>();
    let turns: Turn[] = [];
    let start = 0;
    let turnIndex = 0;
    let last = -1;
    function finish() {
      if (last < 0) return;
      const end = turns[last];
      const cached = previous.get(end.id);
      if (
        cached &&
        cached.turns.length === last + 1 &&
        cached.turns.every((turn, index) => {
          const current = turns[index];
          // Saved entries are immutable within a history revision, including after IPC clones.
          return (
            turn === current ||
            (!!revision &&
              !!turn.entryId &&
              turn.entryId === current.entryId &&
              turn.parentId === current.parentId &&
              turn.message.role === current.message.role)
          );
        })
      ) {
        next.set(
          end.id,
          cached.start === start
            ? cached
            : {
                ...cached,
                start,
                stats:
                  cached.stats.userIndex === undefined
                    ? cached.stats
                    : {
                        ...cached.stats,
                        userIndex:
                          cached.stats.userIndex + start - cached.start,
                      },
              },
        );
        return;
      }
      const stats = responseStats(turns, last);
      if (!stats) return;
      const user =
        stats.userIndex === undefined ? undefined : turns[stats.userIndex];
      if (stats.userIndex !== undefined) stats.userIndex += start;
      next.set(end.id, { turns: turns.slice(0, last + 1), start, stats, user });
    }
    for (const record of records) {
      if (record.kind !== "message") continue;
      if (record.message.role === "user") {
        finish();
        turns = [];
        start = turnIndex;
        last = -1;
      }
      turns.push(record);
      if (record.message.role === "assistant") last = turns.length - 1;
      turnIndex++;
    }
    if (!running) finish();
    previous = next;
    return next;
  };
}
