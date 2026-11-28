import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { Sheet } from "../../mainview/patterns/Sheet";
import { Button } from "../../mainview/primitives/Button";
import { TextField } from "../../mainview/primitives/TextField";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/Sheet",
  component: Sheet,
  parameters: { gallery: true },
} satisfies Meta<typeof Sheet>;

function SheetExample() {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const show = (wide: boolean) => {
    setWide(wide);
    setOpen(true);
  };
  const close = () => setOpen(false);
  return (
    <PrimitiveSpecimen
      layer="Patterns"
      title="Sheet"
      intro="設定画面の短い入力や接続操作を重ねて表示します。Escapeや閉じる操作で元のボタンに戻ります。"
      context="招待コードの入力"
      variants={[
        {
          label: "通常幅",
          sample: <Button onClick={() => show(false)}>通常幅で開く</Button>,
        },
        {
          label: "ワイド",
          sample: <Button onClick={() => show(true)}>広い幅で開く</Button>,
        },
      ]}
    >
      <Button onClick={() => show(false)}>接続ダイアログを開く</Button>
      <Sheet
        open={open}
        wide={wide}
        title="PCに接続"
        onClose={close}
        footer={
          <Button variant="primary" onClick={close}>
            完了
          </Button>
        }
      >
        <TextField aria-label="招待コード" placeholder="招待コード" />
      </Sheet>
    </PrimitiveSpecimen>
  );
}

export const States = { name: "Sheet", render: () => <SheetExample /> };
