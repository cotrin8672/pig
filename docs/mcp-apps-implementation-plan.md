# MCP Apps：静的プレビューの実装計画

状態：最小構成の静的プレビューを実装済み。動的MCP Appsホストは対象外
（Electrobunの隔離問題が解消し、実機検証を通してから着手する）。

### 実装した範囲（最小構成）

- SDK 1.5.2へ依存パッチ（`patches/`）で `onToolResult` を追加。UIメタデータを
  モデル出力へ混ぜず、実行した既存のMCP接続からだけHTMLを読む。
- `bun/mcp-apps.ts`：セッションごとの遅延取得。同時2件・待機32件・5秒上限・1MiB上限、
  同じ呼び出しの取得と静的化を共有する。再接続・reload・close後の古い参照は読めない。
- `bun/mcp-app-static.ts`：許可リストでHTML/CSS/SVGだけを残し、script・フォーム・
  ナビゲーション・iframe・画像・外部URLを除去する。要素数・深さ・CSS量も制限する。
- `getMcpAppPreview` RPC：起動中セッションの呼び出しについて静的化済みHTMLだけを返す。
  失敗時は `null` で、通常のツール結果だけが表示される。
- `ToolBlock` の下に共通 `WidgetFrame` で併設表示（8行・枠内スクロール、iframeは全体で8個）。
  MCP表示はグローバルなscript許可と独立して常に `sandbox=""`・静的CSP。
  フロント側は直近32件のHTMLを再利用する。

### 意図的に対象外にしたもの

- 保存と履歴での再表示（アプリ再起動・休止後の会話では通常結果だけ）
- 画像（すべて除去）
- codemode経由の呼び出しのプレビュー（ツール行に表示されないため）
- 取得キャンセルRPC（5秒上限と取得共有で代替）

以下の章は当初の調査・計画の記録であり、上記で削った項目を含む。

## 1. 方針と対応範囲

まず **MCP AppsのUIリソースの静的プレビュー** を実装する。
Electrobunの隔離問題が解消した後、別フェーズで動的なMCP Appsホストへ拡張する。

ここでいう静的表示は「サーバーから受け取ったHTML/CSSのうち、安全に表示できる部分」であり、
**JavaScript実行後の画面のスクリーンショットではない**。
MCP AppsのHTMLは通常、JSで初期化し、ホストからツール引数・結果を受け取って描画する。
JS前提のアプリは空のルート要素・ローディング表示だけになる場合がある。
静的HTMLが、その呼び出しの結果を反映しているとも保証しない。

### 今回実装するもの

- Pi SDK組み込みMCPを第一対象に、ツールに関連付けられた `ui://` リソースを取得する。
- MIME型 `text/html;profile=mcp-app` のHTMLから安全な静的表示を作る。
- ツール結果にプレビューを併設する。既存のテキスト・画像・エラー表示を置き換えない。
- 「静的プレビュー（スクリプト・外部通信なし）」と分かる表示にする。
- 取得済みプレビューを保存し、履歴ではMCPやSDKを起動せずに再表示する。
- 取得・保存・転送・描画・キャッシュに上限を設ける。

### 今回は実装しないもの

- `ui/initialize`、ツール結果のアプリへの通知、`ui/message`、アプリからのツール実行。
- JavaScript、外部CSS・画像・フォント、ネストしたiframe、フォーム送信、外部リンク操作。
- JSを別プロセスやヘッドレスブラウザで実行して静止画化する代替策。
- OpenAI固有API、旧メタデータ形式、すべてのサードパーティMCP拡張への個別対応。
- `show_widget` の提供・スキルの自動読み込み。既存Visualizeとは別の入口として扱う。

静的表示だけの間は完全なMCP Apps対応を名乗らず、
`io.modelcontextprotocol/ui` の対応能力も無条件に宣言しない。
対応宣言がないとUIメタデータを返さないサーバーは、この段階では通常のツール結果だけ表示する。
初期化を偽装してアプリを取得することはしない。

## 2. 調査結果

