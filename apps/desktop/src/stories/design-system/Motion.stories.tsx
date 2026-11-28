import type { Meta } from "@storybook/react-vite";
import "./catalog.css";

export default {
  title: "Design System/Foundations/Motion",
  parameters: { gallery: true },
} satisfies Meta;

const motions = [
  {
    label: "完了の合図",
    description:
      "コピーが成功したときだけチェックを120msで0.6倍から等倍に戻します。押す位置は動かさず、通常アイコンに戻るときは動かしません。",
    stories: [["CopyButton", "design-system-patterns-copybutton--states"]],
  },
  {
    label: "ドロップダウン",
    description:
      "候補・操作の一覧は140msでフェードインしながら0.97倍から等倍へ。閉じるときは80msのフェードアウトのみです。",
    stories: [
      ["Select", "design-system-primitives-select--states"],
      ["ActionsMenu", "design-system-patterns-actionsmenu--states"],
    ],
  },
  {
    label: "押下と切り替え",
    description:
      "ボタンはホバーで1px浮き、押すと96%に縮みます。Switchは100ms、SegmentedControlの選択表示は140msで切り替わります。",
    stories: [
      ["Button", "design-system-primitives-button--states"],
      ["Switch", "design-system-primitives-switch--states"],
      ["SegmentedControl", "design-system-primitives-segmentedcontrol--states"],
    ],
  },
] as const;

export const Overview = {
  name: "Motion",
  render: () => (
    <main className="ds-review">
      <header className="ds-review-header">
        <small className="ds-review-kicker">Design system / Foundations</small>
        <h1>Motion</h1>
        <p>
          Snappy Motionを基にした本番の動き。リンク先で操作して確認できます。
        </p>
      </header>
      <dl className="ds-review-table">
        {motions.map(({ label, description, stories }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {description}
              <div className="ds-review-inline">
                {stories.map(([name, id]) => (
                  <a
                    key={id}
                    className="underline"
                    href={`./?path=/story/${id}`}
                    target="_top"
                  >
                    {name}
                  </a>
                ))}
              </div>
            </dd>
          </div>
        ))}
      </dl>
      <p className="ds-review-note">
        動きを減らす設定ではアニメーションを止め、状態の切り替えは即時に行います。
        モデルPickerなどの個別の面に、この一覧の退場ルールを一律には適用しません。
      </p>
    </main>
  ),
};
