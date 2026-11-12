import { expect, test } from "bun:test";
import type { ChatRenderData } from "@pig/chat-renderers";
import {
  changedSpan,
  diffHunks,
  diffRows,
  grepFiles,
  outline,
  pairChanges,
  pathTree,
  readRange,
} from "./model";

function fixture(
  name: string,
  text: string,
  args: Record<string, unknown> = {},
): ChatRenderData["tool"] {
  return {
    call: { id: "fixture", name, arguments: args },
    live: false,
    state: { status: "done", result: { content: [{ type: "text", text }] } },
  };
}

test("read derives the file length from the continuation notice", () => {
  const text = "a\nb\n\n[40 more lines in file. Use offset=14 to continue.]";
  expect(readRange(fixture("read", text, { offset: 12 }))).toEqual({
    lines: ["a", "b"],
    start: 12,
    end: 13,
    total: 53,
  });
  expect(readRange(fixture("read", "a\nb")).total).toBe(2);
});

test("grep groups matches and context lines, keeping colons and dashes in paths", () => {
  const text =
    'C:/a-b.ts:3: const url = "x:1";\nC:/a-b.ts-4- next\nlib/c.ts:9: y\n\n[limit reached]';
  expect(grepFiles(fixture("grep", text))).toEqual([
    {
      path: "C:/a-b.ts",
      lines: [
        { line: 3, text: 'const url = "x:1";', match: true },
        { line: 4, text: "next", match: false },
      ],
    },
    { path: "lib/c.ts", lines: [{ line: 9, text: "y", match: true }] },
  ]);
});

test("path trees merge single-folder chains and list folders first", () => {
  const tree = pathTree(["x.ts", "apps/cli/src/a.ts", "apps/cli/src/b.ts"]);
  expect(tree.map((node) => node.name)).toEqual(["apps/cli/src", "x.ts"]);
  expect(tree[0].children.map((node) => node.name)).toEqual(["a.ts", "b.ts"]);
});

test("edit diffs split into hunks and pair each changed line", () => {
  const hunks = diffHunks(
    diffRows(" 1 keep\n-2 old\n+2 new\n+3 extra\n    ...\n 9 tail"),
  );
  expect(hunks).toHaveLength(2);
  expect(
    pairChanges(hunks[0]).map((pair) => [pair.del?.text, pair.add?.text]),
  ).toEqual([
    [undefined, undefined],
    ["old", "new"],
    [undefined, "extra"],
  ]);
  expect(changedSpan('farewell: "Bye" }', 'farewell: "Goodbye" }')).toEqual({
    prefix: 'farewell: "',
    removed: "B",
    added: "Goodb",
    suffix: 'ye" }',
  });
});

test("outline lists top-level declarations with their line", () => {
  expect(
    outline("import x from 'y';\nexport const fr = 1;\nfunction help() {}"),
  ).toEqual([
    { line: 2, kind: "const", name: "fr", exported: true },
    { line: 3, kind: "function", name: "help", exported: false },
  ]);
});
