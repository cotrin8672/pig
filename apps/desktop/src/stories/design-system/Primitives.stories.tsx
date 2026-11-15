import type { Meta } from "@storybook/react-vite";
import { LoaderCircle, Plus } from "lucide-react";
import { useId, useState } from "react";
import { CatalogPage, Example } from "./ReviewPage";

export default {
  id: "design-system-02-primitives",
  title: "Design System/Primitives",
  parameters: { gallery: true },
} satisfies Meta;

function ActionExamples() {
  const [count, setCount] = useState(0);
  return (
    <CatalogPage
      title="操作の基本部品"
      intro="既存のHTML要素とCSSを展示しています。Button・IconButtonという共通Reactコンポーネントは未作成で、APIを確定する前の見本です。"
    >
      <div className="ds-review-grid">
        <Example
          title="Button / 強調度と状態"
          evidence="既存CSS"
          source="styles.css / button・.primary・.secondary"
          use="ユーザーの操作で処理を実行する。主操作と補助操作の強調を分ける。"
          avoid="画面移動への流用、色名や画面名ベースのvariant、クリック可能なdiv。"
        >
          <div className="ds-review-inline">
            <button
              type="button"
              className="primary"
              onClick={() => setCount(count + 1)}
            >
              主操作
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setCount(0)}
            >
              リセット
            </button>
            <button type="button" disabled>
              操作不可
            </button>
            <button type="button" className="primary" aria-busy="true" disabled>
              <LoaderCircle size={14} className="spinner" aria-hidden="true" />
              処理中
            </button>
          </div>
          <output aria-live="polite">サンプル内の操作回数: {count}</output>
        </Example>
        <Example
          title="IconButton / 名前を必須にする"
          evidence="既存CSS"
          source="button＋Storybook内の対称な32px操作領域"
          use="意味が伝わるアイコンで、省スペースの操作を提供する。"
          avoid="名前のないアイコン、非対称padding、説明しないと分からない主操作。"
        >
          <div className="ds-review-inline">
            <button
              type="button"
              className="ds-review-icon-button"
              aria-label="サンプルを追加"
              onClick={() => setCount(count + 1)}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <span>ラベル付きButtonと同じサンプル状態を操作します。</span>
          </div>
          <p className="ds-review-note">
            IconButtonの寸法・variantもレビュー対象です。アプリのボタンは置き換えません。
          </p>
        </Example>
      </div>
    </CatalogPage>
  );
}

function InputExamples() {
  const id = useId();
  const [name, setName] = useState("サンプルプロジェクト");
  const [language, setLanguage] = useState("ja");
  const [enabled, setEnabled] = useState(true);
  return (
    <CatalogPage
      title="入力と選択の基本部品"
      intro="入力はこのStoryのローカル状態だけを変更します。アプリの設定・プロジェクト・認証情報には接続しません。"
    >
      <div className="ds-review-grid">
        <Example
          title="TextField / Fieldの構成"
          evidence="構成案"
          source="ネイティブinput＋既存CSS / ラベル構成はレビュー案"
          use="短いテキストを入力する。ラベル・説明・入力を明示的に関連付ける。"
          avoid="placeholderだけでラベルを代用する。短い入力に長文エディタを持ち込む。"
        >
          <div className="ds-review-field">
            <label htmlFor={`${id}-name`}>表示名</label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={`${id}-description`}
            />
            <span id={`${id}-description`} className="ds-review-note">
              この見本の中だけで保持する名前です。
            </span>
          </div>
          <div className="ds-review-field">
            <label htmlFor={`${id}-disabled`}>変更できない値</label>
            <input id={`${id}-disabled`} defaultValue="操作不可の例" disabled />
          </div>
        </Example>
        <Example
          title="Select / Checkbox"
          evidence="既存CSS"
          source="ネイティブselect・checkbox＋既存CSS"
          use="Selectは候補から1つ選ぶ。Checkboxは選択・同意などの真偽値を扱う。"
          avoid="操作一覧をSelectにする。Switch・Radio・検索付き選択との違いを曖昧にする。"
        >
          <div className="ds-review-field">
            <label htmlFor={`${id}-language`}>言語のサンプル</label>
            <select
              id={`${id}-language`}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
          <label className="ds-review-inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            サンプルの項目を選択
          </label>
          <p className="ds-review-note">
            Switch・RadioGroupの新しい見た目は、この段階では追加しません。
          </p>
        </Example>
      </div>
    </CatalogPage>
  );
}

export const Actions = {
  name: "01 · Button / IconButton",
  render: () => <ActionExamples />,
};
export const Inputs = {
  name: "02 · 入力・選択とラベル",
  render: () => <InputExamples />,
};
