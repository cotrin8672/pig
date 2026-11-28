import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { PreviewTheme, SidebarPreview } from "./Previews";

const meta = {
  id: "domain-sidebar",
  title: "Design System/Domain/Sidebar",
  parameters: { appPreview: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <SidebarPreview />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
