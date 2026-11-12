import { expect, test } from "bun:test";
import type { ChatRenderData } from "@pig/chat-renderers";
import { revisionViews, searchRows } from "./design-model";

function fixture(name: string, text: string): ChatRenderData["tool"] {
  return {
    call: { id: "fixture", name, arguments: { path: "src" } },
    live: false,
    state: { status: "done", result: { content: [{ type: "text", text }] } },
  };
}
test("search designs retain the path, line and full match including colons", () => {
  expect(
    searchRows(
      fixture("grep", 'C:/project/a.ts:12:const url = "https://example.com";'),
    ),
  ).toEqual([
    {
      path: "C:/project/a.ts",
      line: "12",
      text: 'const url = "https://example.com";',
    },
  ]);
});
test("directory and find designs retain all file paths", () => {
  expect(searchRows(fixture("ls", "a.ts\nb.ts\n"))).toEqual([
    { path: "src/a.ts", line: "", text: "" },
    { path: "src/b.ts", line: "", text: "" },
  ]);
  expect(searchRows(fixture("find", "src/a.ts\nlib/a.ts"))).toHaveLength(2);
  expect(searchRows(fixture("grep", ""))).toEqual([]);
});
test("diff variants derive both revisions and counts from the identical patch", () => {
  const diff =
    ' const name = "demo";\n-const greeting = "Hi";\n+const greeting = "Hello";\n+log(greeting);';
  expect(revisionViews(diff)).toEqual({
    lines: diff.split("\n"),
    before: 'const name = "demo";\nconst greeting = "Hi";',
    after: 'const name = "demo";\nconst greeting = "Hello";\nlog(greeting);',
    added: 2,
    removed: 1,
  });
});
