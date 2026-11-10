import { expect, test } from "bun:test";
import { isThreadAtBottom } from "./thread-scroll";

test("leaving the bottom stops following; returning to the bottom resumes it", () => {
  const element = { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 };
  expect(isThreadAtBottom(element)).toBe(true);
  element.scrollTop = 1200;
  expect(isThreadAtBottom(element)).toBe(false);
  element.scrollHeight = 2400;
  expect(isThreadAtBottom(element)).toBe(false);
  element.scrollTop = 1900;
  expect(isThreadAtBottom(element)).toBe(true);
});

test("bottom detection tolerates fractional pixels and content shorter than the viewport", () => {
  expect(
    isThreadAtBottom({
      scrollHeight: 2000,
      clientHeight: 500,
      scrollTop: 1499.5,
    }),
  ).toBe(true);
  expect(
    isThreadAtBottom({
      scrollHeight: 2000,
      clientHeight: 500,
      scrollTop: 1498,
    }),
  ).toBe(false);
  expect(
    isThreadAtBottom({ scrollHeight: 300, clientHeight: 500, scrollTop: 0 }),
  ).toBe(true);
});
