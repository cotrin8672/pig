import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { MAX_TERMS, searchTerms } from "../shared/fuzzy";
import {
  conversationSearchQuery,
  FULL_SCAN_SEARCH_SQL,
  SEARCH_VOCAB_SQL,
  searchCandidate,
  selectiveSearchCandidate,
} from "./search-query";

type Row = {
  text: string;
  session: string;
  entry: string;
  role: string;
  ts: number;
};
function fixture(texts: string[]) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE VIRTUAL TABLE messages USING fts5(text, session UNINDEXED, entry UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize='trigram')",
  );
  db.exec(SEARCH_VOCAB_SQL);
  const insert = db.query(
    "INSERT INTO messages(text,session,entry,role,ts) VALUES(?,?,?,?,?)",
  );
  db.transaction(() => {
    texts.forEach((text, i) => {
      insert.run(
        text,
        `session-${i % 3}`,
        `entry-${i}`,
        i % 2 ? "assistant" : "user",
        Math.floor(i / 5),
      );
    });
  })();
  return db;
}
function original(db: Database, query: string, limit: number) {
  const terms = searchTerms(query);
  if (!terms.some((term) => term.length >= 2)) return [];
  // Keep this escaping independent of the new helper.
  const patterns = Array.from({ length: MAX_TERMS }, (_, i) =>
    terms[i] === undefined ? "%" : `%${terms[i].replace(/[\\%_]/g, "\\$&")}%`,
  );
  return db.query(FULL_SCAN_SEARCH_SQL).all(...patterns, limit) as Row[];
}
function optimized(db: Database, query: string, limit: number) {
  const terms = searchTerms(query);
  if (!terms.some((term) => term.length >= 2)) return [];
  const count = (
    db.query("SELECT count(*) AS count FROM messages_docsize").get() as {
      count: number;
    }
  ).count;
  const candidate = selectiveSearchCandidate(db, searchCandidate(terms), count);
  const { sql, parameters } = conversationSearchQuery(
    terms,
    limit,
    candidate ?? null,
  );
  return db.query(sql).all(...parameters) as Row[];
}

test("candidate runs are literal necessary substrings and require three Unicode code points", () => {
  expect(searchCandidate(["設定", "ab", "%_", "😀a"])).toBeUndefined();
  expect(searchCandidate(["100%_設定"])).toBe("%100%");
  expect(searchCandidate(["ab%長い日本語_zz"])).toBe("%長い日本語%");
  expect(searchCandidate(["C:\\temp\\file"])).toBe("%C:\\temp\\file%");
  expect(searchCandidate(["😀aあ"])).toBe("%😀aあ%");
  expect(searchCandidate(["before\0after"])).toBeUndefined();
  expect(searchCandidate(["before\0after", "needle"])).toBe("%needle%");
  expect(searchCandidate(["_%".repeat(10000)])).toBeUndefined();
  expect(searchCandidate(["😀".repeat(10000)])).toBe(`%${"😀".repeat(64)}%`);
});

test("trigram candidate extraction uses the LIKE index; exact predicates still have ESCAPE", () => {
  const db = fixture([
    "literal needle 100%_ C:\\temp\\file",
    "literal needle 100xx C:tempfile",
  ]);
  try {
    const { sql, parameters } = conversationSearchQuery(
      ["needle", "100%_"],
      50,
    );
    const plan = db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
      detail: string;
    }[];
    expect(
      plan.some((row) => /VIRTUAL TABLE INDEX .*L0/.test(row.detail)),
    ).toBe(true);
    expect(sql.match(/ ESCAPE /g)).toHaveLength(2);
    expect(sql).not.toContain("needle");
    expect(optimized(db, "C:\\temp\\file", 50).map((row) => row.entry)).toEqual(
      ["entry-0"],
    );
    expect(optimized(db, "needle 100%_", 50)).toEqual(
      original(db, "needle 100%_", 50),
    );
    expect(optimized(db, "needle 100%_", 50).map((row) => row.entry)).toEqual([
      "entry-0",
    ]);
  } finally {
    db.close();
  }
});

