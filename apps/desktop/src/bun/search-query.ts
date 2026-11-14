import type { Database } from "bun:sqlite";
import { MAX_TERMS } from "../shared/fuzzy";

// Connection-local metadata view: no schema migration or rebuilt user index.
export const SEARCH_VOCAB_SQL =
  "CREATE VIRTUAL TABLE temp.search_vocab USING fts5vocab(main, messages, row)";

const columns = "text, session, entry, role, ts";
// Kept as the result-equivalence oracle and a full-scan recovery path.
export const FULL_SCAN_SEARCH_SQL = `SELECT ${columns} FROM messages
  WHERE text LIKE ?1 ESCAPE '\\' AND text LIKE ?2 ESCAPE '\\'
    AND text LIKE ?3 ESCAPE '\\' AND text LIKE ?4 ESCAPE '\\'
    AND text LIKE ?5 ESCAPE '\\' AND text LIKE ?6 ESCAPE '\\'
    AND text LIKE ?7 ESCAPE '\\' AND text LIKE ?8 ESCAPE '\\'
  ORDER BY ts DESC LIMIT ?9`;

export const literalPattern = (term: string) =>
  `%${term.replace(/[\\%_]/g, "\\$&")}%`;

/** A necessary literal substring, never a replacement for the exact predicates. */
export function searchCandidate(terms: readonly string[]) {
  let best = "";
  for (const term of terms) {
    // SQLite LIKE stops at NUL; a suffix beyond it is not a necessary condition.
    if (term.includes("\0")) continue;
    // /u counts Unicode code points, not UTF-16 units. Iterate runs instead of
    // splitting a potentially large literal-symbol query into an array.
    for (const [run] of term.matchAll(/[^%_]{3,}/gu))
      if (run.length > best.length) best = run;
  }
  if (!best) return undefined;
  // A bounded necessary prefix avoids constructing an enormous trigram query.
  // The full, untruncated term is still checked by the exact predicate below.
  const prefix =
    best.length <= 64 ? best : [...best.slice(0, 128)].slice(0, 64).join("");
  return `%${prefix}%`;
}

/** Avoid an indexed candidate that would decode nearly every message anyway.
 * This is a performance hint only: both choices retain all exact predicates.
 * Inspect at most two short terms; never tokenize/scan a large query here. */
export function selectiveSearchCandidate(
  db: Database,
  candidate: string | undefined,
  messageCount: number,
) {
  if (!candidate || messageCount < 256) return candidate;
  const literal = candidate.slice(1, -1);
  const first = [...literal.slice(0, 6)].slice(0, 3).join("").toLowerCase();
  const last = [...literal.slice(-6)].slice(-3).join("").toLowerCase();
  for (const term of new Set([first, last])) {
    const row = db
      .query("SELECT doc FROM temp.search_vocab WHERE term = ?")
      .get(term) as { doc: number } | null;
    // Missing metadata (including differences in Unicode folding) is not a
    // reason to exclude results. Let the normal indexed LIKE evaluate them.
    if (!row || row.doc <= messageCount / 4) return candidate;
  }
  return undefined;
}

/** Keep exact escaped all-word matching and apply LIMIT only after it. */
export function conversationSearchQuery(
  terms: readonly string[],
  limit: number,
  candidate: string | null = searchCandidate(terms) ?? null,
) {
  if (!terms.length || terms.length > MAX_TERMS)
    throw new Error("Invalid search term count");
  const parameters: (string | number)[] = terms.map(literalPattern);
  const predicates = parameters.map(
    (_, i) => `text LIKE ?${i + 1} ESCAPE '\\'`,
  );
  if (candidate !== null) {
    parameters.push(candidate);
    // Unlike the exact predicates, this necessary condition has no ESCAPE and
    // can use FTS5's trigram LIKE index. '%'/'_' cannot occur in its literal run.
    predicates.push(`text LIKE ?${parameters.length}`);
  }
  parameters.push(limit);
  return {
    sql: `SELECT ${columns} FROM messages WHERE ${predicates.join(" AND ")}
      ORDER BY ts DESC LIMIT ?${parameters.length}`,
    parameters,
  };
}
