import {
  MAX_CHAT_HISTORY_BYTES,
  type ParsedChatHistory,
  parseChatHistory,
} from "./chat-history-parser";

export type ChatHistoryWorkerReply =
  | { parsed: ParsedChatHistory }
  | { error: string };

// SAFETY: this entrypoint runs only in a Bun Worker, whose self is its message port.
const port = self as unknown as {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  postMessage: (value: ChatHistoryWorkerReply) => void;
};
port.onmessage = async ({ data: file }) => {
  try {
    const bytes = await Bun.file(file)
      .slice(0, MAX_CHAT_HISTORY_BYTES + 1)
      .arrayBuffer();
    if (bytes.byteLength > MAX_CHAT_HISTORY_BYTES)
      throw new Error(
        "The export is too large. Select a JSON file up to 32 MiB.",
      );
    port.postMessage({
      parsed: parseChatHistory(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
    });
  } catch (error) {
    port.postMessage({
      error:
        error instanceof Error && !("code" in error)
          ? error.message
          : "Could not read the conversation export.",
    });
  }
};
