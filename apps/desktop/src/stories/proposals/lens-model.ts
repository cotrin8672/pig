import type { ChatRenderData } from "@pig/chat-renderers";
import { output, toolArgs } from "./model";

/** Small helpers over tool output, shared by the extension proposals. */
type Tool = ChatRenderData["tool"];

/** pi-lens appends a "result ok / usage …" trailer that is not part of the answer. */
export const body = (tool: Tool) =>
  output(tool)
    .replace(/\n*result (ok|error)\nusage [^\n]*\s*$/, "")
    .trimEnd();
export const args = toolArgs;
export const str = (value: unknown) => (typeof value === "string" ? value : "");
export const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const list = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export function details(tool: Tool): Record<string, unknown> {
  const value = (tool.state?.result as { details?: unknown } | undefined)
    ?.details;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
export const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
export const dirName = (path: string) =>
  path.split(/[\\/]/).slice(0, -1).join("/");
