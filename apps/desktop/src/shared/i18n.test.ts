import { expect, test } from "bun:test";
import { dictionary, en, ja } from "./i18n";

test("Japanese dictionary covers English keys and preserves parameterized user values", () => {
  expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  expect(dictionary("ja").newChatIn("my-project")).toContain("my-project");
  expect(dictionary("ja").workingIn("C:\\work")).toContain("C:\\work");
  expect(dictionary("en").context(50, "used", "50k", "100k")).toBe(
    "50% context used, 50k tokens (100k total)",
  );
  expect(dictionary("ja").Settings).toBe("設定");
});
