import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import {
  ComposerUIPreview,
  ModelPickerPreview,
  PreviewTheme,
} from "./Previews";

const meta = {
  id: "domain-composer-ui",
  title: "Design System/Domain/ComposerUI",
  parameters: { appPreview: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <ComposerUIPreview />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Running: Story = { args: { scene: "running" } };
export const ModelPicker: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ModelPickerPreview />
    </PreviewTheme>
  ),
};

export const ModelPickerNarrow: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ModelPickerPreview paneWidth={380} />
    </PreviewTheme>
  ),
};

export const ModelPickerSmall: Story = {
  parameters: { appPreview: false, gallery: true },
  render: (args) => (
    <PreviewTheme args={args}>
      <ModelPickerPreview paneWidth={280} />
    </PreviewTheme>
  ),
};
