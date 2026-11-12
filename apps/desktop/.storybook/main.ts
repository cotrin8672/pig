import type { StorybookConfig } from "@storybook/react-vite";

export default {
  stories: ["../src/stories/**/*.stories.tsx"],
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: ".storybook/vite.config.ts" } },
  },
} satisfies StorybookConfig;
