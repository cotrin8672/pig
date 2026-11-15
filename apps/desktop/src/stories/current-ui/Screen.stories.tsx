import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { DesktopPreview, PreviewTheme } from "./Previews";

const meta = {
  id: "current-ui-screen",
  title: "Design System/Screens/App",
  component: DesktopPreview,
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "本番のAppをそのまま表示します。画面全体を最上位とし、ここから共通化するまとまりを検討します。実ホストには接続せず、送信・実行・保存は行いません。テーマカラーは本番と同じMaterial palette生成へ渡します。",
      },
    },
  },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <DesktopPreview />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = { name: "01 · 会話画面" };
export const Running: Story = {
  name: "02 · 実行中と活動パネル",
  args: { scene: "running" },
};
export const Approval: Story = {
  name: "03 · 入力・確認待ち",
  args: { scene: "approval" },
};
export const Empty: Story = {
  name: "04 · 空のチャット",
  args: { scene: "empty" },
};
export const Settings: Story = {
  name: "05 · 設定画面",
  args: { scene: "settings" },
};
export const Split: Story = { name: "06 · 分割画面", args: { scene: "split" } };
