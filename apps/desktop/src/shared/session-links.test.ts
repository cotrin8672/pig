import { expect, test } from "bun:test";
import { sessionIdFromLink, sessionLink } from "./session-links";

test("opaque SDK IDs round trip; legacy numeric links are rejected", () => {
  for (const id of [
    "local-id",
    "21a69fe6-8262-408a-aac1-402760e1f876",
    "Mixed_opaque-ID",
  ])
    expect(sessionIdFromLink(sessionLink(id))).toBe(id);
  expect(sessionIdFromLink(" pig://session/12 ")).toBeUndefined();
  expect(sessionIdFromLink(sessionLink("legacy-durable:12"))).toBeUndefined();
  expect(sessionIdFromLink(sessionLink("9007199254740992"))).toBeUndefined();
});
test("rejects traversal, unsafe identifiers, non-local URLs, query and hash", () => {
  for (const url of [
    "file:///fixture/chat.jsonl",
    "https://session/id",
    "pig://other/id",
    "pig://user:password@session/id",
    "pig://session:123/id",
    "pig://session/id?",
    "pig://session/id#fragment",
    "pig://session/",
    "pig://session/folder/../id",
    "pig://session/folder%2Fid",
    "pig://session/folder%5Cid",
    "pig://session/%00",
    "pig://session/space%20id",
    "pig://session/%ZZ",
    "pig://session/%E0%A4%A",
    `pig://session/${"x".repeat(129)}`,
    "pig://session/0",
    "pig://session/01",
  ])
    expect(sessionIdFromLink(url)).toBeUndefined();
});
