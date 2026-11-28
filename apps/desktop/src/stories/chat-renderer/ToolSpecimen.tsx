import type { ChatRendererComponent } from "@pig/chat-renderers";
import { DisclosureScope } from "../../mainview/patterns/LazyDetails";
import { ToolBlock } from "../../mainview/ToolBlock";
import { TooltipLayer } from "../../mainview/Tooltip";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import type { Tool } from "./tool-fixture";

export function ToolSpecimen({
  title,
  intro,
  example,
  variants,
  renderer: Renderer,
}: {
  title: string;
  intro: string;
  example: Tool;
  variants: readonly { label: string; tool: Tool }[];
  renderer?: ChatRendererComponent<"tool">;
}) {
  const draw = (tool: Tool) => (
    <StoryTurn>
      {Renderer ? (
        <DisclosureScope id={`tool:${tool.call.id}`}>
          <Renderer
            data={tool}
            DefaultRenderer={() => <ToolBlock {...tool} />}
          />
        </DisclosureScope>
      ) : (
        <ToolBlock {...tool} />
      )}
    </StoryTurn>
  );
  return (
    <TooltipLayer>
      <PrimitiveSpecimen
        layer="ChatRenderer"
        title={title}
        intro={intro}
        context="会話内のツール実行"
        variants={variants.map(({ label, tool }) => ({
          label,
          sample: draw(tool),
        }))}
      >
        {draw(example)}
      </PrimitiveSpecimen>
    </TooltipLayer>
  );
}
