import type {
  ChatHistoryItem,
  ChatHistoryPreview,
  ChatHistorySource,
  LocalHistorySource,
} from "../../shared/chat-history-import";

const now = Date.UTC(2026, 10, 14, 9);
const hour = 3_600_000;
const projects = [
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\piris",
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\url-product-compare",
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\matlab-lsp",
  "C:\\Users\\gummy\\research\\thermal-model",
  "C:\\Users\\gummy\\Documents\\notes",
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\dotfiles",
];
const topics = [
  "スクロールバーの端の余白を揃える",
  "Session hostの停止処理を整理",
  "設定画面にキーボードショートカットを追加",
  "Markdownの表の罫線を修正",
  "起動時間の調査",
  "Provider使用量のリング表示",
  "Workerでのハイライト処理",
  "Rustのライフタイムが分からない",
  "SQLのインデックス設計",
  "論文の要約と比較表",
  "熱モデルのパラメーター同定",
  "MATLABのLSPでホバーが出ない",
  "dotfilesのPowerShellプロファイル整理",
  "スクレイパーのリトライ設計",
  "Reactの再描画を減らす方法",
  "取り込みダイアログのレビュー対応",
];

/** Hundreds of chats over months, uneven across projects, like a real history. */
function items(source: ChatHistorySource, count: number): ChatHistoryItem[] {
  return Array.from({ length: count }, (_, index) => {
    const project = projects[(index * index + index * 3) % projects.length];
    return {
      id: `${source}-${index}`,
      source,
      title: `${topics[index % topics.length]}${index >= topics.length ? ` (${Math.floor(index / topics.length) + 1})` : ""}`,
      modified: now - index * 7 * hour - ((index * 37) % 50) * 60_000,
      workspace: index % 23 === 0 ? undefined : project,
      ...(source === "chatgpt" || source === "claude"
        ? { messageCount: 4 + ((index * 7) % 30) }
        : {}),
      warnings: [],
    };
  });
}

/** A desktop app's own history files: titles only, bodies are read on import. */
export const localPreview = (
  source: LocalHistorySource,
): ChatHistoryPreview => ({
  id: `story-${source}`,
  kind: "local",
  source,
  label: source === "codex" ? "Codex" : "Claude Code",
  rejected: 0,
  conversations: items(source, source === "codex" ? 248 : 98),
});

/** Offline fallback: an official export already parsed, so counts are known. */
export const filePreview: ChatHistoryPreview = {
  id: "story-file",
  kind: "file",
  label: "conversations.json",
  rejected: 2,
  conversations: items("chatgpt", 40).map((item, index) => ({
    ...item,
    workspace: undefined,
    warnings: index % 4 === 1 ? ["attachments"] : [],
  })),
};
