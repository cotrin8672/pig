import type { Meta } from "@storybook/react-vite";
import { Pencil, Pin, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionsMenu } from "../../mainview/patterns/ActionsMenu";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";
import "./actions-menu-story.css";

export default {
  title: "Design System/Patterns/ActionsMenu",
  component: ActionsMenu,
  parameters: { gallery: true },
} satisfies Meta<typeof ActionsMenu>;

export const States = {
  name: "ActionsMenu",
  render: function Example() {
    const [last, setLast] = useState("—");
    return (
      <PrimitiveSpecimen
        layer="Patterns"
        title="ActionsMenu"
        intro="行に対する補助的な操作を「…」にまとめます。行にホバーかフォーカスしたときだけ表示します。"
        context="チャット一覧"
        variants={[
          {
            label: "操作不可",
            sample: (
              <div className="ds-menu-row">
                <ActionsMenu label="操作不可" disabled>
                  {() => null}
                </ActionsMenu>
              </div>
            ),
          },
        ]}
      >
        <div className="ds-menu-row">
          <span>デザインの見直し</span>
          <ActionsMenu label="チャットの操作: デザインの見直し">
            {(close) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLast("名前を変更");
                    close();
                  }}
                >
                  <Pencil size={13} /> 名前を変更
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLast("ピン留め");
                    close();
                  }}
                >
                  <Pin size={13} /> ピン留め
                </button>
                <ConfirmButton
                  role="menuitem"
                  className="session-menu-delete"
                  onConfirm={() => {
                    setLast("削除");
                    close();
                  }}
                >
                  <Trash2 size={13} /> 削除
                </ConfirmButton>
              </>
            )}
          </ActionsMenu>
        </div>
        <output className="ds-menu-output">最後の操作：{last}</output>
      </PrimitiveSpecimen>
    );
  },
};
