import type { Meta } from "@storybook/react-vite";
import { Pin } from "lucide-react";
import { useState } from "react";
import { IndicatorDot } from "../../mainview/IndicatorDot";
import { ActionsMenu } from "../../mainview/patterns/ActionsMenu";
import { ChatListRow } from "../../mainview/patterns/ChatListRow";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ChatListRow",
  component: ChatListRow,
  parameters: { gallery: true },
} satisfies Meta<typeof ChatListRow>;

function ListExample() {
  const [selected, setSelected] = useState(0);
  const [pinned, setPinned] = useState(true);
  return (
    <>
      <ChatListRow
        label="一覧のレイアウトを確認"
        active={selected === 0}
        indicator={<IndicatorDot state="completed" label="完了" />}
        trailing={pinned && <Pin size={11} aria-label="ピン留め済み" />}
        onClick={() => setSelected(0)}
        actions={
          <ActionsMenu label="チャットの操作">
            {(close) => (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPinned(!pinned);
                  close();
                }}
              >
                {pinned ? "ピン留めを解除" : "ピン留め"}
              </button>
            )}
          </ActionsMenu>
        }
      />
      <ChatListRow
        label="接続先のチャット"
        active={selected === 1}
        onClick={() => setSelected(1)}
      />
    </>
  );
}

export const States = {
  name: "ChatListRow",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="ChatListRow"
      intro="選択状態・タイトル・状態点と、利用できる場合だけ行メニューを表示します。"
      context="ローカルとリモートが並ぶ一覧"
      variants={[
        {
          label: "状態付き",
          sample: (
            <ChatListRow
              label="テストを実行"
              indicator={<IndicatorDot state="running" label="実行中" />}
            />
          ),
        },
        {
          label: "長い名前・操作なし",
          sample: (
            <div style={{ width: 200, maxWidth: "100%" }}>
              <ChatListRow label="次のレビューまでに確認しておきたい変更の一覧" />
            </div>
          ),
        },
        {
          label: "操作不可",
          sample: <ChatListRow label="チャットを開いています" disabled />,
        },
      ]}
    >
      <ListExample />
    </PrimitiveSpecimen>
  ),
};
