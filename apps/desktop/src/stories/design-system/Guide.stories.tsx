import type { Meta } from "@storybook/react-vite";
import { decisions, inventory, layers, reviewChecks } from "./catalog";
import { CatalogPage, CatalogSection } from "./ReviewPage";

export default {
  id: "design-system-00-guide",
  title: "Design System/Guide",
  parameters: { gallery: true },
} satisfies Meta;

export const Start = {
  name: "01 · 最初に読む / 安全な進め方",
  render: () => (
    <CatalogPage
      title="UI設計の共通言語をつくる"
      intro="部品の見本だけでなく、使う場面・使わない場面・組み合わせ方をレビューするためのカタログです。"
    >
      <CatalogSection title="今回の範囲">
        <ol className="ds-review-list">
          <li>このDesign System配下で分類・使い分け・組み合わせを確認する。</li>
          <li>
            既存部品は移動・変更せず、そのまま参照する。既存CSSの展示と構成案は区別する。
          </li>
          <li>
            実セッション・ファイル・認証・設定保存へ接続しない。デモの状態はStory内だけに置く。
          </li>
          <li>
            問題がなさそうか確認いただいた後、対象部品ごとに本番移行へ進む。
          </li>
        </ol>
      </CatalogSection>
      <CatalogSection title="このカタログの読み方">
        <dl className="ds-review-table">
          <div>
            <dt>既存部品</dt>
            <dd>
              本番TSXをそのまま使う見本。共通ライブラリへの移行済みという意味ではありません。
            </dd>
          </div>
          <div>
            <dt>既存CSS</dt>
            <dd>
              現在のトークン・HTML要素・CSSクラスの見本。Button等の共通React
              APIはまだ作りません。
            </dd>
          </div>
          <div>
            <dt>構成案</dt>
            <dd>
              Storybook専用の組み合わせ。採用前の案であり、本番に取り込むコードではありません。
            </dd>
          </div>
          <div>
            <dt>既存のStory</dt>
            <dd>
              Chat・Window・Providers等の既存Storyは変更せず残します。比較案を含むため、すべてが本番部品の展示ではありません。
            </dd>
          </div>
        </dl>
      </CatalogSection>
      <CatalogSection title="合意後の移行">
        <ol className="ds-review-list">
          <li>責務・API・必要な状態・移行対象を部品単位で確定する。</li>
          <li>
            現在の見た目・操作・focusを基準に、既存UIと置き換え後を比較する。
          </li>
          <li>小さい範囲を移行し、Lint・型検査・実描画の回帰テストを通す。</li>
          <li>
            確認できた部品から適用先を広げる。一括置換・一括移動はしない。
          </li>
        </ol>
      </CatalogSection>
    </CatalogPage>
  ),
};

export const Classification = {
  name: "02 · 分類と部品台帳",
  render: () => (
    <CatalogPage
      title="役割と知識の範囲で分ける"
      intro="小さいからPrimitives、大きいからDomainとは限りません。小さなEffortChipもモデル固有の意味を持つためDomainです。"
    >
      <CatalogSection title="5つの層">
        <dl className="ds-review-table">
          {layers.map((layer) => (
            <div key={layer.name}>
              <dt>{layer.name}</dt>
              <dd>
                <strong>{layer.purpose}</strong>
                <span>{layer.boundary}</span>
                <code>{layer.components}</code>
              </dd>
            </div>
          ))}
        </dl>
        <p className="ds-review-note">
          Screens → Domain → Patterns → Primitives →
          Foundationsを基本とし、不要な中間部品は挟みません。デザイン比較案はLabsとして本番カタログと区別します。
        </p>
      </CatalogSection>
      {layers.map((layer) => (
        <CatalogSection key={layer.name} title={`${layer.name} / 初期台帳`}>
          <dl className="ds-review-table">
            {inventory
              .filter((entry) => entry.layer === layer.name)
              .map((entry) => (
                <div key={entry.name}>
                  <dt>{entry.name}</dt>
                  <dd>
                    <span className="ds-review-tag">{entry.evidence}</span>
                    <code>{entry.source}</code>
                    <span>{entry.plan}</span>
                  </dd>
                </div>
              ))}
          </dl>
        </CatalogSection>
      ))}
    </CatalogPage>
  ),
};

export const SelectionGuide = {
  name: "03 · 目的から部品を選ぶ",
  render: () => (
    <CatalogPage
      title="こういうときは、この部品"
      intro="形が似ているからではなく、操作・情報・ユーザーの目的が同じなら同じ部品を使います。名前は移行前の候補を含みます。"
    >
      <CatalogSection title="使い分け">
        <dl className="ds-review-table">
          {decisions.map((decision) => (
            <div key={decision.need}>
              <dt>{decision.need}</dt>
              <dd>
                <strong>{decision.use}</strong>
                <span>{decision.avoid}</span>
              </dd>
            </div>
          ))}
        </dl>
      </CatalogSection>
    </CatalogPage>
  ),
};

export const ReviewChecklist = {
  name: "04 · レビューと移行の条件",
  render: () => (
    <CatalogPage
      title="Storybookで合意してから本番へ"
      intro="見本が存在することと、安全に移行できることは別です。状態・操作・組み合わせを確認してから対象を決めます。"
    >
      <CatalogSection title="確認したいこと">
        <ul className="ds-review-list">
          {reviewChecks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection title="部品ページに揃える内容">
        <p>
          用途 / 使わない場面 / 構成 / 状態 / 組み合わせ / アクセシビリティ /
          狭い幅・長文 / 実装元。
        </p>
        <p>
          今回の見本では、まず分類と基本部品・設定・確認操作・送信ボタンを確認できます。実Composer・モデル選択・スマホ実機の検証は未完了です。
        </p>
      </CatalogSection>
    </CatalogPage>
  ),
};