test("broad candidates fall back to exact scanning without changing results", () => {
  const db = fixture(
    Array.from(
      { length: 500 },
      (_, i) => `common ${i === 0 ? "needle" : "ordinary"} ${i}`,
    ),
  );
  try {
    expect(
      selectiveSearchCandidate(db, searchCandidate(["common"]), 500),
    ).toBeUndefined();
    expect(selectiveSearchCandidate(db, searchCandidate(["needle"]), 500)).toBe(
      "%needle%",
    );
    expect(
      selectiveSearchCandidate(db, searchCandidate(["not-present"]), 500),
    ).toBe("%not-present%");
    const query = conversationSearchQuery(["common"], 50, null);
    const plan = db
      .query(`EXPLAIN QUERY PLAN ${query.sql}`)
      .all(...query.parameters) as { detail: string }[];
    expect(
      plan.some((row) => /VIRTUAL TABLE INDEX .*L0/.test(row.detail)),
    ).toBe(false);
    expect(optimized(db, "common", 50)).toEqual(original(db, "common", 50));
    expect(optimized(db, "needle", 50)).toEqual(original(db, "needle", 50));
  } finally {
    db.close();
  }
});

test("exact matching happens before LIMIT even when newer indexed candidates are false positives", () => {
  const texts = [
    ...Array.from({ length: 20 }, (_, i) => `alphabet_% 必須 actual ${i}`),
    ...Array.from(
      { length: 200 },
      (_, i) => `alphabet wrong literal and no required Japanese ${i}`,
    ),
  ];
  const db = fixture(texts);
  try {
    for (const limit of [-1, 0, 1, 7, 50, 999]) {
      expect(optimized(db, "alphabet_% 必須", limit)).toEqual(
        original(db, "alphabet_% 必須", limit),
      );
      if (limit > 0)
        expect(optimized(db, "alphabet_% 必須", limit)).toHaveLength(
          Math.min(limit, 20),
        );
    }
  } finally {
    db.close();
  }
});

test("optimized SQL matches the original scan for literal symbols, short Japanese, Unicode, all words, ties and limits", () => {
  const vocabulary = [
    "Alpha",
    "BETA",
    "設定",
    "検索",
    "日本語",
    "100%",
    "100x",
    "under_score",
    "C:\\temp\\file",
    'quote"literal',
    "single'quote",
    "😀",
    "😀a",
    "😀aあ",
    "İstanbul",
    "i\u0307stanbul",
    "straße",
    "STRASSE",
    "éclair",
    "e\u0301clair",
    "改行",
    "before\0after",
    "%%",
    "__",
    "\\\\",
    "abcdef",
  ];
  let seed = 8672;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const texts = Array.from({ length: 500 }, () =>
    Array.from(
      { length: 12 },
      () => vocabulary[random() % vocabulary.length],
    ).join(random() % 2 ? " " : "\n"),
  );
  const queries = [
    "",
    "x",
    "設定",
    "設定 検索",
    "100%",
    "under_score",
    "C:\\temp\\file",
    "single'quote",
    "😀",
    "😀a",
    "😀aあ",
    "İSTANBUL",
    "straße",
    "STRASSE",
    "éclair",
    "e\u0301clair",
    "before\0after",
    "before\0after alpha",
    "%%",
    "__",
    "\\\\",
    "alpha alpha",
    "alpha beta 設定 検索 日本語 100% 改行 abcdef ignored-ninth-word",
  ];
  for (let i = 0; i < 300; i++)
    queries.push(
      Array.from(
        { length: 1 + (random() % 9) },
        () => vocabulary[random() % vocabulary.length],
      ).join(i % 2 ? " " : "\t"),
    );
  const db = fixture(texts);
  try {
    for (const query of queries)
      for (const limit of [1, 7, 50])
        expect(
          optimized(db, query, limit),
          JSON.stringify({ query, limit }),
        ).toEqual(original(db, query, limit));
  } finally {
    db.close();
  }
});
