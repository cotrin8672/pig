import type { Meta } from "@storybook/react-vite";
import { ProviderUsageView } from "../../mainview/ProviderUsageView";
import type { UsageDisplay } from "../../shared/provider-usage";
import { usageFixtures, usageFixtureTime } from "../providers/usage-fixtures";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/ProviderUsageView",
  component: ProviderUsageView,
  parameters: { gallery: true },
} satisfies Meta<typeof ProviderUsageView>;

function usage(keys: string[], display: UsageDisplay = "remaining") {
  return (
    <div style={{ width: 240, maxWidth: "100%" }}>
      <ProviderUsageView
        entries={usageFixtures.filter((entry) => keys.includes(entry.key))}
        display={display}
        now={usageFixtureTime}
        onRefresh={() => {}}
      />
    </div>
  );
}

const accounts = ["codex-personal", "codex-work", "anthropic"];

export const States = {
  name: "ProviderUsageView",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="ProviderUsageView"
      intro="アカウントの容量とリセットまでの時間を表示します。行にホバーするかキーボードでフォーカスすると詳しい値が開きます。"
      context="サイドバーのProvider使用量"
      variants={[
        { label: "使用済み表示", sample: usage(accounts, "used") },
        { label: "時間不明", sample: usage(["anthropic"]) },
        { label: "残高のみ", sample: usage(["router"]) },
        { label: "読み込み中と取得失敗", sample: usage(["vercel", "qwen"]) },
      ]}
    >
      {usage(accounts)}
    </PrimitiveSpecimen>
  ),
};
