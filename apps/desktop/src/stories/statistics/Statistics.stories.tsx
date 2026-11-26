import type { Meta, StoryObj } from "@storybook/react-vite";
import { lazy, useEffect } from "react";
import { useStore } from "../../mainview/store";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "../current-ui/fixtures";
import { PreviewTheme, SidebarPreview } from "../current-ui/Previews";
import { StatisticsPage } from "./StatisticsPreview";
import {
  emptyStatistics,
  type StatisticsFixture,
  statisticsFixture,
} from "./statistics-data";

const Chat = lazy(() =>
  import("../../mainview/App").then((module) => ({ default: module.Chat })),
);

/** Production page and navigation with fixture data and no statistics requests. */
function StatisticsScreen({
  data,
  open: initial,
}: {
  data: StatisticsFixture;
  open: boolean;
}) {
  const open = useStore((state) => state.page === "statistics");
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  useEffect(() => {
    useStore.setState({ page: initial ? "statistics" : "chat" });
  }, [initial]);
  return (
    <SidebarPreview
      main={
        open ? <StatisticsPage data={data} /> : <Chat snapshot={snapshot} />
      }
    />
  );
}

const meta = {
  title: "Proposals/Statistics",
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "設定・Providerと共通幅の本番の統計画面。集計と日別推移、円グラフ、4種類を切り替えられる明細を表示する。Storybookの数値はサンプルで、期間切替は表示のみ。",
      },
    },
  },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
} satisfies Meta<PreviewArgs>;
export default meta;
type Story = StoryObj<PreviewArgs>;

export const Overview: Story = {
  name: "一覧画面",
  render: (args) => (
    <PreviewTheme args={args}>
      <StatisticsScreen data={statisticsFixture} open />
    </PreviewTheme>
  ),
};
export const Compact: Story = {
  name: "共通幅案：グラフと切り替え式の明細",
  render: (args) => (
    <PreviewTheme args={args}>
      <StatisticsScreen data={statisticsFixture} open />
    </PreviewTheme>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "トークン推移の上に集計を置き、右側は円グラフに使う。API換算額は期間合計の表示例で、実際の請求額ではない。明細カードでは4種類の表を直接切り替える。",
      },
    },
  },
};
export const SidebarEntry: Story = {
  name: "サイドバーの入口",
  render: (args) => (
    <PreviewTheme args={args}>
      <StatisticsScreen data={statisticsFixture} open={false} />
    </PreviewTheme>
  ),
};
export const Empty: Story = {
  name: "記録なし",
  render: (args) => (
    <PreviewTheme args={args}>
      <StatisticsScreen data={emptyStatistics} open />
    </PreviewTheme>
  ),
};
