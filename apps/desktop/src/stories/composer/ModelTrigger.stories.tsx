import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  EffortLevelsPreview,
  ModelTriggerPreview,
  presets,
} from "./ModelTriggerPreview";

const meta = {
  title: "Chat/Composer/Model trigger",
  component: ModelTriggerPreview,
  args: { preset: "deepseek", effort: "high" },
  argTypes: {
    preset: {
      control: "select",
      options: Object.keys(presets),
      description: "実カタログにある段階の組み合わせ",
    },
    effort: {
      control: "inline-radio",
      options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      description: "モデルにない段階は最も近い段階に丸める",
    },
  },
} satisfies Meta<typeof ModelTriggerPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Levels: Story = {
  name: "Effort levels",
  parameters: { controls: { disable: true } },
  render: () => <EffortLevelsPreview />,
};
