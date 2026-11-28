import type { Meta } from "@storybook/react-vite";
import { InboundMessage } from "../../mainview/SenderBubble";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import {
  customMessage,
  reviewCompletion,
  subagentCompletion,
} from "./codex-agent-data";

export default {
  title: "ChatRenderer/Extensions/InboundMessage",
  component: InboundMessage,
  parameters: { gallery: true },
} satisfies Meta<typeof InboundMessage>;

const failed = subagentCompletion(
  "completion-docs",
  "scout/docs",
  "failed",
  "Model request failed: rate limited",
);
const long = subagentCompletion(
  "completion-long",
  "review",
  "completed",
  Array.from({ length: 30 }, (_, i) => `${i + 1}. 指摘の詳細。`).join("\n"),
);
const other = customMessage(
  "supervisor",
  "subagent_supervisor_request",
  "Subagent needs a supervisor decision.\nAgent: reviewer",
);

export const States = {
  name: "InboundMessage",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="InboundMessage"
      intro="拡張から届いたメッセージを、送り主が分かる吹き出しで表示します。"
      context="サブエージェントの完了報告"
      variants={[
        {
          label: "サブエージェントの失敗",
          sample: <InboundMessage record={failed} />,
        },
        { label: "展開できる長文", sample: <InboundMessage record={long} /> },
        {
          label: "その他の拡張メッセージ",
          sample: <InboundMessage record={other} />,
        },
      ]}
    >
      <InboundMessage record={reviewCompletion} />
    </PrimitiveSpecimen>
  ),
};
