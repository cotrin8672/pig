import type { ToolCard } from "@pig/config";
import type { ComponentType } from "react";

export interface ChatRenderData {
  markdown: { text: string };
  image: { sources: string[]; alt?: string };
  thinking: { text: string; label: string; active: boolean };
  error: { message: string; stopReason?: string };
  tool: {
    call: { id: string; name: string; arguments: Record<string, unknown> };
    state?: { status: "running" | "done" | "error"; result?: unknown };
    live: boolean;
    card?: ToolCard;
  };
  custom: {
    id: string;
    entryId?: string;
    customType: string;
    content: unknown;
    details?: unknown;
    raw: unknown;
  };
}
export type ChatRenderKind = keyof ChatRenderData;
export interface ChatRendererProps<K extends ChatRenderKind> {
  data: ChatRenderData[K];
  /** The unchanged built-in renderer, bypassing custom matching for this item. */
  DefaultRenderer: ComponentType;
}
export type ChatRendererComponent<K extends ChatRenderKind> = ComponentType<
  ChatRendererProps<K>
>;
export type ChatRenderer<K extends ChatRenderKind = ChatRenderKind> = {
  [P in K]: {
    id: string;
    kind: P;
    /** Optional JSON predicate; first matching renderer wins. */
    match?: (data: ChatRenderData[P]) => boolean;
    component: ChatRendererComponent<P>;
  };
}[K];

/** Browser-only definitions. These are trusted local code, not tool-result data. */
export function defineChatRenderers(
  renderers: readonly ChatRenderer[],
): readonly ChatRenderer[] {
  return renderers;
}
