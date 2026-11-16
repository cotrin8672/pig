import {
  getCurrentSystemMessage,
  getCurrentTools,
  type SystemMessage,
} from "@earendil-works/pi-ai";
import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";

type Messages = Parameters<
  NonNullable<AgentSession["agent"]["transformContext"]>
>[0];
const estimate = (text: string) => Math.ceil(text.length / 3.5);
const tail = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? path;

/** Short display name of the resource that registered a tool; never a full path. */
export function toolSourceLabel(info: ToolInfo["sourceInfo"] | undefined) {
  if (!info) return null;
  if (info.path.startsWith("builtin:")) return "builtin";
  if (info.path.startsWith("<"))
    return info.path.slice(1, -1).split(":")[0] || "temporary";
  if (info.origin === "package") {
    const source = info.source.replace(/^(npm|git|github):/, "");
    // npm names keep their scope; git URLs and local paths use the last segment.
    if (/^@?[\w.-]+(\/[\w.-]+)?(@[^/]*)?$/.test(source))
      return source.replace(/(.)@[^/]*$/, "$1");
    return tail(source)
      .replace(/@[^@]*$/, "")
      .replace(/\.git$/, "");
  }
  const file = tail(info.path);
  return /^index\.[cm]?[jt]s$/.test(file)
    ? tail(info.path.slice(0, -file.length))
    : file.replace(/\.[cm]?[jt]s$/, "");
}

/** How each SDK system prompt section is grouped in the overview donut. */
const partOf = (section: string) =>
  section === "project_context"
    ? "agents"
    : section === "skills"
      ? "skills"
      : section === "tools" || section === "rules"
        ? "toolPrompts"
        : ["content", "preamble", "docs", "cwd"].includes(section)
          ? "base"
          : "extensions";

/** Counts the normalized first request after context hooks; never retains its text. */
export function initialContextMetadata(
  messages: Messages,
  contextWindow: number | null,
  sources: ReadonlyMap<string, string | null> = new Map(),
) {
  if (messages.some((m) => m.role === "assistant")) return null;
  const systems = messages.filter(
    (m): m is SystemMessage => m.role === "system",
  );
  const system = getCurrentSystemMessage(systems);
  if (!system) return null;
  const sections: { id: string; tokens: number }[] = [];
  const content =
    typeof system.content === "string"
      ? system.content
      : system.content.map((part) => part.text).join("\n");
  if (content) sections.push({ id: "content", tokens: estimate(content) });
  for (const [id, text] of Object.entries(system.sections ?? {}))
    if (text) sections.push({ id, tokens: estimate(text) });
  const tools = getCurrentTools(systems).map((tool) => ({
    name: tool.name,
    tokens: estimate(JSON.stringify(tool)),
    source: sources.get(tool.name) ?? null,
  }));
  const amounts = new Map<string, number>();
  for (const s of sections)
    amounts.set(partOf(s.id), (amounts.get(partOf(s.id)) ?? 0) + s.tokens);
  amounts.set(
    "tools",
    tools.reduce((n, t) => n + t.tokens, 0),
  );
  const parts = [
    "base",
    "toolPrompts",
    "tools",
    "agents",
    "skills",
    "extensions",
  ]
    .filter((id) => (amounts.get(id) ?? 0) > 0)
    .map((id) => ({ id, label: id, tokens: amounts.get(id) ?? 0 }));
  return {
    parts,
    sections,
    tools,
    contextWindow,
    estimateMethod: "chars/3.5",
    stage: "normalized-request",
  };
}
