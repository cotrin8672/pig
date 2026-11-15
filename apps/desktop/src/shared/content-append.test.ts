import { expect, test } from "bun:test";
import {
  contentBase,
  encodeContentAppend,
  expandContentAppend,
} from "./content-append";

test("text and thinking append losslessly without retaining or changing other block data", () => {
  const text = '日本語 "quotes" \\ \n\u2028🙂'.repeat(100);
  const previous = [
    { type: "text", text, metadata: { old: true } },
    { type: "thinking", thinking: text, thinkingSignature: "old" },
    { type: "image", data: "unchanged" },
  ];
  const base = contentBase(previous);
  previous[0].metadata = { old: false };
  const next = [
    { type: "text", text: `${text}追加`, metadata: { next: true } },
    { type: "thinking", thinking: text, thinkingSignature: "new" },
    { type: "image", data: "changed" },
  ];
  const encoded = encodeContentAppend(next, base);
  expect(encoded?.appends).toEqual([
    { index: 0, field: "text", from: text.length },
    { index: 1, field: "thinking", from: text.length },
  ]);
  expect(encoded?.content[0].text).toBe("追加");
  expect(encoded?.content[1].thinking).toBe("");
  expect(
    expandContentAppend(
      encoded?.content ?? [],
      previous,
      encoded?.appends ?? [],
    ),
  ).toEqual(next);
  expect(next[0].text).toBe(`${text}追加`);
  expect(previous[0].text).toBe(text);
  expect(base?.[0]).not.toHaveProperty("metadata");
  expect(base?.[2]).toBeUndefined();
});

test("replacement, truncation, type changes, short strings and arbitrary payloads stay complete", () => {
  const previous = [{ type: "text", text: "a".repeat(1000) }];
  for (const next of [
    [{ type: "text", text: "a".repeat(999) }],
    [{ type: "text", text: `${"a".repeat(999)}b` }],
    [{ type: "thinking", thinking: "a".repeat(1000) }],
    [{ type: "toolCall", arguments: { text: "a".repeat(1000) } }],
  ])
    expect(
      encodeContentAppend<unknown>(next, contentBase(previous)),
    ).toBeUndefined();
  expect(
    encodeContentAppend(
      [{ type: "text", text: "ab" }],
      contentBase([{ type: "text", text: "a" }]),
    ),
  ).toBeUndefined();
  for (const value of [null, undefined, "text", { content: "text" }])
    expect(contentBase(value)).toBeUndefined();
});

test("invalid references never become partially reconstructed content", () => {
  const previous = [{ type: "text", text: "a".repeat(1000) }];
  const next = [{ type: "text", text: "appended" }];
  const valid = { index: 0, field: "text" as const, from: 1000 };
  for (const patch of [
    { ...valid, index: -1 },
    { ...valid, index: 1 },
    { ...valid, index: 0.5 },
    { ...valid, from: 999 },
    { ...valid, field: "thinking" as const },
  ])
    expect(expandContentAppend(next, previous, [patch])).toBeUndefined();
  expect(expandContentAppend(next, previous, [valid, valid])).toBeUndefined();
  expect(expandContentAppend(next, undefined, [valid])).toBeUndefined();
  expect(next[0].text).toBe("appended");
});
