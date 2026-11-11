import type { Effort } from "./rpc-schema";

const efforts: readonly Effort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
// The subset of pi's models.json `modelOverrides` entry that pig edits.
export interface ModelOverride {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Partial<Record<Effort, string | null>>;
  input?: ("text" | "image")[];
  compat?: { forceAdaptiveThinking?: boolean };
}

const limit = (value: unknown, field: string) => {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1e8
  )
    throw new Error(`Invalid ${field}.`);
  return value as number;
};

// Trust boundary: RPC input becomes pi's models.json shared with the pi CLI.
export function sanitizeOverride(value: unknown): ModelOverride {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model settings.");
  const input = value as Record<string, unknown>;
  const allowed = [
    "name",
    "contextWindow",
    "maxTokens",
    "thinkingLevelMap",
    "input",
    "compat",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Invalid model settings.");
  const out: ModelOverride = {};
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || [...name].length > 60) throw new Error("Invalid alias.");
    out.name = name;
  }
  if (input.contextWindow !== undefined)
    out.contextWindow = limit(input.contextWindow, "context window");
  if (input.maxTokens !== undefined)
    out.maxTokens = limit(input.maxTokens, "max output");
  if (input.thinkingLevelMap !== undefined) {
    const map = input.thinkingLevelMap;
    if (!map || typeof map !== "object" || Array.isArray(map))
      throw new Error("Invalid thinking levels.");
    for (const [level, wire] of Object.entries(map))
      if (
        !efforts.includes(level as Effort) ||
        (wire !== null &&
          (typeof wire !== "string" || !wire || wire.length > 64))
      )
        throw new Error("Invalid thinking levels.");
    if (Object.keys(map).length)
      out.thinkingLevelMap = map as ModelOverride["thinkingLevelMap"];
  }
  if (input.input !== undefined) {
    const kinds = input.input;
    if (
      !Array.isArray(kinds) ||
      !kinds.includes("text") ||
      kinds.some((kind) => kind !== "text" && kind !== "image") ||
      new Set(kinds).size !== kinds.length
    )
      throw new Error("Invalid input types.");
    out.input = kinds as ModelOverride["input"];
  }
  if (input.compat !== undefined) {
    const compat = input.compat as Record<string, unknown> | null;
    if (
      !compat ||
      typeof compat !== "object" ||
      Object.keys(compat).some((key) => key !== "forceAdaptiveThinking") ||
      (compat.forceAdaptiveThinking !== undefined &&
        typeof compat.forceAdaptiveThinking !== "boolean")
    )
      throw new Error("Invalid thinking protocol.");
    if (compat.forceAdaptiveThinking !== undefined)
      out.compat = { forceAdaptiveThinking: compat.forceAdaptiveThinking };
  }
  return out;
}
