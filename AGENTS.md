# AGENTS.md

## Launching the app (Windows)

Use `mise run dev`. It focuses the existing development window without rebuilding,
or starts `pnpm dev` in the background if the app is not running. Startup logs are
in `%TEMP%/pig-dev.stdout.log` and `%TEMP%/pig-dev.stderr.log`.
Do not start another `pnpm dev` while the development app is running.

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
