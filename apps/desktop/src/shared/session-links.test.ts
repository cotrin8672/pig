import { expect, test } from "bun:test";
import { sessionIdFromLink, sessionLink } from "./session-links";

test("Durable numeric conversation IDs round trip as strings", () => {
  expect(sessionLink("12")).toBe("pig://session/12");
  for (const id of ["1", "12", String(Number.MAX_SAFE_INTEGER)])
    expect(sessionIdFromLink(sessionLink(id))).toBe(id);
  expect(sessionIdFromLink("  pig://session/12  ")).toBe("12");
  for (const id of [
    "0",
    "01",
    "-1",
    "1.5",
    "1e2",
    "9007199254740992",
    "legacy-id",
  ])
    expect(sessionIdFromLink(sessionLink(id))).toBeUndefined();
});

test("rejects paths, non-local links, credentials, query/hash, and malformed or unsafe IDs", () => {
  const invalid = [
    "C:\\fixture\\chat.jsonl",
    "file:///fixture/chat.jsonl",
    "https://session/local-id",
    "pig://other/local-id",
    "pig://user:password@session/local-id",
    "pig://session:123/local-id",
    "pig://session/local-id?cwd=elsewhere",
    "pig://session/local-id#fragment",
    "pig://session/local-id?",
    "pig://session/local-id#",
    "pig://session/",
    "pig://session/folder/local-id",
    "pig://session/folder/../local-id",
    "pig://session/folder%2Flocal-id",
    "pig://session/folder%5Clocal-id",
    "pig://session/%00",
    "pig://session/space%20id",
    "pig://session/%ZZ",
    "pig://session/%E0%A4%A",
    `pig://session/${"x".repeat(129)}`,
  ];
  const accepted = invalid.flatMap((link) => {
    const id = sessionIdFromLink(link);
    return id === undefined ? [] : [{ link, id }];
  });
  expect(accepted).toEqual([]);
});