### 既存実装で再利用できるもの

| 箇所 | 確認できた内容 |
| --- | --- |
| `src/shared/widget.ts` | HTML/SVG断片、タイトル、幅、スクリプトらしき内容の判定。MCP用の出自・リソース情報はまだない |
| `src/mainview/WidgetFrame.tsx` | 画面付近400pxでiframeを生成、画面外で破棄、全体で最大8個。ストリーミング時は250ms間隔 |
| `src/mainview/widget-frame.ts` | 静的CSP、テーマ変数、`sandbox=""`、隔離の自己検査。`widgetScriptPolicy.requested` は `false` |
| `src/mainview/ToolBlock.tsx` | 現在は `show_widget` / `visualize:show_widget` の引数だけがウィジェット入口 |
| `src/bun/session-host.ts` | 共有イベントバス、組み込み拡張の差し込み、session/epochによる寿命管理 |
| `src/bun/adapter-source.ts` | ツール実行イベントと `toolCallId` / `parentToolCallId` の追跡 |
| `src/bun/transcript-wire.ts` | RPCでツール結果の重複を省く処理。HTML本体をここへ追加すると比較・転送コストが増える |
| `src/bun/attachments.ts` | SHA-256による不変のコンテンツ保存。保存処理を再利用できるが、画像専用preview APIは流用しない |
| `src/shared/runtime-contract.ts` | `SessionAddress`、epoch、履歴専用open、close/suspendの既存契約 |

表内の `src/` は `apps/desktop/src/`。
`details.widget` はVisualize設計書にはあるが、現行コードで汎用描画入口として実装済みとは扱わない。

### フロントだけでは実装できない

現在の依存は `@earendil-works/pi-coding-agent@1.5.2`。以下は標準配布版の調査結果。
不足する連携口は上記の依存パッチで補っている。

- `dist/extensions/mcp/tools.js` の `createMcpToolDefinition()` は、
  元のMCPツールの `_meta.ui` をPiツール定義へ引き継がない。
- `convertMcpResult()` は結果の `_meta` を除外し、`details` には主にserver/toolを残す。
  後段の `tool_result` フックだけでは、失われたメタデータを復元できない。
- `McpServerConnection` は `readResource()` を持つが、接続を所有する組み込み拡張の内部にある。
  確認した `McpExtensionOptions` には、UIメタデータの通知・共有接続でのUI取得用フックはない。
- 通常の `read_mcp_resource` はモデル向けツールであり、HTMLを会話へ流し込むための迂回路には使わない。

**最初の実装ゲートはSDK側の小さな公開連携口**。
ツール定義のUIメタデータ・実行の識別子をホストへ渡し、同じ接続・認証・信頼設定で
UIリソースを読めるようにする。privateフィールドの参照や別MCPクライアントの二重接続は避ける。
既存SDKが足りなければ上流変更を優先し、先行導入が必要な場合だけ再現可能な依存パッチを検討する。
`node_modules` の直接編集を実装手段にしない。

`pi-mcp-adapter` の公開資料も調査したが、本リポジトリの直接依存ではない。
組み込みMCPと混同せず、同じ連携契約へ接続できる場合だけ後から対応する。
未対応拡張でも既存のツール結果表示は維持する。

### 性能面の既存の注意点

1. `WidgetFrame` は画面外・サイズ超過でも `srcDoc` の組み立てとテーマ取得を行う。
   iframe数の制限だけでは、HTML文字列の複製・保持を制限できない。
2. 高さを保持するモジュール全体の `Map` に件数上限がない。
3. `WIDGET_MAX_BYTES` は1MiBだが、描画側の比較は `source.length`。
   UTF-8バイト数ではなく、日本語や絵文字で想定とずれる。組み立て前に検証する必要がある。
4. ウィジェットのIDは短い非暗号学的ハッシュ。永続化や権限確認のキーには流用しない。
5. MCPリソースはHTML断片ではなく完全なHTML文書の場合がある。
   既存の本文連結へそのまま渡すと、文書構造・CSP・ナビゲーションの扱いが不明確になる。
