import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ChatTextArea } from "../../mainview/ChatTextArea";
import { ComposerForm } from "../../mainview/patterns/ComposerForm";
import { Button } from "../../mainview/primitives/Button";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ComposerForm",
  component: ComposerForm,
  parameters: { gallery: true },
} satisfies Meta<typeof ComposerForm>;

function FormExample({ initial = "" }: { initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return (
    <ComposerForm
      onSubmit={(event) => {
        event.preventDefault();
        setDraft("");
      }}
      submit={
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          送信
        </Button>
      }
    >
      <ChatTextArea
        aria-label="メッセージ"
        placeholder="メッセージを入力…"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </ComposerForm>
  );
}

export const States = {
  name: "ComposerForm",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="ComposerForm"
      intro="同じ枠に入力欄と操作列を配置します。見本では送信を押しても入力欄を空にするだけです。"
      context="チャットの入力フォーム"
      variants={[
        { label: "未入力", sample: <FormExample /> },
        { label: "入力済み", sample: <FormExample initial="差分を確認して" /> },
      ]}
    >
      <FormExample initial="変更点を教えて。" />
    </PrimitiveSpecimen>
  ),
};
