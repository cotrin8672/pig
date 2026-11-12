import type { Meta } from "@storybook/react-vite";
import { accounts, models } from "./accounts-data";
import {
  type AddStep,
  AddAccountDialog,
  ModelPickerPreview,
  ProvidersFlat,
  ProvidersNested,
} from "./AccountPreviews";

export default {
  title: "Settings/Provider Accounts",
  parameters: { gallery: true },
} satisfies Meta;

/** The recommended set: flat Provider rows, name-first sign-in, picker per account. */
export const Overview = () => (
  <div className="acp-root">
    <section>
      <h2>1. Providers: アカウントを並列のProviderとして表示（推奨）</h2>
      <p>ピッカーと同じ名前・順序で並べ、「Codex Work」がどこでも同じものに見えるようにします。追加・管理は詳細側に集約します。</p>
      <ProvidersFlat />
    </section>
    <section>
      <h2>2. アカウントの追加: 名前を付けてからサインイン</h2>
      <p>ブラウザが別アカウントのまま承認される事故を防ぐため、どのアカウントを追加するつもりかを先に決めます。</p>
      <div className="acp-split">
        <AddAccountDialog />
        <AddAccountDialog step="signing-in" />
      </div>
    </section>
    <section>
      <h2>3. モデルピッカー: 左のソースにアカウントごと表示</h2>
      <p>最近使用・検索では同名モデルが並ぶため、アカウントを小さく併記します。トリガーにも同じ短い名前を出します。</p>
      <div className="acp-split">
        <ModelPickerPreview />
        <ModelPickerPreview hasHistory />
      </div>
    </section>
  </div>
);

export const ProvidersFlatList = {
  name: "Providers / A: Flat (recommended)",
  render: () => <div className="acp-root"><ProvidersFlat /></div>,
};
export const ProvidersNestedList = {
  name: "Providers / B: Nested",
  render: () => <div className="acp-root"><ProvidersNested /></div>,
};

export const AddAccount = {
  name: "Add account",
  args: { step: "name" as AddStep, provider: "openai-codex" },
  argTypes: {
    step: { control: "inline-radio" as const, options: ["name", "signing-in", "error"] },
    provider: { control: "inline-radio" as const, options: ["openai-codex", "anthropic"] },
  },
  render: (args: { step: AddStep; provider: string }) => (
    <div className="acp-root">
      <AddAccountDialog key={`${args.provider}/${args.step}`} {...args} />
    </div>
  ),
};

export const Picker = {
  name: "Model picker",
  args: { hasHistory: false },
  argTypes: { hasHistory: { control: "boolean" as const, name: "履歴のあるチャット" } },
  render: (args: { hasHistory: boolean }) => (
    <div className="acp-root">
      <ModelPickerPreview key={String(args.hasHistory)} hasHistory={args.hasHistory} />
    </div>
  ),
};

export const PickerSingleAccount = {
  name: "Model picker / single account",
  render: () => (
    <div className="acp-root">
      {/* With one account per Provider the trigger and list stay exactly as today. */}
      <ModelPickerPreview initial={{ account: accounts[4]!, model: models[5]! }} />
    </div>
  ),
};
