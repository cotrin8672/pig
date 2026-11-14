import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueuePreview } from "./QueuePreview";

const meta = {
  title: "Chat/Composer/Queue",
  component: QueuePreview,
  args: { count: 3, sending: false },
  argTypes: {
    count: { control: "inline-radio", options: [0, 1, 3, 6] },
    sending: {
      control: "boolean",
      description: "先頭のメッセージが送信を開始した状態",
    },
  },
} satisfies Meta<typeof QueuePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sending: Story = { args: { sending: true } };
export const Empty: Story = { args: { count: 0 } };
