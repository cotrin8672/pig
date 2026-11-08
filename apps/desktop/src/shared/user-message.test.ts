import { expect, test } from "bun:test";
import { editUserMessage } from "./user-message";

test("editing text preserves the rewind target and leaves the original unchanged", () => {
  const message = { role: "user" as const, timestamp: 123, content: "before" };
  expect(editUserMessage(message, "after")).toEqual({
    ...message,
    content: "after",
  });
  expect(message.content).toBe("before");
});

test("editing replaces text blocks but keeps attached images, including image-only sends", () => {
  const image = { type: "image" as const, data: "abc", mimeType: "image/png" };
  const message = {
    role: "user" as const,
    timestamp: 123,
    content: [
      { type: "text" as const, text: "first" },
      image,
      { type: "text" as const, text: "second" },
    ],
  };
  expect(editUserMessage(message, "edited").content).toEqual([
    { type: "text", text: "edited" },
    image,
  ]);
  expect(editUserMessage(message, "").content).toEqual([
    { type: "text", text: "" },
    image,
  ]);
  expect(message.content).toHaveLength(3);
});
