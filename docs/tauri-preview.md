# Windows Tauri 版

Tauri 2 / WebView2 で既存の React 画面を開き、別プロセスの Bun で既存の Pi SDK を動かす。
会話、下書き、モデル、認証、拡張は従来の Bun ホストを使う。ウィンドウ、メニュー、
ダイアログ等は Tauri 側が担当する。ホバー式タイトルバーと背景設定は共通 UI のまま。

## 起動・ポータブルビルド

開発やビルドには Windows WebView2、Rust の MSVC ツールチェーン、Visual Studio C++ Build
Tools、Windows SDK と、開発用の Bun・Node・pnpm が必要。

```powershell
mise exec -- pnpm install --frozen-lockfile
mise run dev
mise exec -- pnpm --filter @pig/desktop tauri:package
```

ポータブル版は `apps/desktop/build/tauri-portable/pig.exe`。`host/` に Bun と Pi SDK が
同梱されるため、フォルダーごと配置すれば WebView2 のある端末で起動できる。外部の `node` を
直接呼ぶ拡張では、従来どおりその拡張用の Node が必要（mise で見つかる場合は補う）。
新しい Tauri プロファイルの既定シェルは Windows 標準の PowerShell。

デスクトップ設定は `%APPDATA%\dev.pig.tauri\pig` に分離する。通常起動では Pi CLI と同じ
認証・設定・セッション保存先を使う。同じ会話を Electrobun 版と Tauri 版で同時に操作しない。
旧版のデスクトップ設定を無断で移行しない。移行ブランチの `pnpm dev` は Tauri だが、
製品版のインストーラー・更新・Scoop はこの段階では Electrobun のまま。

## 検証

```powershell
mise exec -- pnpm --filter @pig/desktop tauri:smoke
mise exec -- pnpm --filter @pig/desktop tauri:smoke:package
```

実際の WebView2 と React 画面を起動し、隔離したテストプロファイルとローカルの模擬モデルで、
Pi への送信、返答のストリーム、保存・再表示、最大化／復元、正常終了を検査する。
ポータブル版の検査では一式を作業ツリー外に移し、Node や Bun の開発 PATH を外す。
正規のプロバイダーへのログイン、Snap Layouts・混在 DPI・タスクバー自動非表示・IME、
透過の画素は別途実機で確認する。

## IPC と iframe

Rust が Bun を起動し、親子プロセス間のパイプで通信する。WebView2 に Bun の待ち受けポート、
または Tauri の shell・filesystem 権限は公開しない。WebView2 の接続はウィンドウと
ページ世代に紐づき、再読込前のフレームの応答は新しいページに届かない。

IPCは1フレーム64 MiBまで。上限を超えるRPC応答は待ち時間切れではなくエラーを返す。
上限を超える履歴の分割転送には未対応。ウィンドウのリサイズは未送信の最新値にまとめ、
閉じる・終了の通知は画面からのIPCが混雑していても捨てない。

検査用 iframe から親 DOM と試験用ネイティブコマンドに届かないことをスモークで確認する。
一般の HTML ウィジェットと MCP Apps は引き続き静的表示。任意のスクリプトを有効にする前に、
実アプリの CSP と MCP Apps の初期化・通知・権限処理を別途実装する。