6. ツールイベントごとに全履歴を走査したり、HTMLをsnapshotに載せたりすると、
   現行のイベント集約・差分転送の利点を失う。

既存の `widget-frame.test.ts` / `widget-ui.test.ts` を実行し、3件成功。
静的sandbox、通常Chromiumでの隔離確認、iframe最大8個を確認するテストは通った。
これは性能ベンチマークでも、Windows実機WebView2の隔離確認でもない。

## 3. データ経路

```text
既存Pi MCP接続
  ├─ ツールのUIメタデータ → 呼び出しごとの軽量な参照
  └─ 対象が表示範囲に入ったときだけ resources/read
          ↓
Bun：検証・静的HTML化・サイズ検査
          ↓
専用プレビュー保存領域（内容ハッシュ）＋呼び出しとの対応
          ↓
RPC：参照・状態だけ / 表示対象のHTMLを個別取得
          ↓
既存WidgetFrame：固定の静的ポリシーで描画
```

### 呼び出しと所有者

- server名だけでなく、プロジェクト・セッション・接続世代・元のMCP tool名を追跡する。
- 紐付けは `toolCallId` を基本に、保存後のentry ID、分岐、epochとの対応を維持する。
  codemodeの子ツールも対象とし、親の結果や別サーバーの同名ツールと混ぜない。
- `_meta.ui.resourceUri` は原則ツール定義由来。結果側のURI上書きなどは、
  採用する仕様版で定義された場合に限り対応し、独自に推測しない。
- frontendはURI・サーバー名・ローカルパスを自由指定して読めない。
  RPCは「このセッションの、このツール呼び出しのプレビュー」を要求し、Bunが所有権を確認する。

### 取得タイミングとキャンセル

- ツール結果の完了を待ち合わせで遅らせない。ツール処理とプレビュー取得は別の非同期処理。
- 初版はツール完了後、表示範囲付近の対象だけ取得する。全サーバーのresource一覧取得は禁止。
- `resources/read` は既存接続で実施し、認証・承認・信頼ポリシーを迂回しない。
  接続や認証が使えなければ通常出力に戻り、プレビュー目的だけで認証画面を自動表示しない。
- 同一呼び出しの重複要求はsingle-flightにする。URIが同じだけで別呼び出しへ永続キャッシュを使い回さない。
  同じURIの内容が変わり得るため、別呼び出しの共有は同じ版と確認できる場合に限る。
- close / reload / epoch変更でキャンセルし、遅れて届く結果は破棄する。
  画面外へ出た要求は購読数で管理し、他の表示先が利用中の共有要求を中断しない。
- 失敗時の無限リトライ・ポーリングはしない。明示再試行または新しい呼び出しを契機にする。

### 保存・履歴

- 生HTMLをモデル向け `content`、通常の `details`、毎回のsnapshotへ入れない。
  会話には軽量参照だけを保持し、プレビュー本文は別に保存する。
- 内容ハッシュで保存し、SDKの既存ツール結果を後から書き換えない。
  当初案は添付ファイルとsidecarの再利用だったが、実装では既存のBun SQLiteを使い、
  本文・対応・容量制限・削除を一つのtransactionで扱う。通常表示でファイル群を探索しない。
- 保存対象は静的化したHTMLと最小限の出自・ポリシー版。認証情報、結果全体の `_meta`、
  将来用の生HTMLやアプリ状態を無条件に保存しない。
- 履歴専用openでは保存済みデータだけを読み、MCP接続・SDK起動・再取得をしない。
  画面外のまま一度も取得されなかった呼び出し、キャッシュ削除済み、インポート履歴は通常出力へ戻す。
- 分岐を跨いで表示を混ぜない。履歴削除・保存上限による削除では本文と対応情報の整合を保つ。
  cache missは正常系とし、会話そのものを壊さない。

## 4. 静的表示の安全性

MCPサーバーのHTMLも信頼しない。`interactive` の正規表現は案内用であり、安全性の判定には使わない。

