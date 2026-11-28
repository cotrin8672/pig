import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationCenter } from "../../mainview/NotificationCenter";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { PreviewTheme } from "./Previews";

const meta = {
  title: "Design System/Domain/NotificationCenter",
  parameters: { gallery: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <PrimitiveSpecimen
        layer="Domain"
        wide
        title="NotificationCenter"
        intro="通知の履歴を開き、全件と未読を切り替えます。見本内で既読・消去後の空の状態も確認できます。"
        context="サイドバーの通知履歴"
      >
        <aside className="sidebar current-ui-notification-anchor">
          <div className="sidebar-footer">
            <NotificationCenter />
          </div>
        </aside>
      </PrimitiveSpecimen>
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;

export const States: StoryObj<typeof meta> = { name: "NotificationCenter" };
