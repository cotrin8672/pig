// Offline synthetic SQLite only: no user index, sessions, extensions or credentials.
import { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  conversationSearchQuery,
  FULL_SCAN_SEARCH_SQL,
  SEARCH_VOCAB_SQL,
  searchCandidate,
  selectiveSearchCandidate,
} from "../src/bun/search-query";
import { MAX_TERMS, searchTerms } from "../src/shared/fuzzy";

const db = new Database(":memory:");
try {
  db.exec(
    "CREATE VIRTUAL TABLE messages USING fts5(text, session UNINDEXED, entry UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize='trigram')",
  );
  db.exec(SEARCH_VOCAB_SQL);
  const insert = db.query(
    "INSERT INTO messages(text,session,entry,role,ts) VALUES(?,?,?,?,?)",
  );
  const count = 10000;
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const text =
        "common synthetic report payload. ".repeat(32) +
        ` row-${i}` +
        (i % 10 === 0 ? " 設定 検索" : "") +
        (i % 127 === 0 ? " 100%_ 必須" : "") +
        (i % 997 === 0 ? " rare-marker 設定" : "");
      insert.run(
        text,
        "synthetic",
        `entry-${i}`,
        i % 2 ? "assistant" : "user",
        Math.floor(i / 3),
      );
    }
  })();
  for (const query of [
    "rare-marker 設定",
    "100%_ 必須",
    "common",
    "設定",
    "__",
  ]) {
    const terms = searchTerms(query);
    const original = () => ({
      sql: FULL_SCAN_SEARCH_SQL,
      parameters: [
        ...Array.from({ length: MAX_TERMS }, (_, i) =>
          terms[i] === undefined
            ? "%"
            : `%${terms[i].replace(/[\\%_]/g, "\\$&")}%`,
        ),
        50,
      ],
    });
    const optimized = () =>
      conversationSearchQuery(
        terms,
        50,
        selectiveSearchCandidate(db, searchCandidate(terms), count) ?? null,
      );
    const rows = (plan: ReturnType<typeof optimized>) =>
      db.query(plan.sql).all(...plan.parameters);
    if (!isDeepStrictEqual(rows(original()), rows(optimized())))
      throw new Error("Search results changed");
    const variants = [original, optimized];
    const timings: number[][] = [[], []],
      matches = [0, 0];
    for (let i = 0; i < 3; i++) for (const variant of variants) rows(variant());
    for (let i = 0; i < 20; i++)
      for (let step = 0; step < 2; step++) {
        const variant = (i + step) % 2;
        const start = performance.now();
        matches[variant] += rows(variants[variant]()).length;
        timings[variant].push(performance.now() - start);
      }
    const summarize = (variant: number) => {
      const samples = timings[variant].sort((a, b) => a - b);
      return {
        meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
        p50Ms: samples[10],
        p95Ms: samples[19],
        matches: matches[variant],
      };
    };
    const plan = (value: ReturnType<typeof optimized>) =>
      (
        db
          .query(`EXPLAIN QUERY PLAN ${value.sql}`)
          .all(...value.parameters) as { detail: string }[]
      ).map((row) => row.detail);
    console.info(
      JSON.stringify({
        records: count,
        query,
        original: summarize(0),
        optimized: summarize(1),
        originalPlan: plan(original()),
        optimizedPlan: plan(optimized()),
        scope:
          "In-memory Bun/SQLite helper timing; exact result equality checked; not real search UI latency",
      }),
    );
  }
} finally {
  db.close();
}
