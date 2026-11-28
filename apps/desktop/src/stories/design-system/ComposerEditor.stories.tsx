import type { Meta } from "@storybook/react-vite";
import { useEffect, useId, useState } from "react";
import {
  ComposerEditor,
  forgetEditorView,
} from "../../mainview/ComposerEditor";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/ComposerEditor",
  component: ComposerEditor,
  parameters: { gallery: true },
} satisfies Meta<typeof ComposerEditor>;

function EditorExample({
  initial,
  readOnly,
}: {
  initial: string;
  readOnly?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  useEffect(() => () => forgetEditorView(id), [id]);
  return (
    <ComposerEditor
      viewKey={id}
      value={value}
      readOnly={readOnly}
      aria-label={readOnly ? "読み取り専用の下書き" : "下書き"}
      onChange={(event) => setValue(event.currentTarget.value)}
      onRestore={(edit) => setValue(edit.text)}
    />
  );
}

export const States = {
  name: "ComposerEditor",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="ComposerEditor"
      intro="チャットの入力欄に、行数の自動調整・リストとURLの表示・Undoを加えた本番エディターです。"
      context="作業依頼の下書き"
      variants={[
        {
          label: "入力中",
          sample: <EditorExample initial="この変更を確認して" />,
        },
        {
          label: "読み取り専用",
          sample: <EditorExample initial="送信を準備中です" readOnly />,
        },
      ]}
    >
      <EditorExample
        initial={
          "確認してほしいこと\n-  表示を比較する\n-  https://example.com/docs を確認する"
        }
      />
    </PrimitiveSpecimen>
  ),
};
