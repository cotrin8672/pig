import type { Meta } from "@storybook/react-vite";
import {
  ModelPickerPreview,
  ProvidersNested,
  singleAccounts,
} from "./AccountPreviews";
import { accounts, models } from "./accounts-data";

export default {
  title: "Settings/Provider Accounts",
  parameters: { gallery: true },
} satisfies Meta;

export const Overview = () => (
  <div className="acp-root">
    <section>
      <h2>1. Providers: アカウントはProviderの下にネスト</h2>
      <p>
        接続済みサブスクリプションの「+」で既存のサインインカードがすぐ開き、成功すると「OpenAI
        Codex
        2」のような行が追加されます（キャンセル時は何も増えません）。名前変更は任意で、「…」からプロジェクトと同じ行内編集。状態の丸は左、操作は右。
      </p>
      <ProvidersNested />
    </section>
    <section>
      <h2>2. モデルピッカー: 左のソースにアカウントごと表示</h2>
      <p>
        最近使用・検索では同名モデルが並ぶため、アカウントを小さく併記します。トリガーにも同じ短い名前を出します。
      </p>
      <div className="acp-split">
        <ModelPickerPreview />
        <ModelPickerPreview hasHistory />
      </div>
    </section>
  </div>
);

export const ProvidersList = {
  name: "Providers / accounts",
  render: () => (
    <div className="acp-root">
      <ProvidersNested />
    </div>
  ),
};

export const ProvidersBeforeAdding = {
  name: "Providers / before adding",
  render: () => (
    <div className="acp-root">
      {/* Press "+" on OpenAI Codex to see the Provider row turn into a group. */}
      <ProvidersNested initial={singleAccounts} />
    </div>
  ),
};

export const ProvidersAdding = {
  name: "Providers / after pressing +",
  render: () => (
    <div className="acp-root">
      <ProvidersNested initial={singleAccounts} adding="openai-codex" />
    </div>
  ),
};

export const Picker = {
  name: "Model picker",
  args: { hasHistory: false },
  argTypes: {
    hasHistory: { control: "boolean" as const, name: "履歴のあるチャット" },
  },
  render: (args: { hasHistory: boolean }) => (
    <div className="acp-root">
      <ModelPickerPreview
        key={String(args.hasHistory)}
        hasHistory={args.hasHistory}
      />
    </div>
  ),
};

export const PickerSingleAccount = {
  name: "Model picker / single account",
  render: () => (
    <div className="acp-root">
      <ModelPickerPreview
        initial={{ account: accounts[4], model: models[5] }}
      />
    </div>
  ),
};
