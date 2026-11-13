import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchPalette } from "../../mainview/SearchPalette";
import { useStore } from "../../mainview/store";
import type { ConversationHit, SessionInfo } from "../../shared/rpc-schema";
import { setStoryConversationSearch } from "../browser-rpc";

const general = "C:\\Users\\gummy\\.config\\pig\\general";
const pig = "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\pig";
const compare =
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\url-product-compare";
const now = Date.UTC(2026, 10, 14, 9);
const chat = (
  cwd: string,
  id: string,
  title: string,
  hoursAgo: number,
): SessionInfo => ({ id, cwd, title, modified: now - hoursAgo * 3_600_000 });
const sessions: Record<string, SessionInfo[]> = {
  [general]: [
    chat(general, "g1", "週末の旅行プランを相談", 2),
    chat(general, "g2", "TypeScriptの型パズルを解く", 30),
    chat(general, "g3", "英語メールの添削", 70),
  ],
  [pig]: [
    chat(pig, "p1", "スクロールバーの端の余白を揃える", 1),
    chat(pig, "p2", "Session hostの停止処理を整理", 5),
    chat(pig, "p3", "設定画面にキーボードショートカットを追加", 9),
    chat(pig, "p4", "Markdownの表の罫線を修正", 26),
    chat(pig, "p5", "起動時間の調査", 48),
    chat(pig, "p6", "Provider使用量のリング表示", 72),
    chat(pig, "p7", "Composerの下に表示しないルールの確認", 96),
    chat(pig, "p8", "Workerでのハイライト処理", 120),
  ],
  [compare]: [
    chat(compare, "c1", "スクレイパーのリトライ設計", 4),
    chat(compare, "c2", "価格比較テーブルのレイアウト", 40),
  ],
};
const hits: ConversationHit[] = [
  {
    sessionId: "p1",
    cwd: pig,
    entryId: "e1",
    role: "assistant",
    timestamp: now - 3_600_000,
    snippet:
      "…縦横が同時に出るとスクロールバーの交差領域が片側の余白に加算されるので、両軸で補正します…",
  },
  {
    sessionId: "p1",
    cwd: pig,
    entryId: "e2",
    role: "user",
    timestamp: now - 2 * 3_600_000,
    snippet: "ツール出力のスクロールバーが角丸で見切れているので直して",
  },
  {
    sessionId: "p8",
    cwd: pig,
    entryId: "e3",
    role: "assistant",
    timestamp: now - 120 * 3_600_000,
    snippet:
      "…長いコードでもスクロール中に入力が止まらないよう、解析をWorkerへ移しました…",
  },
];

interface Args {
  query: string;
  language: "ja" | "en";
  /** Content search keeps reporting an index refresh in progress. */
  indexing: boolean;
}

function PaletteStory({ query, language, indexing }: Args) {
  setStoryConversationSearch(({ query: text }) => {
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    return {
      indexing,
      hits: terms.some((term) => term.length >= 2)
        ? hits.filter((hit) =>
            terms.every((term) => hit.snippet.toLowerCase().includes(term)),
          )
        : [],
    };
  });
  const open = useStore((s) => s.searchOpen);
  return (
    <>
      {!open && (
        <button
          type="button"
          className="primary"
          style={{ margin: 24 }}
          onClick={() => useStore.setState({ searchOpen: true })}
        >
          Ctrl+K
        </button>
      )}
      <SearchPalette key={`${language}:${query}`} initialQuery={query} />
    </>
  );
}

const meta = {
  title: "Dialogs/Search Palette",
  component: PaletteStory,
  parameters: {
    gallery: true,
    docs: {
      description: {
        component:
          "Ctrl+Kで開く何でも検索。チャット名・設定・操作・ページはfuzzy、会話本文は全語を含む部分一致で、名前系の下に新しい順で並びます。一覧は高さ固定で枠内スクロール。選択（Enter / クリック）とEscで閉じ、Storyでは「Ctrl+K」ボタンで再表示します。",
      },
    },
  },
  args: { query: "", language: "ja", indexing: false },
  argTypes: {
    language: { control: "inline-radio", options: ["ja", "en"] },
  },
  loaders: [
    async ({ args }) => {
      useStore.setState((state) => ({
        searchOpen: true,
        sessions,
        bootstrap: {
          ...state.bootstrap,
          generalCwd: general,
          projects: [pig, compare],
        },
        settings: { ...state.settings, language: args.language },
      }));
      return {};
    },
  ],
} satisfies Meta<typeof PaletteStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Recent: Story = { name: "01 · 最近のチャット（空クエリ）" };
export const FuzzySettings: Story = {
  name: "02 · 設定・操作のfuzzy一致",
  args: { query: "win op" },
};
export const ChatsAndMessages: Story = {
  name: "03 · チャット名 + 会話本文",
  args: { query: "スクロール" },
};
export const Indexing: Story = {
  name: "04 · 索引作成中",
  args: { query: "スクロール", indexing: true },
};
export const NoResults: Story = {
  name: "05 · 該当なし",
  args: { query: "zzzz" },
};
export const English: Story = {
  name: "06 · English UI",
  args: { query: "short", language: "en" },
};
