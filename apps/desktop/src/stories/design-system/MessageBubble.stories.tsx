import type { Meta } from "@storybook/react-vite";
import { Bot } from "lucide-react";
import { ChatTextArea } from "../../mainview/ChatTextArea";
import { MessageBubble } from "../../mainview/patterns/MessageBubble";
import { SenderHead } from "../../mainview/SenderBubble";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/MessageBubble",
  component: MessageBubble,
  parameters: { gallery: true },
} satisfies Meta<typeof MessageBubble>;

export const States = {
  name: "MessageBubble",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="MessageBubble"
      intro="送ったメッセージの本文を表示します。拡張や予約から届いたメッセージでは送り主を添えられます。"
      context="チャットに送信したメッセージ"
      variants={[
        {
          label: "複数行",
          sample: (
            <MessageBubble>{"差分を確認して。\n結果も教えて。"}</MessageBubble>
          ),
        },
        {
          label: "送り主付き",
          sample: (
            <MessageBubble
              sender={
                <SenderHead
                  icon={<Bot size={12} aria-hidden="true" />}
                  name="レビュー担当"
                />
              }
            >
              確認が完了しました。
            </MessageBubble>
          ),
        },
        {
          label: "編集",
          sample: (
            <MessageBubble onSubmit={(event) => event.preventDefault()}>
              <ChatTextArea
                aria-label="メッセージを編集"
                defaultValue="変更点を確認して"
              />
            </MessageBubble>
          ),
        },
      ]}
    >
      <MessageBubble>この変更を確認してください。</MessageBubble>
    </PrimitiveSpecimen>
  ),
};
