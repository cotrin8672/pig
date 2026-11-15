import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatHistoryImport } from "../../mainview/ChatHistoryImportSettings";
import { useStore } from "../../mainview/store";
import "../../mainview/settings.css";
import type { ChatHistoryFileEvent } from "../../shared/chat-history-import";
import { filePreview, localPreview } from "./history-import-data";

type Phase = "loading" | "codex" | "claude-code" | "file" | "importing";
interface Args {
  phase: Phase;
  language: "ja" | "en";
}

function ImportStory(_: Args) {
  return (
    <div
      className="settings-page"
      style={{ width: 860, padding: 24, containerType: "inline-size" }}
    >
      <section className="settings-content">
        <h2>チャットのインポート</h2>
        <ChatHistoryImport />
      </section>
    </div>
  );
}

function fileEvent(phase: Phase): ChatHistoryFileEvent | undefined {
  switch (phase) {
    case "loading":
      return { requestId: "story", source: "codex" };
    case "codex":
    case "importing":
      return {
        requestId: "story",
        source: "codex",
        preview: localPreview("codex"),
      };
    case "claude-code":
      return {
        requestId: "story",
        source: "claude-code",
        preview: localPreview("claude-code"),
      };
    case "file":
      return { requestId: "story", preview: filePreview };
    default:
      return undefined;
  }
}

const meta = {
  title: "Settings/Chat History Import",
  component: ImportStory,
  parameters: {
    gallery: true,
    docs: {
      description: {
        component:
          "設定 →「チャットのインポート」。上のタブで取り込み元（Codex・Claude Code・エクスポートファイル）を選び、右で検索・プロジェクト絞り込み・並び替え・選択、下で取り込み先を選ぶ。数百件を前提にした一覧（Codex 248件・Claude Code 98件の模擬データ）。ボタン操作は模擬応答で動く。",
      },
    },
  },
  args: { phase: "codex", language: "ja" },
  argTypes: {
    phase: {
      control: "select",
      options: ["loading", "codex", "claude-code", "file", "importing"],
    },
    language: { control: "inline-radio", options: ["ja", "en"] },
  },
  loaders: [
    async ({ args }) => {
      useStore.setState((state) => ({
        chatHistoryFile: fileEvent(args.phase),
        chatHistoryImporting: args.phase === "importing",
        notices: [],
        bootstrap: {
          ...state.bootstrap,
          generalCwd: "C:\\Users\\gummy\\.config\\pig\\general",
          projects: [
            "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\piris",
            "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\url-product-compare",
          ],
        },
        settings: { ...state.settings, language: args.language },
      }));
      return {};
    },
  ],
} satisfies Meta<typeof ImportStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Codex: Story = { name: "01 · Codex（248件）" };
export const ClaudeCode: Story = {
  name: "02 · Claude Code（98件）",
  args: { phase: "claude-code" },
};
export const Loading: Story = {
  name: "03 · 履歴を読み込み中",
  args: { phase: "loading" },
};
export const Importing: Story = {
  name: "04 · 取り込み中（操作ロック）",
  args: { phase: "importing" },
};
export const ExportFile: Story = {
  name: "05 · エクスポートファイル",
  args: { phase: "file" },
};
export const English: Story = {
  name: "06 · English UI",
  args: { phase: "codex", language: "en" },
};
