import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { CopyButton } from "../../mainview/patterns/CopyButton";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/CopyButton",
  component: CopyButton,
  parameters: { gallery: true },
} satisfies Meta<typeof CopyButton>;

function CopyExample({ fail = false }: { fail?: boolean }) {
  const [error, setError] = useState(false);
  return (
    <div className="ds-specimen-line">
      <code>pnpm lint</code>
      <CopyButton
        label="コマンドをコピー"
        copiedLabel="コピー済み"
        copy={async () => {
          if (fail) throw new Error("コピーできませんでした");
        }}
        onError={() => setError(true)}
      />
      {error && <small role="alert">コピーできませんでした</small>}
    </div>
  );
}

export const States = {
  name: "CopyButton",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      title="CopyButton"
      intro="コピーに成功したときだけ、チェックが120msで拡大します。ボタンの位置と大きさは変わらず、元のアイコンには即時に戻ります。"
      context="コードのコピー（見本内のみで動作）"
      variants={[
        {
          label: "アイコンボタン・成功表示を維持",
          sample: (
            <CopyButton
              variant="icon"
              label="招待コードをコピー"
              copiedLabel="コピー済み"
              copy={async () => {}}
              onError={() => {}}
              persistent
            />
          ),
        },
        {
          label: "コピー不可",
          sample: (
            <CopyButton
              label="コピーする"
              copy={async () => {}}
              onError={() => {}}
              disabled
            />
          ),
        },
        { label: "失敗時", sample: <CopyExample fail /> },
      ]}
    >
      <CopyExample />
    </PrimitiveSpecimen>
  ),
};
