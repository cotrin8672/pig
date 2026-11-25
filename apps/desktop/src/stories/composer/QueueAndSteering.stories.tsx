import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueuePreview } from "./QueuePreview";

/** Steering and the follow-up queue share one tray on the composer. */
const meta = {
  id: "chat-composer-queueandsteering",
  title: "Design System/Domain/MessageQueue",
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

export const Default: Story = {
  name: "MessageQueue",
  parameters: { gallery: true },
  render: (args) => (
    <>
      {[
        { title: "キューとステアリング", ...args },
        { title: "キューのみ", count: 3, steering: 0, sending: false },
        { title: "ステアリングのみ", count: 0, steering: 1, sending: false },
        { title: "先頭を送信中", count: 3, steering: 1, sending: true },
        { title: "多数の項目", count: 6, steering: 2, sending: false },
      ].map(({ title, ...state }) => (
        <section key={title}>
          <h3>{title}</h3>
          <QueuePreview {...state} />
        </section>
      ))}
    </>
  ),
};
