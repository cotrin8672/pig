import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChartColumn } from "lucide-react";
import { lazy, useState } from "react";
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

/** Proposal only: the production App has no statistics page or RPC yet. */
function StatisticsScreen({
  data,
  open: initial,
}: {
  data: StatisticsFixture;
  open: boolean;
}) {
  const [open, setOpen] = useState(initial);
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  return (
    <SidebarPreview
      extraIcon={
        <button
          type="button"
          className={`sidebar-icon ${open ? "active" : ""}`}
          aria-label="統計"
          title="統計"
          aria-pressed={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChartColumn size={16} aria-hidden="true" />
        </button>
      }
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
          "本番のStatisticsViewをサンプルデータで表示。日別モデルグラフ・モデル内訳とtoken/s・ツール使用率と成功率・平均の種類内訳・初期コンテキストを一画面に並べる。Storybookの期間切替は表示のみ。本番画面ではローカルSQLiteの集計RPCへ接続する。",
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
