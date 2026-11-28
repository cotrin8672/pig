import type { Meta } from "@storybook/react-vite";
import {
  DisclosureScope,
  LazyDetails,
} from "../../mainview/patterns/LazyDetails";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/LazyDetails",
  component: LazyDetails,
  parameters: { gallery: true },
} satisfies Meta<typeof LazyDetails>;

export const States = {
  name: "LazyDetails",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="LazyDetails"
      intro="閉じている間は本文を描画しません。長いエラーの詳細や圧縮の要約に使います。"
      context="エラーに添える補足"
      variants={[
        {
          label: "閉じた状態",
          sample: (
            <LazyDetails summary="詳細">
              {() => <p>ネットワーク接続を確認してください。</p>}
            </LazyDetails>
          ),
        },
        {
          label: "開いた状態",
          sample: (
            <DisclosureScope id="open-example" reveal={1}>
              <LazyDetails summary="詳細">
                {() => <p>ネットワーク接続を確認してください。</p>}
              </LazyDetails>
            </DisclosureScope>
          ),
        },
      ]}
    >
      <LazyDetails summary="エラーの詳細">
        {() => <p>サーバーから時間内に応答がありませんでした。</p>}
      </LazyDetails>
    </PrimitiveSpecimen>
  ),
};
