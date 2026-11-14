import { expect, test } from "bun:test";
import { grepPattern, parseGrepOutput } from "./grep-output";

test("grep groups interleaved paths and counts matching rows, not context or occurrences", () => {
  const parsed = parseGrepOutput(
    [
      "src/a.ts-1- // preceding context",
      "src/a.ts:2:   greeting(greeting);",
      "src/b.ts:8: greeting;",
      "--",
      "src/a.ts-3- ",
      "src/a.ts:12: greeting;",
      "",
      "[3 matches limit reached]",
    ].join("\n"),
  );
  expect(parsed.matches).toBe(3);
  expect(parsed.files.map((file) => [file.path, file.matches])).toEqual([
    ["src/a.ts", 2],
    ["src/b.ts", 1],
  ]);
  expect(parsed.files[0].lines).toEqual([
    { line: 1, text: "// preceding context", match: false },
    { line: 2, text: "  greeting(greeting);", match: true },
    { line: 3, text: "", match: false },
    { line: 12, text: "greeting;", match: true },
  ]);
  expect(parsed.notices).toBe("[3 matches limit reached]");
});

test("grep accepts Windows paths and CRLF without trimming code indentation", () => {
  const parsed = parseGrepOutput(
    "C:\\work\\file-name.ts:120:   const x = ':42:';\r\nC:\\work\\file-name.ts-121- \r\n",
  );
  expect(parsed.files).toHaveLength(1);
  expect(parsed.files[0].path).toBe("C:\\work\\file-name.ts");
  expect(parsed.files[0].lines[0]).toEqual({
    line: 120,
    text: "  const x = ':42:';",
    match: true,
  });
  expect(parsed.files[0].lines[1].text).toBe("");
});

test("empty and unfamiliar output does not fabricate file matches", () => {
  for (const text of [
    "",
    "No matches found",
    "regex parse error: unclosed group",
    "unexpected <markup>",
  ]) {
    const parsed = parseGrepOutput(text);
    expect(parsed.files).toEqual([]);
    expect(parsed.matches).toBe(0);
    expect(parsed.notices).toBe(text);
  }
});

test("grep highlight patterns honor literal, regex and case-insensitive searches", () => {
  const matches = (text: string, args: Record<string, unknown>) => {
    const pattern = grepPattern(args);
    return pattern ? [...text.matchAll(pattern)].map((match) => match[0]) : [];
  };
  expect(
    matches("A.b aXb a.b", { pattern: "a.b", literal: true, ignoreCase: true }),
  ).toEqual(["A.b", "a.b"]);
  expect(
    matches("greet greeting farewell", { pattern: "greet(?:ing)?|farewell" }),
  ).toEqual(["greet", "greeting", "farewell"]);
  expect(grepPattern({ pattern: "(" })).toBeUndefined();
  expect(grepPattern({ pattern: "" })).toBeUndefined();
  expect(grepPattern({})).toBeUndefined();
});
