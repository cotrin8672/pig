import type { Meta } from "@storybook/react-vite";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { Button } from "../../mainview/primitives/Button";
import { Switch } from "../../mainview/primitives/Switch";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/SettingsRow",
  component: SettingsRow,
  parameters: { gallery: true },
} satisfies Meta<typeof SettingsRow>;

const row = (label: React.ReactNode, control: React.ReactNode) => (
  <SettingsCard>
    <SettingsRow label={label}>{control}</SettingsRow>
  </SettingsCard>
);

export const States = {
  name: "SettingsRow",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      title="SettingsRow"
      intro="左に設定名と説明、右に操作を置きます。狭い幅では操作が下へ回ります。"
      context="チャットレンダラー"
      variants={[
        {
          label: "名前のみ",
          sample: row(
            "画像をブロック",
            <label>
              <Switch aria-label="画像をブロック" />
            </label>,
          ),
        },
        {
          label: "説明付き",
          sample: row(
            <>
              <strong>アップデート</strong>
              <p className="muted">最新版です</p>
            </>,
            <Button>確認</Button>,
          ),
        },
      ]}
    >
      {row(
        <>
          <strong>チャットレンダラー</strong>
          <p className="muted">信頼できるローカルTSXを読み込みます。</p>
          <code>~/.config/pig/chat-renderers.tsx</code>
        </>,
        <Button>再読込</Button>,
      )}
    </PrimitiveSpecimen>
  ),
};
