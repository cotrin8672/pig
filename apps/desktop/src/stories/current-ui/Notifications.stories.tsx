import type { Meta, StoryObj } from "@storybook/react-vite";
import { Notifications } from "../../mainview/Notifications";
import { Button } from "../../mainview/primitives/Button";
import { useStore } from "../../mainview/store";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { PreviewTheme } from "./Previews";

function showExample(warning = false) {
  useStore.setState((state) => ({
    notices: warning
      ? [
          {
            id: "warning",
            level: "warning",
            message:
              "Providerの使用量を更新できませんでした。\n最後に取得できた値を表示しています。接続を確認してから、サイドバーで再度更新してください。",
          },
        ]
      : [
          {
            id: "info",
            level: "info",
            message: "新しいバージョンを利用できます。",
          },
          {
            id: "success",
            level: "success",
            message: "チャットの応答が完了しました。",
            session: state.noticeHistory[0]?.session,
          },
          {
            id: "error",
            level: "error",
            message: "チャットの履歴を読み込めませんでした。",
          },
        ],
  }));
}

const meta = {
  title: "Design System/Domain/Notifications",
  parameters: { gallery: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => {
    const cleanup = installPreview(args);
    showExample();
    return cleanup;
  },
  render: (args) => (
    <PreviewTheme args={args}>
      <PrimitiveSpecimen
        layer="Domain"
        wide
        title="Notifications"
        intro="直近の通知をトーストで表示します。チャットに紐づく通知からは、対象のチャットを開けます。"
        context="通知のトースト"
        variants={[
          {
            label: "情報・完了・失敗",
            sample: <Button onClick={() => showExample()}>表示</Button>,
          },
          {
            label: "警告・長文",
            sample: (
              <Button onClick={() => showExample(true)}>警告を表示</Button>
            ),
          },
        ]}
      >
        <div className="current-ui-toast-sample">
          <Notifications />
        </div>
      </PrimitiveSpecimen>
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;

export const States: StoryObj<typeof meta> = { name: "Notifications" };
