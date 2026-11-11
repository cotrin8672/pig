import { expect, test } from "bun:test";
import { parseAnnotations, withAnnotations } from "./annotations";
import { withDraftFiles } from "./attachments";

test("annotations round-trip ahead of the body and attachment paths", () => {
  const annotations = [
    { quote: "first\nline two", comment: "why?" },
    { quote: "second", comment: "" },
  ];
  const text = withDraftFiles(
    "body",
    [{ id: "f", path: "/a.txt", name: "a.txt" }],
    annotations.map((a, i) => ({ ...a, id: String(i) })),
  );
  expect(text.startsWith("<annotation>\n<quote>\nfirst")).toBe(true);
  expect(parseAnnotations(text)).toEqual({
    annotations,
    body: "body\n\n/a.txt",
  });
});

test("annotation-only prompts and plain text", () => {
  const only = withAnnotations("", [{ quote: "q", comment: "c" }]);
  expect(parseAnnotations(only)).toEqual({
    annotations: [{ quote: "q", comment: "c" }],
    body: "",
  });
  expect(parseAnnotations("> not an annotation")).toEqual({
    annotations: [],
    body: "> not an annotation",
  });
});
