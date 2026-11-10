import { expect, test } from "bun:test";
import { sizeEditor } from "./ComposerEditor";

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

test("clearing a draft returns the editor to its minimum height", () => {
  const input = editor(20, 10);
  input.style.height = "220px";
  sizeEditor(input);
  expect(input.style.height).toBe("32px");
  expect(input.scrollTop).toBe(0);
});
