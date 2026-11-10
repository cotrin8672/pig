import { expect, test } from "bun:test";
import {
  inputBytes,
  sameAddress,
  TerminalRateLimit,
  terminalAddressKey,
  utf8Bytes,
  validAddress,
  validDimensions,
  validSequence,
} from "./terminal-ui";

test("wire address needs session+epoch+uiId, with collision-free key and safe epoch", () => {
  const a = { sessionId: "s:a", epoch: 1, uiId: "b" };
  expect(validAddress(a)).toBe(true);
  for (const bad of [
    null,
    {},
    { ...a, epoch: -1 },
    { ...a, epoch: 1.5 },
    { ...a, epoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...a, uiId: "" },
    { ...a, sessionId: 42 },
  ])
    expect(validAddress(bad)).toBe(false);
  expect(sameAddress(a, { ...a })).toBe(true);
  expect(sameAddress(a, { ...a, epoch: 2 })).toBe(false);
  expect(sameAddress(a, { ...a, sessionId: "other" })).toBe(false);
  expect(terminalAddressKey(a)).not.toBe(
    terminalAddressKey({ sessionId: "s", epoch: 1, uiId: "a:b" }),
  );
});
test("bounds use bytes; binary is Latin-1 not UTF-8 and rejects non-bytes", () => {
  expect(utf8Bytes("界😀")).toBe(7);
  expect(inputBytes("\xff\x80", "binary")).toBe(2);
  expect(inputBytes("\xff\x80", "text")).toBe(4);
  expect(() => inputBytes("界", "binary")).toThrow(TypeError);
  for (const n of [0, -1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(validSequence(n)).toBe(false);
  expect(validSequence(1)).toBe(true);
  expect(validDimensions(2, 2)).toBe(true);
  expect(validDimensions(500, 200)).toBe(true);
  for (const [cols, rows] of [
    [1, 24],
    [501, 24],
    [80, 201],
    [80.5, 24],
    [80, NaN],
  ])
    expect(validDimensions(cols, rows)).toBe(false);
});
test("rate limit bounds frequency without retaining event arrays", () => {
  const limit = new TerminalRateLimit(2);
  expect(limit.accept(10)).toBe(true);
  expect(limit.accept(10)).toBe(true);
  expect(limit.accept(10)).toBe(false);
  expect(limit.accept(1010)).toBe(true);
  expect(limit.accept(1010)).toBe(true);
  expect(limit.accept(1010)).toBe(false);
});
