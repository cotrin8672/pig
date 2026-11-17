# 会話内ビジュアル（Visualize）の設計

会話の中にHTML/SVGの可視化（図・グラフ・操作できる説明）を描画する。

MCP Appsの段階的な対応は [静的プレビューの実装計画](mcp-apps-implementation-plan.md) を参照。
まずスクリプトなしの表示を扱い、動的ホスト対応はElectrobunの隔離問題解消後に進める。

## 現在の方針と実装状況

- **当面はスクリプトなし（`sandbox=""`）の静的表示だけ**。DLLの置換はしない。
  Electrobunの [#611](https://github.com/blackboardsh/electrobun/issues/611)（`--disable-web-security` を外せるようにする要望、PRなし）が
  直ったら、`widget-frame.ts` の `widgetScriptPolicy.requested` を `true` にする。
  その後も起動中に1回、`sandbox="allow-scripts"` のiframeから親の `document` が見えないことを確認し（`widgetIsolation()`）、
  見える環境では静的表示のままになる。
- 実装済み：
  - `shared/widget.ts`：`WidgetBlock` と `show_widget` / `visualize:show_widget` の引数からの変換。
  - `mainview/widget-frame.ts`：フレーム文書（CSP・テーマ変数・スクリプト時だけ高さ通知ランタイム）、隔離の自己検査、高さの計測。
  - `mainview/WidgetFrame.tsx`：画面付近でだけ生成、同時に8つまで、最後の高さを記憶、ストリーミング中は250msごとに反映。
  - `ToolBlock.tsx`：`show_widget` のツール呼び出しを「ビジュアル」行＋フレームで表示。
- 静的表示の高さは親から `contentDocument` を測る。今のWebView2では測れるが、通常のChromium（テストのEdge）では
  測れず既定の240px＋枠内スクロールになる。スクリプトを有効にした後はランタイムが高さを報告する。
- スキル：`apps/desktop/skills/visualize/SKILL.md`（piris独自の文面）。まだどこからも読み込んでいない。
  現状の描画に合わせ、スクリプトなし・通信なしで成立するマークアップを書かせる。スクリプトを有効にしたら「How it is rendered」を更新する。
- 未実装：`show_widget` ツールの提供方法（組み込みにするかも未定）とスキルの読み込み、高さ・状態のセッション保存、
  `ui/message` ブリッジと確認、インポート変換、MCP Apps。

以下は検討の記録。「実装方針 0.（DLLの置換）」は採用しなかった。

## 背景：各社の方式

共通規格はない。共通なのは「HTML断片を隔離して描画する」部分だけ。

| 方式 | 呼び出し | HTMLの渡し方 | ホスト側の前提 |
| --- | --- | --- | --- |
| MCP Apps（SEP-1865、2026-01-26 Stable） | ツールの `_meta.ui.resourceUri`（`ui://`） | ホストがリソースを取得 | `ui/*` JSON-RPC over `postMessage` |
| Claude（Custom visuals） | `visualize:show_widget` ツール | 引数 `widget_code`（`<svg` で始まればSVG） | Claude独自CSS・`read_me` の指示書。非公式の解析ではMCP App（`ui://imagine/show-widget.html`）上で動く |
| ChatGPT / Codex（Visualizeスキル） | 最終回答本文の `visualize{"path":"…","mode":"wide"}` | 書き出したHTML断片ファイル | `.card`/`.viz-*`等のCSS、テーマ変数、`lucide`、タブ・`data-tooltip`、CDN許可リストのCSP、`window.openai`（`widgetState`・`sendFollowUpMessage`） |
| Pi拡張 | 拡張ごとに別（`pi-generative-ui` は別ウィンドウ、`@thinkrail/pi-visualize` はMermaid/ファイルパス、`@jademind/pi-visual` はPNG） | — | — |

### 決定

- **HTML可視化とMCP Appsは別機能**。描画層とメッセージ形式だけ共通にし、MCP Appsは後でホスト側で対応する。
- **Pi拡張の個別対応はしない**。入口として「ツール結果の `details.widget` に入っていれば描画する」取り決めだけ残す。
- **表示は常にオン、生成（組み込みスキル・ツール）はデフォルトでオフ**。

## 検証で分かった制約（Electrobun 2.0.6 / Windows WebView2）

開発ビルドを一時フォルダーに複製し、`bun/index.js` を検証用のものに差し替えて実機のWebView2で確認した。

### メインWebViewは `--disable-web-security` で動いている

`libNativeWrapper.dll` がWebView2に固定で渡す引数：
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --allow-insecure-localhost --disable-web-security`。
`chromiumFlags` はCEF専用で、WebView2では変えられない。`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` でも結果は変わらなかった。

その結果、**`sandbox="allow-scripts"` のiframeはメインWebViewから隔離されない**：

| 確認項目（iframe内のスクリプトから） | 結果 |
| --- | --- |
| `self.origin` / `localStorage` | `"null"` / SecurityError（sandbox自体は効いている） |
| `parent.document` | **読める** |
| `parent.__electrobunSecretKeyBytes` | **読める（32バイト）** |
| `parent.__electrobunSendToHost` / `parent.__electrobun` | **関数・オブジェクトとして見える** |
| CSPの `connect-src 'none'` による `fetch` | ブロックされる |
| `views://` からのシェル・スクリプト読み込み、CDNの読み込み | どちらも動く（`src=views://…`・`srcdoc` とも） |

モデルが書いたスクリプトがpirisのRPC（Bun側の全機能）に届くので、**このままではスクリプトを動かすウィジェットを
メインWebView内のiframeに置けない**。CSPはDOMアクセスを防げない（対処は下記「外すと…」）。

### スクリプトなしのiframe（`sandbox=""`）は安全に使える

- スクリプトは実行されない（ブラウザが強制。サニタイズに頼らない）。
- 外部読み込みは `srcdoc` 内のCSP `<meta>`（`default-src 'none'; style-src 'unsafe-inline'; img-src data:`）で止まる。
- 高さは親から `contentDocument` を読んで測れた（`--disable-web-security` があるため。下記「将来」参照）。
- メモリはEdge 157での計測で1つあたり約7〜10MB、rendererプロセスは増えない（sandbox iframeはまとめて1プロセス）。

| iframe数 | 0 | 10 | 30 | 60 |
| --- | --- | --- | --- | --- |
| Private Memory | 566MB | 586MB | 733MB | 1,036MB |

### `<electrobun-webview sandbox>` は隔離されるが重い

- 別の最上位WebViewになる：`window.top === window`、秘密鍵・RPCなし（イベント送信だけの橋 `__electrobunSendToHost`）。
  originは `views://<host>`、`localStorage` は使える（同じhostのウィジェット間で共有される）。
- 計測（WebView2プロセス群のPrivate Memory合計）：0個 181MB → 1個 575MB → 4個 1,229MB → 8個 1,299MB。
  最初の1個で別のWebView2プロセス群（約5プロセス）が立ち上がり、その後も1つごとにrendererが増える。
  揺れは大きいが、iframeより1桁以上重い。**同時に1つだけ**なら許容できる。
- ネイティブのビューをDOMの上に重ねる方式なので、スクロール追従・メニューとの重なり（`addMaskSelector`）を試作で確認する。

独自プロトコル（`piris-widget://`）は作れない。ビュー向けのスキームは `views://` と `appData` だけ。

### `--disable-web-security` を外すとiframeで隔離できる（採用）

引数は上流の `package/src/native/win/nativeWrapper.cpp` で `put_AdditionalBrowserArguments` に固定。
`libNativeWrapper.dll` 内にUTF-16で1箇所だけあり、` --disable-web-security` を同じ長さの空白に置き換えて検証した：

| 確認項目 | 元のDLL | 置換後 |
| --- | --- | --- |
| `allow-scripts` iframe → `parent.document` | 読める | **SecurityError** |
| `allow-scripts` iframe → `parent.__electrobunSecretKeyBytes` | 読める | **SecurityError** |
| `views://` からのシェル・スクリプト読み込み | 動く | 動く |
| `sandbox=""` iframeの高さを親から測る | 測れる | 測れない（正しい挙動） |
| piris本体（開発ビルドを複製してDLLだけ差替） | — | 起動・セッション一覧・使用量・本文・KaTeX・workerが正常 |

- `mainview` は外部への `fetch` をしておらず（通信はBun側）、`--disable-web-security` に依存している箇所は見つからない。
  RPCはWebSocketなのでCORSの影響を受けない。
- この引数はウィジェットと無関係に、会話画面で万一スクリプトが混入したときの被害も広げている。外すこと自体に価値がある。

### 検討した他の案

| 案 | 評価 |
| --- | --- |
| **DLLの引数をビルド時に置換（採用）** | 小さく確実。上流が変われば検出できるようにする（下記） |
| 上流に設定項目を追加してもらう | 本筋。PRを出し、取り込まれたら置換をやめる |
| Electrobunを自前でビルド | ネイティブのビルド環境を抱える。置換より重い |
| CEFを同梱（`chromiumFlags` で外せる） | アプリ全体の描画基盤が変わり、配布サイズも大きく増える |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | 引数は追加されるだけで、既存のスイッチは打ち消せない |
| スクリプトなしiframe＋操作時だけ `<electrobun-webview sandbox>` | 安全だが、操作できる表示が同時に1つで重い。ネイティブの重ね合わせ問題もある。置換が使えなくなった場合の代替 |
| 別ウィンドウで表示 | 会話内表示ではなくなる |
| HTMLのサニタイズだけで本体のDOMに入れる | サニタイザーの不具合がそのままRPCへの到達になる。不採用 |

## 実装方針

### 0. 前提：`--disable-web-security` を外す

- `scripts/post-build.ts`（Windows）で `bin/libNativeWrapper.dll` のUTF-16文字列 ` --disable-web-security` を
  同じ長さの空白に置換する。**ちょうど1箇所見つからなければビルドを失敗させる**（Electrobun更新時に黙って効かなくなるのを防ぐ）。
- 起動時の自己検査：開発ビルドでは、隠しiframeから `parent.document` が読めないことを確認し、読めたらウィジェットの
  スクリプト実行を無効にする（静的表示だけに落とす）。本番でも同じ判定で安全側に倒す。
- 上流へ設定項目のPRを出す。取り込まれたら置換をやめる。
- macOS/Linux（WKWebView/WebKitGTK）はこの引数を使っていないが、対応時に同じ自己検査で確認する。

### 描画：`sandbox="allow-scripts"` iframe

```
入力アダプタ（取り込み時に1回）     正規形          描画
piris show_widget ───────┐
Claude show_widget ───────┼→ WidgetBlock ─→ WidgetFrame（sandbox="allow-scripts" iframe）
Codex visualize参照 ──────┤                   ├ base ランタイム
details.widget（拡張）───┘                   └ 互換プロファイル（openai / claude）
```

- iframeは固定シェル `views://mainview/widget-frame.html`（検証済み）。本文は `postMessage` で渡す。
  `allow-same-origin` は付けない。
- シェルのCSP：`script-src`/`style-src` は `views:` とCDN許可リスト、`connect-src 'none'`、`img-src data: views:`。
- ランタイム（base）：テーマ変数、`ResizeObserver` → 高さ通知、ストリーミング中は差分更新（morphdom相当）し
  スクリプトは完了時に1回だけ実行。互換プロファイルは `profile` に応じて追加で読む固定ファイル。
- ブリッジはMCP Appsの `ui/*` の一部（初期化・テーマ・サイズ・`ui/message`・状態保存）。`window.openai` はshimで変換。
  親側は `event.source` が自分のiframeかを確かめ、形を検証してから処理する。
- `ui/message` は送信前に確認（送られる本文を表示。既存のダイアログ／通知UI、Composerの下には出さない）。
  確認中の追加分とターン実行中のものは破棄し、ウィジェットにエラーを返す。
- 負荷：画面に入ってから生成、同時に存在するiframeは初期値8（1つ約7〜10MB、rendererは増えない）。
  破棄時は高さと状態を保持し、再生成でレイアウトを動かさない。

### 正規形 `WidgetBlock`

```ts
type WidgetBlock = {
  id: string;                    // 本文のハッシュ
  format: "html" | "svg";
  source: string;                // 取り込み時にコピーした本文
  title?: string;
  width: "regular" | "wide";
  origin: "piris" | "claude" | "codex" | "extension";
  profile: "base" | "openai" | "claude";
  interactive: boolean;          // <script> を含むか（自己検査で静的表示に落ちたときの案内に使う）
  height?: number;               // 最後に測った高さ
  anchor?: number;               // インポート時：本文中の参照行の位置
};
```

### 保存場所：Piセッションの `CustomEntry`

`CustomEntry`（`appendCustomEntry`）はLLMのコンテキストに入らない。pirisは既に `desktop.import`・`pig.rewind` で使い、
`sdk-projector.ts` から描画側へ流す経路もある。別ストアは作らない（フォーク・巻き戻しがそのまま効く）。

| 入力 | 本文 | 状態・高さ |
| --- | --- | --- |
| 組み込み `show_widget` | ツール引数がそのまま正 | `piris.widget-state`（`toolCallId` をキー、最後のものを採用） |
| インポート | `piris.widget` に `WidgetBlock` を入れ、該当assistantメッセージの直後に置く | 同上（`WidgetBlock.id` をキー） |

`widget_code` はツール引数なので以降のターンもモデルのコンテキストに残る（Claudeも同じ）。スキルで数十KBを目安に指示する。

### 生成：組み込みの Visualize（デフォルトオフ）

- 組み込み拡張として `show_widget({ title, widget_code, mode? })` と `visualize` スキルを同梱
  （`bun/resources.ts` の `additionalExtensionPaths` / `additionalSkillPaths`）。
- 設定は1項目。オフの間はツールを登録しない。スキルはpiris独自に書く（各社の本文は流用しない）。
- スキルでは、表はMarkdown、静的な構造はMermaid、それ以外をウィジェットにするよう指示する。
  スクリプトなしでも意味が通る形（SVG・HTML＋CSSを土台にし、操作だけスクリプト）を優先させる。

### インポート

- Codex：assistant本文の `visualize{…}` 行を検出し、参照先ファイルを読んで `WidgetBlock`（`profile: openai`）を作る。
  ファイルが無ければ元の行をテキストのまま残す。ChatGPT/claude.aiの公式エクスポートは含まれるか要確認。
- 変換したブロックは表示専用。モデル向けには元のテキストを残す。
- 互換プロファイル（openai/claudeのCSSクラス・変数、`window.openai` のshim）はシェルが追加で読む固定ファイル。範囲は実際の量を見て決める。
  確認時点の端末では対象0件で、優先度は低い。

### UI

- ウィジェット面は透明・枠なし。周りのツール表示と左右を揃える。状態変化で周囲の高さを動かさない。
- 実装時に `docs/ui-guidelines.md` へ項目を追加し、`test:ui` に描画テストを足す。


## 代替案（置換が使えなくなった場合）：2段構え

```
入力アダプタ（取り込み時に1回）     正規形          描画
piris show_widget ───────┐                    ┌ 静的表示（既定）：sandbox="" iframe
Claude show_widget ───────┼→ WidgetBlock ──────┤   スクリプトなし・何個でも・軽い
Codex visualize参照 ──────┤                    └ 操作表示（クリックで起動）：
details.widget（拡張）───┘                        <electrobun-webview sandbox> を同時に1つ
```

### 1. 静的表示（既定）

- 会話内のすべてのウィジェットはまず静的表示。`sandbox=""` のiframeに `srcdoc` で入れる。
- `srcdoc` は「固定の外枠（CSP `<meta>`・テーマ変数・基本CSS）＋本文」。外枠の文字列は使い回し、本文は書き換えない。
- SVG、HTML＋CSS（`:hover`、CSSアニメーション、`<details>`）はそのまま見える。
  スクリプトで描くもの（canvas・Chart.js等）は空になるので、操作表示への切り替えボタンを出す。
  本文に `<script>` が含まれるかは取り込み時に判定して `WidgetBlock.interactive` に持つ。
- 高さは親から `contentDocument` を測る。初回の値を `WidgetBlock` 側に記録し、次回は最初からその高さで確保する。
- 画面に入ってから生成（`IntersectionObserver`）、遠くへ出たら破棄。上限は初期値8（軽いので余裕を持って調整）。
- ストリーミング中は200ms程度ごとに `srcdoc` を差し替える（スクリプトが動かないので差し替えで安全）。

### 2. 操作表示（クリックで起動）

- 静的表示の「操作する」で、その場所に `<electrobun-webview sandbox>` を1つだけ作る。別のウィジェットを起動したら前のものは静的表示に戻す。
- 中身は固定のシェル `views://widget/frame.html`（CSP：CDN許可リスト、`connect-src 'none'`）。本文はBun経由で渡す。
- `setNavigationRules` でシェル以外への移動を禁止（スクリプトから `location` を変えてCSPを抜けるのを防ぐ）。
- ウィジェット → ホストは、サンドボックスに残るイベントの橋だけを使う。メッセージ形式はMCP Appsの `ui/*` の一部
  （サイズ変更・`ui/message`・状態保存）に合わせる。`window.openai` のshimもこの形式に変換する。
- `ui/message` は**送信前に確認を出す**（送られる本文を表示。既存のダイアログ／通知UI、Composerの下には出さない）。
  確認中の追加分とターン実行中のものは破棄し、ウィジェットにエラーを返す。
  （MCP Apps仕様は「Host MAY request user consent」。CodexのVisualizeスキルも確認ダイアログを前提にしている）
- 試作で重なり・スクロール追従が実用にならなければ、操作表示は**別ウィンドウ**で開く方式に切り替える。

## 進める順番

1. `--disable-web-security` の置換（post-build・1箇所でなければ失敗）と自己検査。上流PR
2. `WidgetFrame`：シェル・baseランタイム・ブリッジ（サイズ・テーマ）・遅延生成と上限
3. 組み込み `show_widget` とスキル（デフォルトオフ）、`ui/message` の確認、状態保存
4. インポート（Codexアダプタ・互換プロファイル）
5. MCP Appsホスト対応（同じ `WidgetFrame` を使う。PiのMCP変換で `_meta` が落ちる問題の解決が前提）
