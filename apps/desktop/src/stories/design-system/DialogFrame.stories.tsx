import type { Meta } from "@storybook/react-vite";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { DialogFrame } from "../../mainview/patterns/DialogFrame";
import { Button } from "../../mainview/primitives/Button";
import { TextField } from "../../mainview/primitives/TextField";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/DialogFrame",
  component: DialogFrame,
  parameters: { gallery: true },
} satisfies Meta<typeof DialogFrame>;

function FrameExample() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState(false);
  function show(input: boolean) {
    setInput(input);
    dialog.current?.show();
  }
  const close = () => dialog.current?.close();
  return (
    <PrimitiveSpecimen
      layer="Patterns"
      title="DialogFrame"
      intro="非モーダルダイアログの枠です。見出し・本文・操作列を同じ形で配置します。"
      context="設定内容の確認"
      variants={[
        {
          label: "確認",
          sample: <Button onClick={() => show(false)}>確認を開く</Button>,
        },
        {
          label: "入力",
          sample: <Button onClick={() => show(true)}>入力を開く</Button>,
        },
      ]}
    >
      <Button onClick={() => show(false)}>ダイアログを開く</Button>
      <DialogFrame
        ref={dialog}
        title={input ? "表示名を入力" : "設定内容の確認"}
        onDismiss={close}
        closeAction={
          <button type="button" aria-label="閉じる" onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        }
        footer={
          <Button variant="primary" onClick={close}>
            完了
          </Button>
        }
      >
        {input ? (
          <TextField aria-label="表示名" placeholder="表示名" />
        ) : (
          <p>この設定を使って続行します。</p>
        )}
      </DialogFrame>
    </PrimitiveSpecimen>
  );
}

export const States = { name: "DialogFrame", render: () => <FrameExample /> };
