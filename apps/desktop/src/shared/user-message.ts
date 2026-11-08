import type { Message } from "./transcript";

export function editUserMessage(
  message: Extract<Message, { role: "user" }>,
  text: string,
): Extract<Message, { role: "user" }> {
  return {
    ...message,
    content:
      typeof message.content === "string"
        ? text
        : [
            { type: "text", text },
            ...message.content.filter((block) => block.type === "image"),
          ],
  };
}
