import type { Meta } from "@storybook/react-vite";
import { ThinkingBlock } from "../../mainview/ToolBlock";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Activity/ThinkingBlock",
  component: ThinkingBlock,
  parameters: { gallery: true },
} satisfies Meta<typeof ThinkingBlock>;

export const States = {
  name: "ThinkingBlock",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="ThinkingBlock"
      intro="モデルが考えている間の状態と、確定した思考の内容を表示します。"
      context="モデルの思考が確定した応答"
      variants={[
        {
          label: "思考中",
          sample: (
            <StoryTurn>
              <ThinkingBlock active label="思考" text="" />
            </StoryTurn>
          ),
        },
        {
          label: "思考本文なし",
          sample: (
            <StoryTurn>
              <ThinkingBlock active={false} label="思考" text="" />
            </StoryTurn>
          ),
        },
      ]}
    >
      <StoryTurn>
        <ThinkingBlock
          active={false}
          label="思考"
          text={designData.reasoning}
        />
      </StoryTurn>
    </PrimitiveSpecimen>
  ),
};
