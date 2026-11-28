import type { Meta } from "@storybook/react-vite";
import { ContentPage } from "../../mainview/ContentPage";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { Button } from "../../mainview/primitives/Button";
import { Select } from "../../mainview/primitives/Select";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ContentPage",
  component: ContentPage,
  parameters: { gallery: true },
} satisfies Meta<typeof ContentPage>;

export const States = {
  name: "ContentPage",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="ContentPage"
      intro="チャットへ戻る操作、見出し、本文の幅をページ間で揃えます。見出し横に操作を置くこともできます。"
      context="一般設定ページ"
      variants={[
        {
          label: "説明付き",
          sample: (
            <ContentPage
              className=""
              title="Provider"
              description="接続済みのアカウントを管理します。"
            >
              <p>接続済みアカウントはありません。</p>
            </ContentPage>
          ),
        },
        {
          label: "見出し横に操作",
          sample: (
            <ContentPage
              className=""
              title="統計"
              actions={<Button>更新</Button>}
            >
              <p>集計結果はありません。</p>
            </ContentPage>
          ),
        },
      ]}
    >
      <ContentPage className="settings-page" title="設定">
        <SettingsCard>
          <SettingsRow label="言語">
            <Select aria-label="言語" defaultValue="ja">
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </Select>
          </SettingsRow>
        </SettingsCard>
      </ContentPage>
    </PrimitiveSpecimen>
  ),
};
