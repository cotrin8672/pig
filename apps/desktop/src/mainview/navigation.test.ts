import { expect, test } from "bun:test";
import { historyEntry } from "./navigation";

test("history entries restore known pages and only string session keys", () => {
  expect(historyEntry({ page: "settings", sessionKey: "s1" })).toEqual({
    page: "settings",
    sessionKey: "s1",
  });
  expect(historyEntry({ page: "chat", sessionKey: 123 })).toEqual({
    page: "chat",
  });
  for (const value of [null, undefined, "chat", { page: "missing" }])
    expect(historyEntry(value)).toEqual({ page: "chat" });
});
