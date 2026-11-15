import { expect, spyOn, test } from "bun:test";
import { cloneProjection } from "./clone-projection";

test("large live strings bypass native cloning while every mutable container is isolated", () => {
  const input = {
    text: "large 日本語\n".repeat(128 * 1024),
    blocks: [
      { type: "text", text: "answer".repeat(128 * 1024) },
      { type: "image", data: "A".repeat(128 * 1024) },
    ],
    details: { progress: [1, 2], optional: undefined, count: 1n },
  };
  const expected = structuredClone(input);
  const native = spyOn(globalThis, "structuredClone");
  try {
    const result = cloneProjection(input);
    expect(native).not.toHaveBeenCalled();
    expect(result).toEqual(expected);
    expect(result).not.toBe(input);
    expect(result.blocks).not.toBe(input.blocks);
    expect(result.blocks[0]).not.toBe(input.blocks[0]);
    expect(result.details.progress).not.toBe(input.details.progress);
    input.blocks[0].text = "changed";
    input.details.progress.push(3);
    expect(result.blocks[0].text).toBe(expected.blocks[0].text);
    expect(result.details.progress).toEqual([1, 2]);
    result.blocks[1].data = "changed";
    expect(input.blocks[1].data).toBe(expected.blocks[1].data);
  } finally {
    native.mockRestore();
  }
});

test("cycles, shared references, sparse arrays, null prototypes and special keys match native cloning", () => {
  const shared = { text: "shared" };
  const input = Object.assign(Object.create(null), {
    one: shared,
    two: shared,
    sparse: new Array(3),
  });
  input.self = input;
  input.sparse[2] = shared;
  Object.defineProperty(input, "__proto__", {
    value: { safe: true },
    enumerable: true,
  });
  const result = cloneProjection(input);
  expect(result).toEqual(structuredClone(input));
  expect(result.one).toBe(result.two);
  expect(result.self).toBe(result);
  expect(result.sparse[2]).toBe(result.one);
  expect(Object.hasOwn(result.sparse, 0)).toBe(false);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(result)).not.toHaveProperty("safe");
});

test("rich values fall back for the whole graph, preserving aliases across containers", () => {
  const shared = { value: 1 };
  const input = {
    shared,
    map: new Map([["shared", shared]]),
    set: new Set([shared]),
    time: new Date(123),
    bytes: new Uint8Array([1, 2, 3]),
  };
  const result = cloneProjection(input);
  expect(result).toEqual(structuredClone(input));
  expect(result.map.get("shared")).toBe(result.shared);
  expect([...result.set][0]).toBe(result.shared);
  result.bytes[0] = 9;
  expect(input.bytes[0]).toBe(1);
});

test("fallback invokes getters once and does not silently accept non-cloneable values", () => {
  let reads = 0;
  const input = {
    get text() {
      return String(++reads);
    },
  };
  expect(cloneProjection(input)).toEqual({ text: "1" });
  expect(reads).toBe(1);
  for (const value of [() => {}, Symbol("x"), new Proxy({}, {})])
    expect(() => cloneProjection({ value })).toThrow();
});

test("wide and deep payloads retain native support instead of adding a new data limit", () => {
  const wide = {
    lines: Array.from({ length: 300 }, (_, index) => ({ index })),
  };
  let deep: { child?: unknown } = {};
  for (let index = 0; index < 70; index++) deep = { child: deep };
  for (const input of [wide, deep])
    expect(cloneProjection(input)).toEqual(structuredClone(input));
});
