import { expect, test } from "bun:test";
import { parsePatch } from "./apply-patch";

const patch = [
  "*** Begin Patch",
  "*** Update File: src/a.ts",
  "@@ function a() {",
  "-  return 1;",
  "+  return 2;",
  "   // end",
  "@@",
  "+export const b = 1;",
  "*** Add File: src/new.ts",
  "+line 1",
  "+line 2",
  "*** Update File: src/old.ts",
  "*** Move to: src/moved.ts",
  "@@",
  "-x",
  "+y",
  "*** Delete File: src/gone.ts",
  "*** End Patch",
].join("\n");

test("apply_patch splits into files with hunks, moves and counts", () => {
  expect(parsePatch(patch)).toEqual([
    {
      kind: "update",
      path: "src/a.ts",
      hunks: ["-  return 1;\n+  return 2;\n   // end", "+export const b = 1;"],
      added: 2,
      removed: 1,
    },
    {
      kind: "add",
      path: "src/new.ts",
      hunks: ["line 1\nline 2"],
      added: 2,
      removed: 0,
    },
    {
      kind: "update",
      path: "src/old.ts",
      moveTo: "src/moved.ts",
      hunks: ["-x\n+y"],
      added: 1,
      removed: 1,
    },
    { kind: "delete", path: "src/gone.ts", hunks: [], added: 0, removed: 0 },
  ]);
});

test("a patch still streaming shows the files received so far", () => {
  expect(
    parsePatch("*** Begin Patch\n*** Add File: src/x.ts\n+one\n+tw"),
  ).toEqual([
    { kind: "add", path: "src/x.ts", hunks: ["one\ntw"], added: 2, removed: 0 },
  ]);
});
