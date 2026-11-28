import type { Meta } from "@storybook/react-vite";
import { ResponseFooter } from "../../mainview/ResponseFooter";
import { TooltipLayer } from "../../mainview/Tooltip";
import type { ResponseStats } from "../../shared/transcript";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Activity/ResponseFooter",
  component: ResponseFooter,
  parameters: { gallery: true },
} satisfies Meta<typeof ResponseFooter>;

const files = [
  { path: "chat/Composer.tsx", added: 24, removed: 5 },
  { path: "chat/queue.ts", added: 12, removed: 4 },
  { path: "docs/queue.md", added: 6, removed: 0 },
];
const samples = [
  { label: "3ファイル", files },
  {
    label: "6ファイル（先頭4件＋残り）",
    files: [
      ...files,
      {
        path: "chat/extensions/composer/keyboard-shortcuts/CommandSuggestionPanel.tsx",
        added: 5,
        removed: 2,
      },
      { path: "chat/queue.test.ts", added: 3, removed: 0 },
      { path: "chat/legacy-queue.ts", added: 0, removed: 2 },
    ],
  },
  { label: "変更なし・料金不明", files: undefined },
];

const stats = {
  ...designData.stats,
  totalTokens: 18_420,
  input: 1_240,
  output: 2_930,
  cacheRead: 13_800,
  cacheWrite: 450,
  cost: 0.1187,
};
const draw = (stats: ResponseStats) => (
  <StoryTurn>
    <ResponseFooter sessionId="preview" canRegenerate={false} stats={stats} />
  </StoryTurn>
);

export const States = {
  name: "ResponseFooter",
  render: () => (
    <TooltipLayer>
      <PrimitiveSpecimen
        layer="ChatRenderer"
        title="ResponseFooter"
        intro="応答の結果、モデル、トークン使用量と変更ファイルを表示します。チップで内訳を確認できます。"
        context="完了した応答"
        variants={samples.map(({ label, files }) => ({
          label,
          sample: draw({ ...stats, files, cost: files ? stats.cost : 0 }),
        }))}
      >
        {draw(stats)}
      </PrimitiveSpecimen>
    </TooltipLayer>
  ),
};
