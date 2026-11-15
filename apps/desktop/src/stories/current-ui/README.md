# Screens / Domain — 大枠から共通化の境界を見つける

`mise run storybook` → **Design System**

- **Screens / App**：本番の `App` をそのまま表示する。会話／実行中／確認待ち／空のチャット／設定／分割画面。
- **Domain / Sidebar**：セッション一覧・使用量・画面移動・通知を含むサイドバー全体。
- **Domain / ChatScreen**：本番の `Chat`。会話履歴・応答・活動パネル・ComposerUIを含む。
- **Domain / ComposerUI**：本番の `Composer`。入力・添付・モデル選択・送信操作を含む。

`ModelPicker`はComposerUI、`NotificationCenter`はSidebar、`SessionPanel`はChatScreenの
配下に置く。個別部品からではなく、各大枠の **Default** と全体画面から確認する。
Sidebarの枠は現在App内に直接書かれているため、Storybook側で本番の子コンポーネントを
同じ構成に並べている。本番Appからの抽出・置換はまだ行わない。

プレビューの実装は単位ごとに別モジュールへ分け、選んだStoryの表示時にだけ読み込む。
共通の入口へAppや全プレビューを静的importしない。SidebarやModelPickerだけを開く際に、
無関係な画面・ターミナル・Markdown描画まで読み込まないための境界。
AppとChatScreenは本番Appモジュールを使うため、その初回読み込み自体は残る。

まず全体画面を見て、サイドバー・会話と入力・設定などの大きいまとまりから共通化の候補を探す。
Primitiveの設計や本番コードの移動・置き換えは、この段階では行わない。
見た目をコピーした別実装ではなく、本番TSXを直接importする。

## 操作できる範囲

- モデル選択・effort・通知の既読・設定の配色などは、Storybookのサンプル状態だけに反映する。
- 送信・ツール実行・認証・ファイル操作・ネイティブウィンドウ操作は実ホストへ接続しない。
  未接続の要求は拒否し、ネイティブメッセージは送らない。
- 設定変更はアプリの設定ファイルに保存しない。Storybook用ブラウザのローカル状態とキャッシュだけを使う。
- テーマカラーは本番の `createThemeTokens` / `DynamicTheme` と同じ経路を使う。
  Controlsの色を変えるか、全体画面の外観設定から確認できる。
- Storyを離れるとstore・CSS変数・言語・サンプル下書きを片付ける。

このプレビューが本番アプリの全機能をエミュレートするわけではない。
実行・通信の正しさは既存テストで別に検証する。デスクトップ固有の幅制約もそのままで、
この追加だけでスマホ対応済みとは扱わない。

## 検証

```powershell
mise exec -- bun test ./apps/desktop/src/stories/current-ui/fixtures.test.ts
mise exec -- bun test ./apps/desktop/.storybook/current-ui-ui.test.ts
mise exec -- pnpm test:ui
```

専用描画テストはStorybookを一時ディレクトリへビルドし、独立したブラウザで画面全体と
各まとまりを検査する。モデル選択・通知・活動パネル・テーマ変更・送信の拒否・Story間の
状態リセットを確認し、実アプリのウィンドウやブラウザプロファイルには接続しない。
