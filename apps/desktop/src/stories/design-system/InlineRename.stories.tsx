import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { InlineRename } from "../../mainview/patterns/InlineRename";
import { Button } from "../../mainview/primitives/Button";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/InlineRename",
  component: InlineRename,
  parameters: { gallery: true },
} satisfies Meta<typeof InlineRename>;

export const States = {
  name: "InlineRename",
  render: function Example() {
    const [title, setTitle] = useState("デザインの見直し");
    const [editing, setEditing] = useState(false);
    return (
      <PrimitiveSpecimen
        layer="Patterns"
        title="InlineRename"
        intro="名前をその場で編集します。Enterかフォーカスを外すと確定し、Escapeで元に戻します。"
        context="チャット名の変更"
        variants={[
          {
            label: "編集中",
            sample: (
              <InlineRename
                value="プロジェクト名"
                label="名前の見本"
                onCommit={() => {}}
                onDone={() => {}}
              />
            ),
          },
        ]}
      >
        <div className="ds-specimen-line">
          {editing ? (
            <InlineRename
              value={title}
              label="チャット名"
              onCommit={setTitle}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              <span>{title}</span>
              <Button onClick={() => setEditing(true)}>名前を変更</Button>
            </>
          )}
        </div>
      </PrimitiveSpecimen>
    );
  },
};
