import type { Meta } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { CatalogPage, CatalogSection, Example } from "./ReviewPage";

export default {
  id: "design-system-01-foundations",
  title: "Design System/Foundations/Tokens",
  parameters: { gallery: true },
} satisfies Meta;

const colors = [
  ["主要な文字", "--ds-text-primary"],
  ["補足の文字", "--ds-text-muted"],
  ["操作・選択", "--ds-accent"],
  ["focus", "--ds-focus"],
  ["成功", "--ds-success"],
  ["警告・入力待ち", "--ds-warning"],
  ["失敗", "--ds-error"],
  ["未読・注意を向ける印", "--ds-highlight"],
] as const;

export const ColorAndTypography = {
  name: "01 · 意味のある色と文字",
  render: () => (
    <CatalogPage
      title="既存トークンを共通言語にする"
      intro="tokens.cssの初期配色をそのまま参照します。動的テーマの計算やアプリの設定は変更しません。"
    >
      <CatalogSection title="色は場所ではなく意味で選ぶ">
        <div className="ds-review-grid">
          {colors.map(([label, token]) => (
            <div className="ds-review-inline" key={token}>
              <span
                className="ds-review-swatch"
                aria-hidden="true"
                style={{ "--sample-color": `var(${token})` } as CSSProperties}
              />
              <div className="ds-review-token">
                <strong>{label}</strong>
                <code>{token}</code>
              </div>
            </div>
          ))}
        </div>
        <p className="ds-review-note">
          highlightは小さな注意の印に限り、通常の操作・大きい面・成功／失敗の意味には使いません。
        </p>
      </CatalogSection>
      <CatalogSection title="文字の役割">
        <div className="ds-review-grid">
          <Example
            title="見出しと本文"
            evidence="既存CSS"
            source="mainview/tokens.css"
            use="情報の階層を示す。サイズだけでなく意味のある見出し要素を使う。"
            avoid="画面ごとに別の文字サイズ・font-weightを増やす。"
          >
            <div className="ds-review-type-title">画面の見出し</div>
            <p>本文は共通のサイズ・行高で読みやすさを保ちます。</p>
            <span className="ds-review-type-label">
              ラベル・補足には既存の小さい文字トークン。
            </span>
          </Example>
          <Example
            title="寸法と操作"
            evidence="構成案"
            source="既存トークン・UIガイドを整理する段階"
            use="余白、focus、状態変化、操作対象の大きさを共通の基準として確認する。"
            avoid="スマホ対応を部品ごとの独自paddingや色で補修する。"
          >
            <ul className="ds-review-list">
              <li>角丸・文字・Motionは既存トークンを使う。</li>
              <li>狭い幅と文字拡大で折り返し・省略を確認する。</li>
              <li>hoverだけでなくfocusやタップでも操作できる。</li>
              <li>新しい密度・寸法の体系は、このレビュー後に決める。</li>
            </ul>
          </Example>
        </div>
      </CatalogSection>
    </CatalogPage>
  ),
};

export const SurfacesAndOutput = {
  name: "02 · 面・Card・出力枠",
  render: () => (
    <CatalogPage
      title="面の役割と出力枠を揃える"
      intro="このページのCardも既存の半透明トークンを使います。新しいSurfaceやOutputFrameの本番APIは、まだ作っていません。"
    >
      <div className="ds-review-grid">
        <Example
          title="通常のCard"
          evidence="既存CSS"
          source="--ds-tile / --ds-elevation-stroke"
          use="関連する設定・一覧・情報をまとめる薄い背景レイヤー。"
          avoid="全体opacity、不透明な板、無目的なCardの入れ子。PaneはCard化せずDividerで区切る。"
        >
          <p>文字とアイコンは薄くせず、背景色のalphaで透過させます。</p>
          <code>background: var(--ds-tile)</code>
        </Example>
        <Example
          title="OutputFrame候補"
          evidence="構成案"
          source="Storybook専用見本 / 既存の出力ルール"
          use="会話内のツール出力を約8行で見せ、超過分は同じ枠内でスクロールする。"
          avoid="データの切り捨て、枠ごとの左右端のずれ、一般Markdown・対話型Terminalへの一律適用。"
        >
          <section
            className="ds-review-output"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The output region must be keyboard-scrollable.
            tabIndex={0}
            aria-label="出力枠のサンプル"
          >
            <pre>
              {Array.from(
                { length: 20 },
                (_, index) =>
                  `${String(index + 1).padStart(2, "0")}  sample output / all lines remain available`,
              ).join("\n")}
            </pre>
          </section>
        </Example>
      </div>
    </CatalogPage>
  ),
};
