import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { ActivityPreview, ChatScreenPreview, PreviewTheme } from "./Previews";

const meta = {
  id: "domain-chat-screen",
  title: "Design System/Domain/ChatScreen",
  parameters: { appPreview: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <ChatScreenPreview />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Running: Story = { args: { scene: "running" } };
/** 応答の後に届いたサブエージェントの結果が、第三者の吹き出しとして次の応答を始める。 */
export const SubagentResult: Story = { args: { scene: "subagent" } };
export const SessionPanel: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ActivityPreview />
    </PreviewTheme>
  ),
};
export const SupportedExtensions: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ActivityPreview supported />
    </PreviewTheme>
  ),
};
/** Composer左下の「実行」Chipを開いた状態（サブエージェント）。 */
export const SubagentsOpen: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ActivityPreview supported initialTab="tasks" />
    </PreviewTheme>
  ),
};
/** Composer左下の「予約」Chipを開いた状態（pi-schedule-prompt）。 */
export const ScheduledPromptsOpen: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ActivityPreview supported initialTab="schedule" />
    </PreviewTheme>
  ),
};
