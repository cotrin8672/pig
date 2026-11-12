import { stories } from "../proposals/kit";
import {
  type QueueArgs,
  QueueDefault,
  queueProposals,
} from "../proposals/queue";

export default {
  title: "Chat/Composer/Queue",
  args: { count: 3, sending: false } satisfies QueueArgs,
  argTypes: {
    count: { control: "inline-radio", options: [1, 3, 6] },
    sending: {
      control: "boolean",
      description: "先頭のメッセージが送信を開始した状態",
    },
  },
};
const all = stories(queueProposals, QueueDefault, (args: QueueArgs) => args);
export const Default = all.Default;
export const Compare = all.Compare;
export const NextUp = all.NextUp;
export const Tabs = all.Tabs;
export const Timeline = all.Timeline;
export const Chips = all.Chips;
