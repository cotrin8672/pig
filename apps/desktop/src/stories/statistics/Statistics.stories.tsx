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
          "設定・Provider画面と共通のContentPageを使う本番のStatisticsViewをサンプルデータで表示。本文は利用可能な幅・高さに追従し、日別グラフの下にシェルコマンド別の成否を置く。期間タブは見出しと同じ行、円グラフは同じ直径・位置に揃える。Storybookの期間切替は表示のみ。",
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