1. リソースURI・MIME・内容型・UTF-8サイズ・レスポンス全体の上限を検証する。
   初版はHTML textを対象にし、blobや異なるMIMEは通常出力へフォールバックする。
   対象URIと無関係なcontentsを結合しない。
2. 完全なHTML文書をパーサーで扱い、安全な本文とstyleだけを固定のホスト文書へ移す。
   HTMLを正規表現だけでサニタイズしない。既存HTMLパーサーを再利用できるか小さな検証で決める。
3. 要素・属性・URLの許可リストを使う。script、イベント属性、meta refresh、base、iframe、
   object/embed、フォーム・ナビゲーション機能を除去する。
   SVG、`foreignObject`、data URL内の文書などによる迂回も検査する。
4. iframeは常に `sandbox=""`。MCP静的プレビューは既存のグローバルなscript許可フラグだけでは
   動的表示へ切り替わらない明示的なポリシーにする。
5. ホスト側CSPでscript・connect・frame・object・formを禁止し、外部読込を許可しない。
   リソースの `_meta.ui.csp` は権限の要求であり、静的モードで許可を広げる根拠にはしない。
6. 既存WebView2の制約下でも、リソース自身のmeta/CSP/ナビゲーションで制限を逃れられないことを実描画で確認する。
   Bunの認証情報・RPC鍵はiframeへ一切渡さない。

ネットワーク・JSを止めても巨大DOMやCSSによる描画負荷は残る。
入力バイト上限に加え、DOMノード数・深さ等の制限を悪意あるfixtureで決める。
安全性を確認できない内容は表示しない。

## 5. 性能設計と予算

以下は**実装時の初期値・検証目標であり、実測性能ではない**。
設定項目は増やさず、まず内部定数で開始する。

| 対象 | 初期方針 |
| --- | --- |
| HTML | 入力・静的化後それぞれUTF-8で1MiB以下。レスポンス全体にも上限を設け、複数contentsで迂回させない |
| MCP取得 | ホスト全体で同時2件、画面付近の未処理要求だけを保持。各要求5秒を初期上限に検証 |
| iframe | 既存の全体上限8個を共有。MCP用に別の8個枠を増やさない |
| frontend本文キャッシュ | 合計8MiBを初期予算とする。iframe内DOM・srcDoc複製のメモリは別途測定する |
| 高さキャッシュ | 256件程度の上限付きLRU。共通WidgetFrame側で対処 |
| ディスク | プレビュー専用領域全体256MiBを初期上限。古いものから削除し、欠損は通常出力へ戻す |
| 履歴・snapshot | HTML本文を0バイト追加。全履歴の再走査・HTML再ハッシュをストリーム更新に載せない |
| 通常会話 | MCP Appsがない会話ではプレビュー用RPC・resource取得・parser起動を0回にする |

具体的な修正：

- サイズ検査をHTML組み立てより前へ移す。byte length・hashは取得時に一度だけ算出する。
- `srcDoc` の生成と本文取得をlive slotに連動させ、画面外・上限超過では生成しない。
  再マウントでは上限付き本文キャッシュを利用し、MCPへの再取得はしない。
- 本文を受け取ったMCPプレビューはストリーミングしない。250msの書き換え経路に載せない。
- 同じ参照・同じテーマなら文書を再生成しない。テーマ変更時は表示中のフレームだけ更新する。
- 非同期完了の通知は対象のプレビューだけに届ける。会話全体のsnapshotを再送しない。
- キュー・本文キャッシュ・高さキャッシュを個別に上限管理する。
  iframeを減らしただけでメモリ対策完了としない。
- ディスク整理は保存時などにまとめ、トークン受信や履歴openごとに全ファイルを走査しない。
- サニタイズ時間を計測する。上限サイズでBunの応答を阻害する場合だけ、
  その処理を既存のworker運用に合わせて分離する。先に専用workerプールは作らない。

## 6. UIの置き方

