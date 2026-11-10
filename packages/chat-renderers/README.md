# @pig/chat-renderers

信頼されたローカル TSX でチャット表示を差し替える API。アプリ内エディタはありません。

## 読み込み

`~/.config/pig/chat-renderers.tsx`（Windows: `%USERPROFILE%\.config\pig\chat-renderers.tsx`）に保存します。
起動時に読み込み、変更後は **設定 → 外観 → 描画コンポーネントを再読込** で反映します。
再読込は表示だけを更新し、セッション・拡張・ツールを再実行しません。ファイルを削除して再読込すると標準表示に戻ります。
プロジェクト内のファイルやツール出力中のコードは自動検出・実行しません。

```tsx
import { defineChatRenderers, type ChatRendererProps } from "@pig/chat-renderers";
import { useState } from "react";

function LensView({ data, DefaultRenderer }: ChatRendererProps<"tool">) {
  const [expanded, setExpanded] = useState(false);
  return <section>
    <button type="button" onClick={() => setExpanded(!expanded)}>
      {data.call.name} · {data.state?.status ?? "waiting"}
    </button>
    {expanded && <pre>{JSON.stringify(data.state?.result, null, 2)}</pre>}
    <DefaultRenderer />
  </section>;
}

export default defineChatRenderers([{
  id: "my-lens-view",
  kind: "tool",
  match: data => data.call.name === "your-lens-tool-name",
  component: LensView,
}]);
```

pi-lens 等の **実際の登録ツール名** と結果スキーマに条件を合わせてください。パッケージ名からツール名・結果形式は推測しません。
`examples/chat-renderers/chat-renderers.tsx` に別ファイルへコピーして試せる例があります。

## 共通シグネチャ

すべて `ChatRendererProps<Kind>` の `{ data, DefaultRenderer }` を受け取る React コンポーネントです。
Hooks、関数コンポーネント、class、memo/forwardRef を使用できます。`component` は通常の React 要素として描画されます。

| kind | data |
|---|---|
| `markdown` | `text`。Markdown 全体の差し替え（AST ノード単位ではない） |
| `image` | `sources`。メッセージ内の画像ギャラリー単位 |
| `thinking` | `text`, `label`, `active` |
| `tool` | `call: { id, name, arguments }`, `state?: { status, result }`, `live`, `card?` |
| `custom` | `id`, `entryId?`, `customType`, `content`, `details?`, `raw` |

- `match` は省略時に同じ kind のすべてに一致します。定義順で最初に一致した表示を使用します。
- `id` はファイル内で一意の非空文字列（128文字以下）、定義は最大128件。
- `DefaultRenderer` は現在項目の標準表示を呼び、同じ項目の選択処理を迂回します。ツールでは既存 `toolViews` のカードも維持します。
- 既定 Markdown、画像、bash/read/edit 等のツール、思考表示、カスタムエントリも同じシグネチャで接続しています。ユーザーバブルの編集・再送や応答フッター等のアプリ操作は対象外です。
- 保存済み履歴とライブ更新に同じ定義を使います。`state` がない／途中結果しかないケースを扱ってください。`live` はセッション稼働中を表し、そのツールの完了状態は `state.status` を参照します。
- コンパイル・module 評価・定義検証エラーでは最後に成功した定義を維持します。条件判定エラーは次の候補へ進み、描画エラーは標準表示へ戻します。診断は設定画面で確認できます。
- 履歴の生データは変更しません。表示の再読込でコンポーネント内の一時状態はリセットされます。

### 組み込み pi-lens 表示

pi-lens 4.4.11 の13個の登録ツールに組み込み `ChatRenderer` を用意しています。新規のカード用 CSS は使わず、既存 `ToolRow` と `ToolResultContent` を合成します。見出しは `pi-lens · references` 等の拡張名＋操作名とし、対象・件数・行範囲・プレビュー状態をまとめます。本文と usage footer は既存のコード風表示を使います。
ユーザーの React 定義が最優先で、既存 `toolViews` のカードがある呼び出しは pi-lens の組み込み表示では捕捉しません。表示からツールを再実行したりファイルを変更したりはしません。
`Tool details` の生 JSON 表示は汎用ツールを含めて行いません。`result.details` 自体は元データとして保持し、レンダラーの条件判定・状態や件数の表示に使います。

## Import と型補完

`react` と JSX runtime はアプリの React と共有します。`@pig/chat-renderers` は実行時にローダーが提供します。
相対 TS/TSX import とブラウザー用の JS 依存は bundle されます。`react-dom`、Node/Bun API、CSS・画像等の import はこの初版では非対応です。
スタイルは inline style や既存の `--ds-*` CSS トークンを使ってください。CDN は不要です。

設定ディレクトリに型補完用のローカル依存を入れる場合（このパッケージは未公開）:

```powershell
mise exec -- pnpm add -D 'C:\path\to\piris\packages\chat-renderers' @types/react
```

## 信頼境界

**sandbox ではありません。** コンポーネントはアプリの WebView でコードとして実行され、ブラウザーが許す DOM・ネットワーク等にアクセスできます。
Node/Bun import の拒否や Error Boundary はセキュリティ隔離ではなく、無限ループも止められません。
出所不明のコードやモデル生成コードは確認せず配置しないでください。マッチ関数・描画でツールや操作を実行せず、top-level は宣言のみにします。
コンポーネントの effect は適切に cleanup してください。CSS の全体変更や top-level の副作用は自動回収できません。
TUI Widget にしか存在しない情報は取得できません。拡張の JSON 出力／custom entry など、実際に公開されたデータが必要です。
