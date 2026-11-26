import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposerEditor,
  editorViewCount,
  forgetEditorView,
  insertEditorNewline,
  sizeEditor,
} from "./ComposerEditor";

test("retired owners release their editor history and folded paste payloads", () => {
  const before = editorViewCount();
  const paste = { id: "1", marker: "[paste #1 9 chars]", text: "long text" };
  for (const key of ["retired-a", "retired-b"])
    renderToStaticMarkup(
      createElement(ComposerEditor, {
        viewKey: key,
        value: paste.marker,
        pastes: [paste],
        onRestore: () => {},
      }),
    );
  expect(editorViewCount()).toBe(before + 2);
  forgetEditorView("retired-a");
  forgetEditorView("retired-b");
  expect(editorViewCount()).toBe(before);
});

function editor(contentHeight: number, scrollTop = 0) {
  const input = {
    style: { height: "32px" },
    scrollHeight: contentHeight,
    scrollTop,
    get clientHeight() {
      return Number.parseFloat(this.style.height);
    },
  };
  return input as unknown as HTMLTextAreaElement;
}

test("restored and wrapped drafts grow to fit instead of being clipped to 32px", () => {
  const input = editor(96, 64);
  sizeEditor(input);
  expect(input.style.height).toBe("96px");
  expect(input.scrollTop).toBe(0);
  const narrower = editor(160);
  sizeEditor(narrower);
  expect(narrower.style.height).toBe("160px");
});

test("long drafts stay bounded and retain their internal scroll position", () => {
  const input = editor(600, 200);
  sizeEditor(input);
  expect(input.style.height).toBe("220px");
  expect(input.scrollTop).toBe(200);
});

test("typing at the top only measures content height once", () => {
  const input = editor(96);
  let reads = 0;
  Object.defineProperty(input, "scrollHeight", {
    get() {
      reads++;
      return 96;
    },
  });
  sizeEditor(input);
  expect(reads).toBe(1);
  expect(input.style.height).toBe("96px");
});

test.each([
  ["before selected after", 7, 15, "before \n after", 8],
  ["1. abc", 6, 6, "1. abc\n2. ", 10],
  ["  9. abc", 8, 8, "  9. abc\n  10. ", 15],
  ["- abc\nnext", 5, 5, "- abc\n- \nnext", 8],
  ["- abc\n- ", 8, 8, "- abc\n", 6],
  ["1. abc", 4, 4, "1. a\nbc", 5],
] satisfies [
  string,
  number,
  number,
  string,
  number,
][])("configured newline: %s", (value, start, end, expected, caret) => {
  const input = {
    value,
    selectionStart: start,
    selectionEnd: end,
    setRangeText(text: string, from: number, to: number, mode: string) {
      expect(mode).toBe("end");
      this.value = value.slice(0, from) + text + value.slice(to);
      this.selectionStart = this.selectionEnd = from + text.length;
    },
  };
  insertEditorNewline(input as unknown as HTMLTextAreaElement, (text) =>
    expect(text).toBe(expected),
  );
  expect(input.selectionStart).toBe(caret);
});

test("clearing a draft returns to measured content height; CSS supplies the minimum", () => {
  const input = editor(20, 10);
  input.style.height = "220px";
  sizeEditor(input);
  expect(input.style.height).toBe("20px");
  expect(input.scrollTop).toBe(0);
});
