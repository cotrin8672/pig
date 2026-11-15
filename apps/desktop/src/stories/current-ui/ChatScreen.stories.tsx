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
export const SessionPanel: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ActivityPreview />
    </PreviewTheme>
  ),
};
