import type { Meta } from "@storybook/react-vite";
import { ErrorAlert } from "../../mainview/patterns/ErrorAlert";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ErrorAlert",
  component: ErrorAlert,
  parameters: { gallery: true },
} satisfies Meta<typeof ErrorAlert>;

export const States = {
  name: "ErrorAlert",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="ErrorAlert"
      intro="ダイアログ内で処理の失敗と、必要に応じて次の操作を知らせます。"
      context="接続に失敗した場合"
      variants={[
        {
          label: "短いエラー",
          sample: <ErrorAlert>サインインできませんでした。</ErrorAlert>,
        },
        {
          label: "再試行の案内付き",
          sample: (
            <ErrorAlert>
              コードの有効期限が切れました。接続先のPCで新しいコードを発行してください。
            </ErrorAlert>
          ),
        },
      ]}
    >
      <ErrorAlert>
        接続先に届きません。PCがオンラインか確認してください。
      </ErrorAlert>
    </PrimitiveSpecimen>
  ),
};
