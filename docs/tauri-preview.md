# Tauri / WebView2 移行プレビュー

Electrobun の `pnpm dev`・配布・更新はまだ変更しない。まず Tauri 2 の実ウィンドウで既存の
`WindowTitlebar` と透過スタイルを使い、Bun の別プロセスと sandbox iframe が機能するかを検証する。

## 起動・検証

Windows の WebView2、Rust（MSVC ターゲット）、Visual Studio C++ Build Tools と Windows
SDK、開発用の Bun・Node・pnpm が必要。Rust と Node は PATH に通す（mise を使う場合は下記）。

```powershell
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm --filter @pig/desktop tauri:preview
mise exec -- pnpm --filter @pig/desktop tauri:preview --smoke
```

`--smoke` は実際の WebView2 を起動して以下を確認し、終了コードを返す。
ウィンドウを最大化・最小化して戻すので、実行中は試験ウィンドウに触れない。

- Tauri から別プロセスの Bun に届き、既存の Pi SDK を読み込んで応答する。
- `sandbox="allow-scripts"` の固定 iframe でボタンの JavaScript が動く一方、
  親 DOM は参照できず、iframe の試験用コマンドが Rust 側のハンドラーに届かない。
  WebView2 上では iframe 内にも Tauri の API オブジェクトが見えるため、オブジェクトの有無だけでは判定しない。
  固定スクリプトだけを CSP のハッシュで許可する。
- 実ウィンドウが最大化／復元と最小化／復元の各状態へ遷移する。

通常起動では、既存のホバー式タイトルバーと背景設定（透過・Acrylic・Mica・不透明度）を
Electrobun 版と手動比較できる。タイトルバーとサイドバー見出しでのドラッグ、
Snap（特に最大化ボタン上の Snap Layouts）、自動非表示タスクバー、異なる DPI の画面間移動、
フォーカス／IME、最大化中の白フラッシュや透過画素はこのスモークの対象外。

## 移行の次段階

この版の Bun プロセスは互換性確認だけを行う。ウィンドウのプロファイルは別で、既存の
Pi セッション・認証・拡張を読み込まない。WebView に shell 権限や待ち受けポートも渡さない。
次は既存の型付き RPC を、Rust が所有する Bun 常駐プロセスへの IPC に接続し、実セッションを
扱えるようにする。動的 MCP Apps は隔離だけでは動かないので、初期化・通知・権限境界は別途実装する。
