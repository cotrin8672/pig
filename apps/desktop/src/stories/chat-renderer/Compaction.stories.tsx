import type { Meta } from "@storybook/react-vite";
import { Compaction } from "../../mainview/CompactionRenderer";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";

export default {
  title: "ChatRenderer/Activity/Compaction",
  component: Compaction,
  parameters: { gallery: true },
} satisfies Meta<typeof Compaction>;

export const States = {
  name: "Compaction",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="Compaction"
      intro="コンテキストの圧縮と、保存された要約を会話の中に表示します。"
      context="要約があるコンテキスト圧縮"
      variants={[
        {
          label: "圧縮中",
          sample: (
            <StoryTurn>
              <Compaction active reason="manual" />
            </StoryTurn>
          ),
        },
        {
          label: "圧縮前の情報なし",
          sample: (
            <StoryTurn>
              <Compaction active={false} />
            </StoryTurn>
          ),
        },
      ]}
    >
      <StoryTurn>
        <Compaction
          active={false}
          tokensBefore={82_400}
          summary="フォールバック言語の追加と関連テストが完了しました。"
        />
      </StoryTurn>
    </PrimitiveSpecimen>
  ),
};