- `ToolBlock` の既存ツール行・展開領域と `WidgetFrame` を再利用する。
  独自レンダラー・cardがあるツールでもプレビューを落とさない共通の併設位置を決める。
- 通常結果は残す。プレビューの成否でツール実行そのものを失敗扱いにしない。
- 静的モードの説明、取得中・失敗・容量超過・未保存の状態はツール領域内に置く。
  必要なエラー通知には既存通知UIを使い、Composerの下には何も追加しない。
- 枠の左右・プレビュー約8行＋枠内スクロール・半透明の面・アイコン余白は共通ガイドに従う。
  既存widgetの高さ仕様と異なる点は、共通コンポーネントの表示モードとして明示する。
- 表示対象外から戻る際は保存した表示高を使い、不要なスクロールジャンプを防ぐ。
- JSの有無だけで「正常に表示できた」と判定しない。
  JS依存の初期画面しか出ない場合でも、静的プレビューという制限と通常結果が常に分かるようにする。

## 7. 実装順序と完了条件

### Phase 0：接続経路の検証（最初のゲート）

小さいローカルMCP fixtureを用意し、組み込みMCPで以下を確認する。

- `_meta.ui.resourceUri` を失わずホストへ届けられる。
- 同じ認証済み接続で `resources/read` できる。接続数・stdioプロセス数が増えない。
- direct / deferred / codemodeの呼び出しを正しいtoolCall IDへ対応付けられる。
- UI対応宣言なしで返る静的リソースと、宣言を必須にするサーバーの差を確認する。

公開連携口が不足したら、この段階で必要なSDK変更を確定する。
二重接続やモデル経由のresource取得で無理に先へ進めない。

### Phase 1：ホスト側の取得・保存

実装箇所：`shared/mcp-app.ts`、`bun/mcp-apps.ts`、`bun/mcp-app-static.ts`、`bun/mcp-app-store.ts`。
型・接続連携・保存の責務を分けるが、汎用プラグイン基盤は作らない。

- 最小のUI参照、取得状態、RPC契約、セッション所有権。
- 制限付き取得、キャンセル、検証、静的化、single-flight。
- 内容保存・対応情報・履歴専用読込・容量管理。
- `session-host.ts` / `rpc-schema.ts` / RPC登録箇所のライフサイクルへ接続。

完了条件：プレビューが遅い・失敗する・閉じられる場合でも、通常のツール結果とセッション操作が正常。

### Phase 2：描画と共通性能修正

- `WidgetFrame.tsx` / `widget-frame.ts` / `shared/widget.ts` の共通処理を再利用・拡張。
- 画面外の文書生成停止、byte上限、高さキャッシュの上限、明示的な静的ポリシー。
- `ToolBlock.tsx` の共通併設位置、状態表示、i18n、必要最小限の共通CSS。
- MCP本文は必要なときだけRPC取得。iframe枠数は既存Visualizeと共有。

完了条件：静的HTMLが表示され、JS・外部通信は動かず、通常のツール結果は常に読める。

### Phase 3：回帰・性能・実機検証

機能fixture：

- 静的HTML/SVG、完全HTML文書、JSのみのアプリ、外部asset依存のアプリ。
- 不正URI/MIME、空の内容、複数contents、UTF-8で上限を超える日本語・絵文字。
- script、イベント属性、meta refresh、リンク・フォーム、iframe、SVG等の攻撃ケース。
- timeout、認証切れ、接続切断、取得中のclose/reload/分岐切替、保存失敗。
- キャッシュあり・なしの履歴、削除、複数Pane、同名server、codemode子ツール。
- 既存VisualizeとMCPプレビューの混在、独自レンダラーがあるツール。

性能fixture：

