import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { ChatScreenPreview, PreviewTheme } from "./Previews";

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
