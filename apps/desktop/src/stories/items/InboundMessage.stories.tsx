import { BuiltinCustomRecord } from "../../mainview/CustomRecord";
import type { TranscriptRecord } from "../../shared/transcript";
import {
  customMessage,
  reviewCompletion,
  subagentCompletion,
} from "../proposals/codex-agent-data";

/** 拡張がエージェントへ送ったメッセージ。送り主を載せた第三者の吹き出し（本番）。 */
const none = () => null;
const draw = (raw: TranscriptRecord) => () => (
  <BuiltinCustomRecord
    DefaultRenderer={none}
    data={{ id: raw.id, customType: "", content: null, raw }}
  />
);
export default { title: "Chat/Extensions/InboundMessage" };
export const SubagentCompleted = {
  name: "サブエージェントの完了（pi-codex-subagents）",
  render: draw(reviewCompletion),
};
export const SubagentFailed = {
  name: "サブエージェントの失敗",
  render: draw(
    subagentCompletion(
      "completion-docs",
      "scout/docs",
      "failed",
      "Model request failed: rate limited",
    ),
  ),
};
export const LongMessage = {
  name: "長文（12行で折りたたみ、展開ボタン）",
  render: draw(
    subagentCompletion(
      "completion-long",
      "review",
      "completed",
      Array.from(
        { length: 30 },
        (_, i) => `${i + 1}. 指摘の詳細。該当箇所と再現手順を含む。`,
      ).join("\n"),
    ),
  ),
};
export const ExtensionMessage = {
  name: "その他の拡張メッセージ",
  render: draw(
    customMessage(
      "supervisor",
      "subagent_supervisor_request",
      "Subagent needs a supervisor decision.\nAgent: reviewer\n\n旧 Playwright 設定を確認できれば起動主体をさらに絞れます。",
    ),
  ),
};
