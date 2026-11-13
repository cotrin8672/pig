# AGENTS.md

## Launching the app (Windows)

Use `mise run dev`. It focuses the existing development window without rebuilding,
or starts `pnpm dev` in the background if the app is not running. Startup logs are
in `%TEMP%/pig-dev.stdout.log` and `%TEMP%/pig-dev.stderr.log`.
Do not start another `pnpm dev` while the development app is running.

## UI rules (required)

UIを追加・変更する前に [docs/ui-guidelines.md](docs/ui-guidelines.md) を読むこと。
共通CSS・デザイントークン・既存コンポーネントを再利用し、画面ごとの独自ルールを増やさない。
特に次を守る：

- 通常のCardは半透明の背景レイヤーにする。Card全体への `opacity` や不透明な塗りで代用しない。
- スクロールバーは上下・左右の端の余白を揃え、角丸と縦横バーの交差部分を考慮する。
- ターミナルとファイル出力・編集差分は枠の左右を揃え、プレビューは約8行。超過分は枠内スクロール。
- アイコン列は上下の余白を揃える。状態変化で周囲のレイアウトを動かさない。
- 共通部品の問題は同種の表示も調べて共通処理で直し、実描画で検証する。

`pnpm lint` はCSS/JSXのUI専用Lintも実行する。UI変更後は `mise exec -- pnpm test:ui`
も実行する（ブラウザがなければ失敗する）。新しい通常Cardは `*-card` / `ui-card` クラス、
または `data-ui-surface="card"` で検査対象を明示する。
新しい共通の指摘は、文書だけでなく可能な限りLintか描画テストに追加する。

新しいUIの指摘・合意が共通ルールに当たる場合は、実装と一緒にガイドも更新する。
ガイドから外れるデザインは、既存の例外を根拠に広げず、ユーザーに確認する。

## Composer UI: no messages below the editor

ComposerUIの下にテキストメッセージ系UIを追加しない。送信状態、エラー、
モデル未選択の案内、ヒント、ショートカット説明、拡張の `belowEditor` ウィジェットも禁止。
表示の有無でComposerや会話領域の高さ・位置を変えない。空き領域の予約やCSSで隠す
対処ではなく、描画自体をなくす。必要なエラーは既存の通知UIを使う。

## Toolchain

pnpm, bun and node are installed via [mise](https://mise.jdx.dev/) (global config), not on the
default PATH of non-interactive shells. Prefix commands with `mise exec --`:

```powershell
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm test
```
