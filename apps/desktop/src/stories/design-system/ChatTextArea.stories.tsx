import type { Meta } from "@storybook/react-vite";
import { ChatTextArea } from "../../mainview/ChatTextArea";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/ChatTextArea",
  component: ChatTextArea,
  parameters: { gallery: true },
} satisfies Meta<typeof ChatTextArea>;

export const States = {
  name: "ChatTextArea",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      title="ChatTextArea"
      intro="チャットの複数行入力です。履歴・補完・送信は上位の部品が扱います。"
      context="チャットへのメッセージ"
      variants={[
        {
          label: "入力済み",
          sample: <ChatTextArea aria-label="入力済み" defaultValue="続けて" />,
        },
        {
          label: "入力不可",
          sample: (
            <ChatTextArea aria-label="入力不可" disabled value="送信待ち" />
          ),
        },
      ]}
    >
      <ChatTextArea aria-label="メッセージ" placeholder="メッセージを入力…" />
    </PrimitiveSpecimen>
  ),
};
