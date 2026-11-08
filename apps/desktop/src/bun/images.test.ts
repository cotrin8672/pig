import { expect, mock, test } from "bun:test";

mock.module("electrobun/bun", () => ({ ContextMenu: {}, Utils: {} }));
const { decodeDataUrl, imageExtension } = await import("./images");

test("decodes base64 image data URLs only", () => {
  const decoded = decodeDataUrl("data:image/png;base64,aGk=");
  expect(decoded?.mimeType).toBe("image/png");
  expect(decoded?.bytes.toString()).toBe("hi");
  expect(decodeDataUrl("data:text/html;base64,aGk=")).toBeUndefined();
  expect(decodeDataUrl("https://example.com/a.png")).toBeUndefined();
});

test("derives safe file extensions", () => {
  expect(imageExtension("image/jpeg")).toBe("jpg");
  expect(imageExtension("image/svg+xml")).toBe("svg");
  expect(imageExtension("image/../../x")).toBe("img");
});
