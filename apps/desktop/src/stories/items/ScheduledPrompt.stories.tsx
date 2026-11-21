import {
  ScheduledBubble,
  ScheduledSeparateSession,
} from "../proposals/agent-content";

/** pi-schedule-prompt が送ったプロンプト。予約名を載せた色付きの吹き出し（本番）。 */
export default { title: "Chat/Extensions/ScheduledPrompt" };
export const Default = { render: ScheduledBubble };
export const SeparateSession = {
  name: "別セッション実行（model指定）",
  render: ScheduledSeparateSession,
};
