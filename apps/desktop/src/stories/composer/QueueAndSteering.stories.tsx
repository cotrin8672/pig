import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueuePreview } from "./QueuePreview";

/** Steering and the follow-up queue share one tray on the composer. */
const meta = {
  title: "Chat/Composer/QueueAndSteering",
  component: QueuePreview,
  args: { count: 3, steering: 1, sending: false },
  argTypes: {
    count: { control: "inline-radio", options: [0, 1, 3, 6] },
    steering: { control: "inline-radio", options: [0, 1, 2] },
    sending: {
      control: "boolean",
      description: "先頭のメッセージが送信を開始した状態",
    },
  },
} satisfies Meta<typeof QueuePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const QueueOnly: Story = { args: { steering: 0 } };
export const SteeringOnly: Story = { args: { count: 0 } };
export const Sending: Story = { args: { sending: true } };
export const Overflow: Story = { args: { count: 6, steering: 2 } };
