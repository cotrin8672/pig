import type {
  ChatHistoryItem,
  ChatHistoryWarning,
} from "../shared/chat-history-import";

export const MAX_CHAT_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_CONVERSATIONS = 5000;
const MAX_NODES = 100_000;

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const identifier = (value: unknown) => text(value).slice(0, 512);
const parentIdentifier = (value: unknown) => {
  const id = identifier(value);
  return !id || id === "00000000-0000-0000-0000-000000000000" ? null : id;
};

export interface HistoryNode {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  model: string;
}

export interface HistoryConversation extends ChatHistoryItem {
  sourceId: string;
  nodes: HistoryNode[];
  activeId: string;
}

export interface ParsedChatHistory {
  conversations: HistoryConversation[];
  rejected: number;
}

type RawNode = {
  id: string;
  parentId: string | null;
  message?: Omit<HistoryNode, "id" | "parentId">;
};

function timestamp(value: unknown, seconds: boolean, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value * (seconds ? 1000 : 1)
      : typeof value === "string" && value
        ? Date.parse(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 8.64e15
    ? parsed
    : fallback;
}

function conversation(value: unknown, index: number): HistoryConversation {
  const input = object(value);
  if (!input) throw new Error("Invalid conversation");
  const mapping = object(input.mapping);
  const source = mapping ? "chatgpt" : "claude";
  if (!mapping && !Array.isArray(input.chat_messages))
    throw new Error("Unrecognized conversation");
  const warnings = new Set<ChatHistoryWarning>();
  const created = timestamp(
    input.create_time ?? input.created_at,
    source === "chatgpt",
    0,
  );
  const raw: RawNode[] = [];
  const add = (
    id: string,
    parentId: string | null,
    message: ObjectValue | undefined,
  ) => {
    const node: RawNode = { id, parentId };
    raw.push(node);
    if (!id || !message) return;
    const author = object(message.author);
    const role = source === "chatgpt" ? author?.role : message.sender;
    if (role === "system" || role === "developer") {
      warnings.add("instructions");
      return;
    }
    if (role === "tool") {
      warnings.add("tools");
      return;
    }
    if (role !== "user" && role !== "human" && role !== "assistant") {
      warnings.add("unsupported");
      return;
    }
    const metadata = object(message.metadata);
    if (metadata?.is_visually_hidden_from_conversation === true) return;
    if (message.channel === "analysis") {
      warnings.add("reasoning");
      return;
    }
    if (
      typeof message.recipient === "string" &&
      message.recipient !== "all" &&
      message.recipient !== "assistant"
    ) {
      warnings.add("tools");
      return;
    }
    for (const key of ["attachments", "files"])
      if (
        [message[key], metadata?.[key]].some(
          (value) => Array.isArray(value) && value.length,
        )
      )
        warnings.add("attachments");
    let body = "";
    if (source === "chatgpt") {
      const content = object(message.content);
      const kind = text(content?.content_type);
      if (/thought|reasoning/.test(kind)) {
        warnings.add("reasoning");
        return;
      }
      if (Array.isArray(content?.parts)) {
        body = content.parts
          .filter((part) => typeof part === "string")
          .join("\n");
        if (content.parts.some((part) => typeof part !== "string"))
          warnings.add("attachments");
      } else body = text(content?.text);
      if (!body && kind && kind !== "text") warnings.add("unsupported");
    } else if (Array.isArray(message.content) && message.content.length) {
      body = message.content
        .flatMap((value) => {
          const block = object(value);
          if (block?.type === "text") return [text(block.text)];
          warnings.add(
            block?.type === "thinking" || block?.type === "redacted_thinking"
              ? "reasoning"
              : block?.type === "tool_use" || block?.type === "tool_result"
                ? "tools"
                : "attachments",
          );
          return [];
        })
        .join("\n\n");
    } else body = text(message.text);
    if (!body.trim()) return;
    node.message = {
      role: role === "assistant" ? "assistant" : "user",
      text: body,
      timestamp: timestamp(
        message.create_time ?? message.created_at,
        source === "chatgpt",
        created,
      ),
      model: text(metadata?.model_slug ?? message.model).slice(0, 256),
    };
  };
  if (mapping) {
    if (Object.keys(mapping).length > MAX_NODES)
      throw new Error("Too many messages");
    for (const [id, value] of Object.entries(mapping)) {
      const node = object(value);
      if (!node || id.length > 512) throw new Error("Invalid message node");
      add(id, parentIdentifier(node.parent), object(node.message));
    }
  } else {
    const messages = input.chat_messages as unknown[];
    if (messages.length > MAX_NODES) throw new Error("Too many messages");
    const explicitParents = messages.some((value) => {
      const message = object(value);
      return message && Object.hasOwn(message, "parent_message_uuid");
    });
    let previous: string | null = null;
    for (const [i, value] of messages.entries()) {
      const message = object(value);
      if (!message) throw new Error("Invalid message node");
      const id = identifier(message.uuid) || `message-${i}`;
      add(
        id,
        explicitParents
          ? parentIdentifier(message.parent_message_uuid)
          : previous,
        message,
      );
      previous = id;
    }
  }
  // Resolve skipped nodes once, in parent-first order; never flatten branches by date.
  const byId = new Map(raw.map((node) => [node.id, node]));
  if (byId.size !== raw.length) throw new Error("Duplicate message IDs");
  const children = new Map<string, RawNode[]>();
  const queue: RawNode[] = [];
  for (const node of raw) {
    if (node.parentId && !byId.has(node.parentId)) {
      node.parentId = null;
      warnings.add("branches");
    }
    if (node.parentId) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    } else queue.push(node);
  }
  const nearest = new Map<string, string | null>();
  const nodes: HistoryNode[] = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const parentId = (node.parentId && nearest.get(node.parentId)) || null;
    if (node.message) nodes.push({ id: node.id, parentId, ...node.message });
    nearest.set(node.id, node.message ? node.id : parentId);
    for (const child of children.get(node.id) ?? []) queue.push(child);
  }
  if (queue.length !== raw.length) throw new Error("Cyclic message tree");
  if (!nodes.length) throw new Error("No importable messages");
  const selected = identifier(
    input.current_node ?? input.current_leaf_message_uuid,
  );
  const activeId = (selected && nearest.get(selected)) || nodes.at(-1)?.id;
  if (selected && !nearest.get(selected)) warnings.add("branches");
  return {
    id: String(index),
    source,
    sourceId: identifier(input.conversation_id ?? input.id ?? input.uuid),
    title:
      text(input.title ?? input.name)
        .trim()
        .slice(0, 512) || "Untitled chat",
    modified: nodes.reduce(
      (latest, node) => Math.max(latest, node.timestamp),
      0,
    ),
    messageCount: nodes.length,
    warnings: [...warnings],
    nodes,
    activeId: activeId as string,
  };
}

export function parseChatHistory(json: string): ParsedChatHistory {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    // JSON.parse errors can include private message text.
    throw new Error(
      "Invalid JSON. Select the exported conversations.json file.",
    );
  }
  const items = Array.isArray(input) ? input : [input];
  if (!items.length || items.length > MAX_CONVERSATIONS)
    throw new Error(
      `Choose a JSON file with 1–${MAX_CONVERSATIONS} conversations.`,
    );
  const conversations: HistoryConversation[] = [];
  let rejected = 0;
  for (const [index, item] of items.entries()) {
    try {
      conversations.push(conversation(item, index));
    } catch {
      rejected++;
    }
  }
  if (!conversations.length)
    throw new Error("No readable ChatGPT or Claude conversations were found.");
  return { conversations, rejected };
}
