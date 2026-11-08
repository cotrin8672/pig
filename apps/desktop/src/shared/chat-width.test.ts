import { expect, test } from "bun:test";
import { clampChatWidth, DEFAULT_CHAT_WIDTH } from "./chat-width";

test("chat width stays in bounds and rounds to pixels", () => {
  expect(clampChatWidth(0)).toBe(480);
  expect(clampChatWidth(2000)).toBe(1600);
  expect(clampChatWidth(900.8)).toBe(901);
  expect(clampChatWidth(DEFAULT_CHAT_WIDTH)).toBe(768);
});
test("invalid saved widths use the default", () => {
  expect(clampChatWidth(Number.NaN)).toBe(DEFAULT_CHAT_WIDTH);
  expect(clampChatWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAT_WIDTH);
});
