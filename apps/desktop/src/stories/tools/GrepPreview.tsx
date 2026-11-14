import type { ChatRendererProps } from "@pig/chat-renderers";
import { ToolBlock } from "../../mainview/ToolBlock";

/** The approved proposal now renders the production tool, including custom overrides. */
export function GrepPreview({ data }: Pick<ChatRendererProps<"tool">, "data">) {
  return <ToolBlock {...data} />;
}
