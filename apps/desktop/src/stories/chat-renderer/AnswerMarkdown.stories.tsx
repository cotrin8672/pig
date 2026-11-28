import type { Meta } from "@storybook/react-vite";
import { AnswerMarkdown } from "../../mainview/MessageContent";
import { TooltipLayer } from "../../mainview/Tooltip";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Messages/AnswerMarkdown",
  component: AnswerMarkdown,
  parameters: { gallery: true },
} satisfies Meta<typeof AnswerMarkdown>;

const draw = (text: string, streaming = false) => (
  <StoryTurn>
    <div className="prose">
      <AnswerMarkdown text={text} streaming={streaming} />
    </div>
  </StoryTurn>
);

export const States = {
  name: "AnswerMarkdown",
  render: () => (
    <TooltipLayer>
      <PrimitiveSpecimen
        layer="ChatRenderer"
        title="AnswerMarkdown"
        intro="回答本文の Markdown、コード、表、数式を表示します。"
        context="確定した回答"
        variants={[
          { label: "短い回答", sample: draw("テストはすべて成功しました。") },
          {
            label: "配信中のコードブロック",
            sample: draw("実装例です。\n\n```ts\nconst", true),
          },
        ]}
      >
        {draw(designData.answer)}
      </PrimitiveSpecimen>
    </TooltipLayer>
  ),
};
