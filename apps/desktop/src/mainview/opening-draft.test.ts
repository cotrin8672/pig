import { expect, test } from "bun:test";
import { emptyContent } from "./draft-store";
import { mergeOpeningText } from "./opening-draft";

test("text entered during startup is retained without losing extension draft content", () => {
  const image = {
    id: "image",
    image: { type: "image" as const, mimeType: "image/png", data: "YWJj" },
  };
  const original = { ...emptyContent(), text: "extension", images: [image] };
  const merged = mergeOpeningText(original, "user input");
  expect(merged.text).toBe("extension\nuser input");
  expect(merged.images).toEqual([image]);
  expect(original.text).toBe("extension");
  expect(mergeOpeningText(emptyContent(), "user input").text).toBe(
    "user input",
  );
  expect(mergeOpeningText(original, "").text).toBe("extension");
});
