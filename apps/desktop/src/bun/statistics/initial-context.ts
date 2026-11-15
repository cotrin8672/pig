import {
  getCurrentSystemMessage,
  getCurrentTools,
  type SystemMessage,
} from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Messages = Parameters<
  NonNullable<AgentSession["agent"]["transformContext"]>
>[0];
const estimate = (text: string) => Math.ceil(text.length / 3.5);

/** Counts the normalized first request after context hooks; never retains its text. */
export function initialContextMetadata(
  messages: Messages,
  contextWindow: number | null,
) {
  if (messages.some((m) => m.role === "assistant")) return null;
  const systems = messages.filter(
    (m): m is SystemMessage => m.role === "system",
  );
  const system = getCurrentSystemMessage(systems);
  if (!system) return null;
  const amounts = new Map<string, number>();
  const add = (id: string, text: string) =>
    amounts.set(id, (amounts.get(id) ?? 0) + estimate(text));
  const content =
    typeof system.content === "string"
      ? system.content
      : system.content.map((part) => part.text).join("\n");
  if (content) add("base", content);
  for (const [name, text] of Object.entries(system.sections ?? {})) {
    if (!text) continue;
    const id =
      name === "project_context"
        ? "agents"
        : name === "skills"
          ? "skills"
          : ["preamble", "tools", "rules", "docs", "addendum"].includes(name)
            ? "base"
            : name === "cwd"
              ? "other"
              : "extensions";
    add(id, text);
  }
  const tools = getCurrentTools(systems).map((tool) => ({
    name: tool.name,
    tokens: estimate(JSON.stringify(tool)),
  }));
  amounts.set(
    "tools",
    tools.reduce((n, t) => n + t.tokens, 0),
  );
  const parts = ["base", "tools", "agents", "skills", "extensions", "other"]
    .filter((id) => (amounts.get(id) ?? 0) > 0)
    .map((id) => ({ id, label: id, tokens: amounts.get(id) ?? 0 }));
  return {
    parts,
    tools,
    contextWindow,
    estimateMethod: "chars/3.5",
    stage: "normalized-request",
  };
}
