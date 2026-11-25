import { CODEX_SUBAGENT_COMPLETION } from "../shared/supported-extensions";
import type { TranscriptRecord } from "../shared/transcript";
import { dataText } from "./custom-data";

export type Inbound = {
  sender: string;
  /** Agent status (completed, failed, …) when the sender is a subagent. */
  status?: string;
  text: string;
  subagent: boolean;
};

type Value = Record<string, unknown>;
const obj = (value: unknown): Value =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : {};
const str = (value: unknown) => (typeof value === "string" ? value : "");

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : dataText(content);
  return content
    .flatMap((block) => {
      const item = obj(block);
      if (item.type === "image") return [];
      return [item.type === "text" ? str(item.text) : dataText(block, true)];
    })
    .join("\n");
}

/** An extension message to the agent, as the sender and the text it sent. */
export function inboundMessage(record: TranscriptRecord): Inbound | undefined {
  if (record.kind !== "message" || record.message.role !== "custom") return;
  const { customType, content } = record.message;
  const text = contentText(content);
  if (customType === "pig-subagent-completion") {
    const d = obj(record.message.details ?? record.details);
    return {
      sender: str(d.agent_name) || str(d.task_name) || customType,
      status: str(d.status) || undefined,
      text: str(d.final_response) || str(d.error) || text,
      subagent: true,
    };
  }
  if (customType !== CODEX_SUBAGENT_COMPLETION)
    return { sender: customType, text, subagent: false };
  const details = obj(record.message.details ?? record.details);
  const payload =
    /<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>/.exec(
      text,
    )?.[1] ?? text;
  let parsed: Value = {};
  try {
    parsed = obj(JSON.parse(payload));
  } catch {
    // Oversized results are truncated JSON; show them as they are.
  }
  return {
    sender: str(details.agent_name) || str(parsed.agent_name) || customType,
    status: str(details.status) || str(parsed.status) || undefined,
    text: str(parsed.final_response) || str(parsed.error) || payload,
    subagent: true,
  };
}
