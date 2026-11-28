import type { Meta } from "@storybook/react-vite";
import { PendingUserMessage } from "../../mainview/PendingUserMessage";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";

export default {
  title: "ChatRenderer/Messages/PendingUserMessage",
  component: PendingUserMessage,
  parameters: { gallery: true },
} satisfies Meta<typeof PendingUserMessage>;

const example = {
  sessionId: "pending-preview",
  timestamp: Date.UTC(2026, 0, 1, 12),
};

export const States = {
  name: "PendingUserMessage",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="PendingUserMessage"
      intro="送信履歴に確定する前のメッセージです。通常の吹き出しで表示し、まだ編集はできません。"
      context="起動中のチャットへ送ったメッセージ"
      variants={[
        {
          label: "複数行",
          sample: (
            <PendingUserMessage
              {...example}
              content={{
                text: "変更点を整理して。\n次にテストを実行して。",
                images: [],
                pastes: [],
              }}
            />
          ),
        },
      ]}
    >
      <PendingUserMessage
        {...example}
        content={{ text: "このファイルを確認して。", images: [], pastes: [] }}
      />
    </PrimitiveSpecimen>
  ),
};
