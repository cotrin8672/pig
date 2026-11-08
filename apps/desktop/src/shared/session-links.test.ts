import { expect, test } from "bun:test";
import { sessionIdFromLink, sessionLink } from "./session-links";

test("builds encoded pig session links and round-trips valid local IDs", () => {
  expect(sessionLink("local-id")).toBe("pig://session/local-id");
  expect(sessionLink("chat:?#%日本")).toBe(
    `pig://session/${encodeURIComponent("chat:?#%日本")}`,
  );
  for (const id of ["local-id", "chat:?#%日本", "x".repeat(128)]) {
    expect(sessionIdFromLink(sessionLink(id))).toBe(id);
  }
  expect(sessionIdFromLink("  pig://session/local-id  ")).toBe("local-id");
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
