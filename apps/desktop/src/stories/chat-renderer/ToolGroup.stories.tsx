import type { Meta } from "@storybook/react-vite";
import { ToolGroup } from "../../mainview/ToolBlock";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { exploreSteps, grep } from "./tool-data";
import { atPhase, type Tool } from "./tool-fixture";

export default {
  title: "ChatRenderer/Tools/ToolGroup",
  component: ToolGroup,
  parameters: { gallery: true },
} satisfies Meta<typeof ToolGroup>;

const draw = (steps: Tool[], live = false) => (
  <StoryTurn>
    <ToolGroup
      calls={steps.map(({ call }) => ({ ...call, type: "toolCall" }))}
      tools={Object.fromEntries(
        steps.flatMap(({ call, state }) => (state ? [[call.id, state]] : [])),
      )}
      live={live}
    />
  </StoryTurn>
);

export const States = {
  name: "ToolGroup",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="ToolGroup"
      intro="連続した探索ツールをまとめ、展開すると実行ごとの結果を確認できます。"
      context="ファイルの一覧・検索・読み取り"
      variants={[
        {
          label: "探索中",
          sample: draw([exploreSteps[0], atPhase(grep, "running")], true),
        },
        {
          label: "一部失敗",
          sample: draw([exploreSteps[0], atPhase(grep, "error")]),
        },
      ]}
    >
      {draw(exploreSteps)}
    </PrimitiveSpecimen>
  ),
};
