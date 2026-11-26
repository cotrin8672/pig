import type { Meta, StoryObj } from "@storybook/react-vite";
import { lazy } from "react";
import { useStore } from "../../mainview/store";
import type { TranscriptRecord } from "../../shared/transcript";
import {
  installPreview,
  models,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "../current-ui/fixtures";
import { PreviewTheme, SidebarPreview } from "../current-ui/Previews";

const Chat = lazy(() =>
  import("../../mainview/App").then((module) => ({ default: module.Chat })),
);

const exchanges: [string, string][] = [
  [
    "長くなったセッションを途中から再開できるようにしたい。どこから手を付ける？",
    "まず分岐の仕組みを確認します。応答フッターの「新しいチャットに分岐」は `forkChat(sessionId, entryId)` を呼び、その応答の直後から新しいチャットを作ります。\n\n途中から再開するUIは、この分岐を**目的のターンまで移動せずに**呼べるようにするのが近道です。",
  ],
  [
    "検索パレットのジャンプはどう実装されてる？",
    "`useStore` の `jump` に `entryId` を入れると、Chat が該当レコードまで読み込みを続け、見つかったら `revealTarget` で中央に表示してハイライトします。\n\n左端の目次からのジャンプも同じ経路を使えます。",
  ],
  [
    "履歴が長いと古いページは読み込まれていないよね？",
    "はい。`useHistoryPaging` が上端に近づいたときに前のページを読みます。`jump` は見つかるまで `loadEarlier` を繰り返すので、未読み込みのターンにも移動できます。",
  ],
  [
    "40行を超えると VirtualTurns になるけど、目次は大丈夫？",
    "描画されていない行は位置が取れないので、現在地の判定は描画済みの行に限られます。本実装では VirtualTurns の `keys` とスクロール位置から求めるのが確実です。",
  ],
  [
    "目盛りの見た目は既存のどのUIに合わせる？",
    "プレビューのカードはツールチップと同じ `.ui-tooltip` の面を使います。目盛りは `--ds-text-faint` で控えめにし、現在地だけ `--ds-text-primary`、ホバー中は `--ds-accent` にします。",
  ],
  [
    "Composer と重なったりしない？",
    "目次は `.thread-scroll` と同じ上下余白の中に置き、Composer の高さ (`--composer-height`) の上で止めます。z-index は「最下部へ」ボタンより下です。",
  ],
  [
    "キーボードでも使える？",
    '各目盛りはボタンなので Tab で移動でき、フォーカスでもカードが開きます。Enter でジャンプ、Escape でカードを閉じます。現在地には `aria-current="location"` を付けます。',
  ],
  [
    "分岐した後、元のチャットはどうなる？",
    "元のチャットはそのまま残ります。分岐先は新しいチャットとしてサイドバーに追加され、選んだターンの応答までが引き継がれます。",
  ],
  [
    "ターン数がすごく多いと目盛りが溢れない？",
    "目盛りは高さに合わせて詰まり、最小3pxまで縮みます。それでも収まらない場合は、本実装で間引きかスクロールを検討します。",
  ],
  [
    "画像だけ送ったターンの見出しは？",
    "テキストがない場合は「（画像）」と表示します。本文のプレビューはそのターンの最後の応答テキストです。",
  ],
  [
    "じゃあ試作をStorybookに置いて。",
    "`Design System/Domain/TurnRail` に置きました。本番の Chat にそのまま組み込んでいます。",
  ],
  [
    "ありがとう。触ってみる。",
    "気になる点があれば、目盛りの間隔やカードの幅から調整します。",
  ],
];

function longRecords(rounds: number, now = Date.now()): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  const base = (order: number) => ({
    id: `turn-${order}`,
    entryId: `turn-${order}`,
    parentId: order ? `turn-${order - 1}` : null,
    branchId: "preview",
    order,
    kind: "message" as const,
  });
  for (let round = 0; round < rounds; round++)
    exchanges.forEach(([question, reply], index) => {
      const suffix = round ? `（${round + 1}周目）` : "";
      const order = records.length;
      const timestamp = now - (rounds * exchanges.length - order) * 60_000;
      records.push(
        {
          ...base(order),
          message: { role: "user", content: question + suffix, timestamp },
        },
        {
          ...base(order + 1),
          message: {
            role: "assistant",
            content: [{ type: "text", text: reply }],
            api: "anthropic-messages",
            provider: models[0].provider,
            model: models[0].id,
            usage: {
              input: 2800,
              output: 820,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 3620,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            timestamp: timestamp + 30_000 + index,
          },
        },
      );
    });
  return records;
}

type Args = PreviewArgs & { rounds: number };

function TurnRailScreen() {
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  return <SidebarPreview main={<Chat snapshot={snapshot} />} />;
}

const meta = {
  title: "Design System/Domain/TurnRail",
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "本番の Chat に組み込まれたターンの目盛り。左端に近づくと現れ、長い場合はホイールでスクロールする。ホバー／フォーカスで質問と応答の要約を出し、クリックでそのターンへ移動（検索パレットと同じ jump）。カードの分岐ボタンで、そのターンの応答の直後から新しいチャットとして再開する（応答フッターの forkChat と同じ。Storybook では何もしない）。",
      },
    },
  },
  args: { ...previewDefaults, rounds: 2 },
  argTypes: { ...previewArgTypes, rounds: { control: false } },
  beforeEach: ({ args }) => {
    const cleanup = installPreview(args);
    useStore.setState((state) => {
      const id = state.active ?? "";
      const main = state.snapshots[id];
      return {
        snapshots: {
          ...state.snapshots,
          [id]: {
            ...main,
            info: { ...main.info, title: "途中から再開するUIの検討" },
            transcript: {
              ...main.transcript,
              records: longRecords(args.rounds),
            },
          },
        },
      };
    });
    return cleanup;
  },
  render: (args) => (
    <PreviewTheme args={args}>
      <TurnRailScreen />
    </PreviewTheme>
  ),
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LongSession: Story = { name: "長いセッション（24ターン）" };
export const ManyTurns: Story = {
  name: "非常に長いセッション（96ターン）",
  args: { rounds: 8 },
};
