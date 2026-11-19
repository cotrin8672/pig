import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import { Extensions } from "../../mainview/Extensions";
import { useStore } from "../../mainview/store";
import "../../mainview/settings.css";

interface Args {
  language: "ja" | "en";
}

function MarketplaceStory({ language }: Args) {
  useLayoutEffect(() => {
    useStore.setState((state) => ({
      installed: [],
      installedLoaded: true,
      settings: { ...state.settings, language },
    }));
  }, [language]);
  return (
    <div style={{ width: 960, height: 720, display: "flex" }}>
      <Extensions />
    </div>
  );
}

const meta = {
  title: "Settings/Marketplace",
  component: MarketplaceStory,
  parameters: {
    gallery: true,
    docs: {
      description: {
        component:
          "拡張機能 → Marketplace。初期表示は「pig対応」（pigが表示に対応したExtensionだけ）で、「すべてのパッケージ」で通常検索に切り替える。対応Extensionのカードには動作確認版のバッジが付く。データは模擬応答。",
      },
    },
  },
  args: { language: "ja" },
  argTypes: {
    language: { control: "inline-radio", options: ["ja", "en"], name: "言語" },
  },
} satisfies Meta<Args>;
export default meta;

export const Supported: StoryObj<typeof meta> = {};
