import type { Meta } from "@storybook/react-vite";
import { RunningIndicator } from "../../mainview/RunningIndicator";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";

export default {
  title: "ChatRenderer/Activity/RunningIndicator",
  component: RunningIndicator,
  parameters: { gallery: true },
} satisfies Meta<typeof RunningIndicator>;

export const States = {
  name: "RunningIndicator",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="RunningIndicator"
      intro="応答待ちに処理中であることを示します。拡張から文言と記号を指定できます。"
      context="応答がまだ完了していない会話"
      variants={[
        {
          label: "拡張が指定した文言",
          sample: (
            <StoryTurn>
              <RunningIndicator message="変更を検証中…" />
            </StoryTurn>
          ),
        },
        {
          label: "拡張が指定した文言と記号",
          sample: (
            <StoryTurn>
              <RunningIndicator message="テストを実行中…" symbol="◈" />
            </StoryTurn>
          ),
        },
      ]}
    >
      <StoryTurn>
        <RunningIndicator />
      </StoryTurn>
    </PrimitiveSpecimen>
  ),
};
