import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ComposerSubmit } from "../../mainview/ComposerSubmit";
import { EffortChip } from "../../mainview/EffortChip";
import type { Effort } from "../../shared/rpc-schema";
import { CatalogPage, CatalogSection, Example } from "./ReviewPage";
import "../../mainview/composer.css";

export default {
  id: "design-system-04-domain",
  title: "Design System/Domain/ComposerUI",
  parameters: { gallery: true },
} satisfies Meta;

const states = [
  { title: "送信", busy: false, hasContent: true, disabled: false },
  { title: "空入力", busy: false, hasContent: false, disabled: true },
  {
    title: "応答中・空入力 → 停止",
    busy: true,
    hasContent: false,
    disabled: false,
  },
  {
    title: "応答中・追加入力 → 送信",
    busy: true,
    hasContent: true,
    disabled: false,
  },
  {
    title: "送信待ち",
    busy: false,
    hasContent: true,
    disabled: false,
    waiting: true,
  },
  {
    title: "停止確認中",
    busy: true,
    hasContent: false,
    disabled: false,
    stopping: true,
  },
  {
    title: "中断後・空入力 → 再開",
    busy: false,
    hasContent: false,
    disabled: false,
    resumable: true,
  },
] as const;

export const ComposerActions = {
  name: "ComposerSubmit",
  render: () => (
    <CatalogPage
      title="小さくてもDomain固有の部品"
      intro="ComposerSubmitの本番実装を、状態ごとに直接表示します。実Composerや通信は起動せず、送信・停止の操作は接続しません。"
    >
      <CatalogSection title="同じ位置・寸法で状態を切り替える">
        <div className="ds-review-grid">
          {states.map(({ title, ...state }) => (
            <Example
              key={title}
              title={title}
              evidence="既存部品"
              source="mainview/ComposerSubmit.tsx"
              use="Composerの1つの操作枠で、送信・停止・待機・再開を示す。"
              avoid="操作ボタンの重複、状態ごとの位置変更、Composer下への説明行の追加。"
            >
              <form
                className="ds-review-submit"
                onSubmit={(event) => event.preventDefault()}
              >
                <ComposerSubmit {...state} onStop={() => {}} />
              </form>
            </Example>
          ))}
        </div>
      </CatalogSection>
    </CatalogPage>
  ),
};

function EffortExample() {
  const levels: Effort[] = ["off", "low", "medium", "high", "xhigh"];
  const [effort, setEffort] = useState<Effort>("medium");
  return (
    <CatalogPage
      title="汎用BadgeとDomain固有Chipを分ける"
      intro="EffortChipはモデルの正式なeffort段階とラベル幅を扱う、小さなDomain部品です。単なる色付きBadgeへ置き換えません。"
    >
      <Example
        title="EffortChip"
        evidence="既存部品"
        source="mainview/EffortChip.tsx"
        use="モデルに提供される段階を表し、段階の切り替えでラベル幅を動かさない。"
        avoid="任意の属性や実行状態を表示する汎用Badgeとして使うこと。"
      >
        <div className="ds-review-field">
          <label>
            段階のサンプル
            <select
              value={effort}
              onChange={(event) => setEffort(event.target.value as Effort)}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ds-review-inline">
          <span>モデルの補足</span>
          <EffortChip levels={levels} effort={effort} />
        </div>
      </Example>
      <CatalogSection title="Domainを組み合わせる例">
        <dl className="ds-review-table">
          <div>
            <dt>SessionRow</dt>
            <dd>
              ListRow + SessionStatus +
              ActionsMenu。SessionStatusが実行状態の意味を、StatusDotが見た目を担当する構成案。
            </dd>
          </div>
          <div>
            <dt>ModelPicker</dt>
            <dd>
              検索・選択のPattern + モデル候補 + Provider +
              Effort。選択肢や通信の正本は外側に置く構成案。
            </dd>
          </div>
          <div>
            <dt>Screens</dt>
            <dd>
              会話・一覧・承認の組み合わせは、Domainの境界を確認してから追加する。スマホでは構成を変えても部品の意味を保つ。
            </dd>
          </div>
        </dl>
      </CatalogSection>
    </CatalogPage>
  );
}

export const DomainBoundary = {
  name: "EffortChip",
  render: () => <EffortExample />,
};