| ケース | 測るもの・合格条件 |
| --- | --- |
| 通常の会話 | Appsなしで追加取得0回。既存のopen/送信/ストリーム処理を同条件で比較 |
| 長い履歴に100個のプレビュー | iframe最大8個、取得同時2件、本文キャッシュが予算内。画面外の本文一括転送なし |
| 同じ表示を20回往復 | 同一呼び出しの追加MCP取得0回。キャッシュ・listener・Observerが増え続けない |
| 新規リソースを連続表示 | キュー・メモリ・ディスクが上限で頭打ちになる |
| 16KiB / 256KiB / 1MiB | 検証・サニタイズ・保存・RPC・srcDoc生成・初回描画を分けて計測 |
| 100件のストリーム更新 | HTML再送・再解析0回。既存のpublish集約と完了イベント即時反映を維持 |
| 履歴専用open | MCP接続・resource取得0回。保存済みプレビューだけ表示 |
| close/reloadを20回 | 処理待ち・listener・session参照が残留しない |

Wall timeのp50/p95、RPC総bytes、resource読込回数、iframe数、Bun/WebView2双方のメモリを記録する。
同じfixtureで変更前後を比較し、ネットワーク待ちとローカル処理を混ぜない。
通常会話のp95で継続的に10%以上悪化したら原因を調べてから採用する。
スクロール中の新規50ms超long taskを検出し、8フレームでも重ければ上限を下げて再計測する。
メモリは総プロセス値だけでなく、反復操作後の増え続ける傾向を確認する。
これらは測定計画であり、現時点の性能保証値ではない。

検証コマンド：`mise exec -- pnpm typecheck`、`mise exec -- pnpm lint`、
対象単体テスト、`mise exec -- pnpm test:ui`。
通常Chromiumの描画fixtureに加え、Windows WebView2でも隔離・外部通信禁止・スクロール・メモリを確認する。
開発アプリが起動中なら二重起動せず、実機起動には `mise run dev` を使う。

## 8. Electrobun更新後の動的対応

更新しただけで `widgetScriptPolicy.requested = true` にしない。
以下を満たしたときに、独立した実装計画を開始する。

1. 対象バージョンで `--disable-web-security` を外せることを実機で確認する。
2. sandboxから親DOM・RPC鍵・ネイティブbridgeへ到達できない自己検査と攻撃fixtureが通る。
3. 検査失敗時は静的表示へ戻す。スクリプト実行を自動で強行しない。
4. MCP Appsの能力交渉、初期化、引数・結果通知、テーマ・サイズ通知を仕様に沿って実装する。
5. `ui/message`、ツール呼び出し、外部通信、リンク操作は権限・ユーザー確認・キャンセルを設計してから許可する。
6. 静的キャッシュをそのまま実行しない。動的表示では適切な接続・ポリシーでリソースを再取得する。

この段階で `@modelcontextprotocol/ext-apps` のホスト側APIを再評価する。
静的フェーズには、使わない動的SDKや常設ローカルWebサーバーを先に追加しない。

## 9. 根拠と未確認事項

- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)
- [MCP Apps specification（2026-01-26）](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP Apps CSP and CORS](https://apps.extensions.modelcontextprotocol.io/api/documents/csp-and-cors.html)
- [pi-mcp-adapter Extension API](https://github.com/nicobailon/pi-mcp-adapter/blob/main/docs/extension-api.md)
- [Electrobun #611](https://github.com/blackboardsh/electrobun/issues/611)
- [既存Visualize設計](visualize-design.md)
- [UI共通ルール](ui-guidelines.md)
- ローカルのPi SDK 1.5.2の `extensions/mcp/{index,runtime,tools}.{js,d.ts}`。

Web調査時点の #611 はopen。更新時期や、特定リリースでの修正を前提にしない。
ローカルHTTP MCP fixtureでのSDK連携検証は実施済み。
外部サービスのMCPサーバーへの接続、実際の巨大な履歴での入力遅延・プロセスメモリの測定、
Windows実機WebView2での今回の再検証はまだ行っていない。

Phase 0当時の検証：`pnpm typecheck` / `pnpm lint` / `pnpm test`（1,181件）が成功。
別途MCP SDK統合テストと、SDK起動・再読み込み・休止・配信集約・runtime配布資材の対象テストも成功。
LSPは利用できなかったため、型検証はプロジェクトのtypecheckで行った。
