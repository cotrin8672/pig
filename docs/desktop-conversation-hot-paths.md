# 大きな会話の負荷：残る経路とUXを維持する修正案

以下の1〜5は調査・設計時点の記録。後続のDOM削減実装は[6節](#6-保存済み出力のdom削減実装)を参照。
その削減が主因対策として不十分だった点と追加実測は
[DOM・全文再解析の再調査](desktop-conversation-rendering-investigation.md)を参照。
その後の配信中にも適用するDOM削減本体と最終検証は、同文書の7節に記載した。
[これまでの調査](desktop-ui-stall-investigation.md)で未解決だった、会話DOMと
高頻度の会話データ処理を対象にした。実際に問題が起きた会話の処理時間トレースは未取得。

## 結論

- **保存済み本文の差分配信は既にある。** 「全履歴の本文を32msごとに送っている」
  という説明は正確ではない。インストール済み0.7.0にも差分配信の実装を確認した。
- それでも、**配信中の回答全文・実行中ツール出力・各レコードの外側の情報・ツール状態**
  は大きくなり得る。送る量と、復元時に走査する履歴量は別問題。
- **同じMarkdown ASTの再利用は、新しいASTが届くストリーミング処理全体の再利用ではない。**
  また、Reactの再描画を省いても、既に存在するDOMの量は減らない。
- 修正候補はあるが、まだ支配的な処理の確定や、過去の2.6→4.5GB増加の説明には至っていない。

## 1. 調べたコードの経路

### 送信

- `apps/desktop/src/bun/session-host.ts`：
  ストリーミング時の発行は32msタイマー。他の経路には即時発行もある。
- `apps/desktop/src/bun/sdk-projector.ts` / `SDKProjector.snapshot()`：
  生きているメッセージとrunning状態のツールを`structuredClone`する。
  保存済み結果の大きなコピーは、永続化された内容と合う場合に共有する既存処理がある。
- 同ファイルの`historyPage()`：
  約50エントリーから直前のユーザーメッセージまで戻り、応答を分断しない。
  **50件は上限ではない。** 一度の応答に多くのツール実行があれば最近のページ自体が大きい。
  キャッシュ済みページは再利用され、毎回全履歴を再投影しているわけではない。
- `apps/desktop/src/bun/transcript-wire.ts`：
  ツール結果を走査し、保存済みメッセージと一致する重複内容をパケット内参照にする。
- `apps/desktop/src/bun/snapshot-delta.ts`：
  上記のpack後に保存済み本文を参照へ置換する。
  レコード列の外側の情報は残り、保存前のliveメッセージは全文のまま。
- `apps/desktop/src/bun/client-hub.ts`：
  クライアントごとに別の差分基準を持つ。現行checkoutではpack処理もクライアントごと。
  基準を共有すると未受信データを参照するため、単純なencoder共有はできない。

### Windowsブリッジ

現行checkoutの生成SDK
`apps/desktop/.hutch/devkit/api/sdks/main/core/BrowserView.ts`では、
JSONを`window.__electrobun.receiveMessageFromHost(...)`のJavaScriptとして評価する経路がある。
送信キューを排出したことは、WebViewがデコード・描画を完了したという意味ではない。
`markSent`もJavaScript評価要求を渡した側で完了する。
したがって、Bun側キューが空でも後段の滞留は否定できない。
生成SDKの細部とインストール済みbundleの完全一致は確認していない。生成ファイルは変更していない。

### 受信・描画

- `apps/desktop/src/shared/snapshot-delta.ts`：
  基準のアドレス・履歴revision・参照先を確認して復元する。
  基準不足時は部分表示せず、全量復旧に戻る。
- `apps/desktop/src/mainview/transcript-sharing.ts`：
  IPC後に本文やツール状態の参照同一性を復元するため、レコード等を走査する。
- `apps/desktop/src/mainview/chat-snapshot.ts` / `retainHistory()`：
  取得済みの古い履歴を守るため、既存レコードのSet作成、prefix抽出、配列の結合を行う。
  wireの最近ページが小さくても、こちらの処理量は読み込み済み履歴に依存する。
- `apps/desktop/src/mainview/App.tsx` / `Chat`：
  会話全体の派生値とJSXを組み立てる。本文・ツール等には既存の再利用処理があり、
  「全本文が毎回再描画される」とは限らない。
  末尾追従時にはtranscript更新のlayout effectで`scrollHeight`を読む。
- `apps/desktop/src/mainview/ChatLayout.tsx`：
  ResizeObserverでも高さと末尾位置を調べる。
  layout effectの読み取りが強制同期layoutを起こすか、その時間が大きいかは未計測。
- `apps/desktop/src/mainview/MessageContent.tsx` / `MarkdownTree`：
  同一ASTならmemoで後処理を省ける。新しいASTでは全体の後処理が再び必要になる。
- `apps/desktop/src/mainview/annotation-highlights.ts`：
  注釈は実DOMのRangeを保持する。見た目と文字列が同じでもDOM置換は互換とは限らない。

## 2. 合成データで分離した測定

追加した再現用スクリプト：
`apps/desktop/scripts/profile-conversation-pipeline.ts`

```powershell
mise exec -- bun apps/desktop/scripts/profile-conversation-pipeline.ts
```

ユーザーのセッション、設定、認証情報を読まず、SDKセッションも起動しない。
各ケース20更新の先頭5更新を除いた平均を、別プロセスで3回測定した。
初回・最終更新は全量snapshot経路と完全一致を比較し、古い履歴の件数も毎回確認する。
時間欄は3回の平均値の範囲で、最悪時間やp95ではない。

| 合成条件 | 差分パケット | pack込みencode | JSON化 | BunでのJSON復元 | 差分復元・参照共有・履歴保持 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 保存済み結果80件、live約1KiB | 16.7KiB | 0.05–0.07ms | 0.02–0.04ms | 0.04–0.07ms | 0.15–0.28ms |
| 同上、live本文約1MiB | 1,039.7KiB | 0.07–0.11ms | 0.32–0.40ms | 0.50–0.64ms | 0.20–0.27ms |
| 同上、running出力約1MiB | 1,040.8KiB | 0.08–0.09ms | 0.96–1.16ms | 0.24–0.30ms | 0.26–0.29ms |
| 保存済み結果2,000件、live約1KiB | 399.3KiB | 1.95–2.21ms | 0.57–0.62ms | 1.91–2.00ms | 7.37–8.24ms |
| 最近80件＋追加取得済み履歴10,000件 | 16.9KiB | 0.09–0.11ms | 0.05–0.06ms | 0.08–0.10ms | 2.85–3.32ms |

保存済み結果80件の全量パケットは約1,146KiB、2,000件では約28,633KiB。
既存の本文参照は明確に効くが、1MiBのlive本文は依然として1MiB超になる。
仮に32msごとにこのパケットを発行すれば約32MiB/秒、
2,000件の外側の情報だけでも約12MiB/秒という**合成値からの換算**になる。
実セッションの転送レートを測った値ではない。

**測定の除外範囲：** SDK投影とclone、外側のRPC、Windows IPC、JavaScriptソースの
コンパイル・評価、Zustand通知、React、Markdown/ハイライト、layout/paint、実入力遅延。
WindowsのJavaScript評価をBunの`JSON.parse`時間で代用してはいけない。
測定CLIはBun 1.4.2、インストール済みアプリのBunは1.4.4。
checkoutは`987b16a`に多数の未コミット変更があり、
インストール済み0.7.0の`ea39ee459afd16c76c6e9619c28fc6c7b4cedf6c`とは異なる。

## 3. 実装する場合の優先順

### A. まず実処理の内訳と滞留を測る

本文やメッセージIDをログに出さず、時間・件数・バイト数・一時的な計測番号だけを記録する。

1. SDK snapshot/clone、pack、JSON化。
2. Bunキュー、nativeへの投入、WebViewでの受信完了、未処理件数・バイト数。
3. 差分復元、共有、履歴保持、store通知。
4. React組立て・commit、Markdown後処理、強制layout、paint、入力から表示まで。

末尾追従と古い履歴を読む状態、配信中と停止中、入力とIMEを分ける。
DOMも総数だけでなく、コード行・token・diff行・数式・画像等の内訳とText node数を数える。
異なるプロセスの`performance.now()`をそのまま引かず、
各プロセス内の所要時間と同一時計での往復時間を使う。
本番セッションの操作・再送・再起動はせず、必要な再現は一時的な読取専用コピーで行い後片付けする。
CPU/heapも最初はsamplingと数値だけにする。ヒープスナップショットや詳細なV8 traceは
本文・機密文字列を含み得るため、自動保存せず、必要なら別途許可とローカル限定の取扱いが必要。

### B. 回数や内容を削らず、wireの重複を減らす

- 変更されないツール状態、sessionUI、レコード列の外側の情報もversion参照の対象にする。
- liveテキストと追記型ツール出力は、基準が確認できる場合だけ追加部分を送る。
  途中編集・短縮・非テキスト変更・並べ替え等は全置換に戻す。
- SDKの可変オブジェクトをIDだけで不変と決めつけない。所有済みコピーと更新versionの境界が必要。
- 削除と省略を区別し、epoch/revision変更、欠落、再接続、全量復旧を含めて検証する。
  復旧RPCでは送信側の差分基準も再同期する。
  フレーム基準と、RPC読取等でも進む通常の`snapshotSeq`を安易に同一視しない。
- 全量経路をoracleとして、**各更新の全フィールド**が一致することを検証する。
  SDKイベントと拡張通知の順序・配信は変更しない。

ブリッジ滞留が実測された場合だけ、後段としてACKと送信圧制御を設計する。
**単なる「最新snapshotだけ残す」は不可。** 差分基準だけでなく、途中で追加された履歴、
requestId受領、意味のある状態変化を失う可能性がある。
古い本文を再送しないことと、必要な履歴を欠落させないことを両立させる。

### C. 受信側の全履歴処理を重複させない

同一のimmutableレコード列から作る参照索引を、復元・共有・履歴保持で共用できるか検証する。
wire自体が変更部分を識別すれば、変更されない取得済みprefixのMap再作成・配列再構築を
避けられる余地もある。ただし追記だけを仮定しない。prepend・削除・枝変更・並べ替えは
全量経路に戻し、取得済み履歴と参照同一性を維持する。
安価な派生計算すべてに新しいキャッシュを追加する案ではない。

### D. DOMを消す前に、変更されない描画処理を分離する

- 古い応答のJSX組立てとlive部分を分離する候補を計測する。
  React key、開閉状態、ライブ→保存済みの同一DOM、拡張renderer購読を維持する。
- 新しいMarkdown ASTでも、完全パース後の変わらない部分を再利用できるか検証する。
  安易に文章を途中で分割すると、後置リンク定義、脚注、表、未閉鎖コード等の意味が変わる。
  独自の増分Markdownパーサーをいきなり追加する案ではない。
- 末尾追従の同期layoutが大きければ、既存ResizeObserverとの重複を調べる。
  layout effectの単純削除やrAF移動では、初期末尾、prependアンカー、遅延数式、
  ユーザーの上スクロール、検索jumpが壊れ得る。個別経路を維持する必要がある。

これらはDOM総量の解決とは別。DOM削減の候補は、明確な不変条件を持つ確定内容の
**初回マウント時だけ**行う静的な構造簡素化などから検証する。
表示後のlive DOMをまとめ直さない。確定後の本文差替えも含めてRangeを守れると
証明できなければ採用しない。仮想化、未表示化、切詰め、折り畳み既定変更は提案に含めない。

## 4. 採用しない近道と互換性の合格条件

- `startTransition`を付けるだけでは、手前のJS評価・復元処理や同期layoutは消えない。
- 更新を100ms等へ落とすだけ、通知を捨てるだけ、画面外DOMを外すだけの変更は行わない。
- `content-visibility`等も、選択・注釈の矩形・検索・高さ推定への影響が未検証なら安全策扱いしない。
- 同じ文字列を大きなText nodeにまとめ直す方法は、選択Rangeの負例で不採用。

比較対象は表示文字列だけではない。選択範囲・方向・コピー内容・注釈Range、prepend時の
読書位置、内側スクロール、初期末尾、検索jump、IME・draft・focus、画像状態、言語・theme、
拡張renderer追加/削除、通知とキャンセルの順序を含む。
ブラウザfixtureに加え、Windows native WebViewでの入力・長時間計測が必要。

今回の再確認は直接TypeScript・全Lint、通信/参照共有関連20テスト、
`render-reuse-ui.test.ts` 1テストが通過。
UI負例は既存行構造でRange維持=true、素朴なlive統合で=falseを再現した。
本体UI・SDK・配信処理は変更していないため、未実装の案のUX互換性が証明されたわけではない。

## 5. メモリと実行中ビルドについて未確定な点

この調査中の3秒サンプルは、renderer CPU約44.3%・private約376.6MiB、
GPUプロセスCPU約23.4%・private約194.6MiB、Bun CPU約1%・private約3,313.4MiB、
working set約965.3MiBだった。CPUは1コア換算で、GPU使用率を測った値ではない。
private、working set、JS retained heapは別物であり、
以前報告された2.6→4.5GBと同じプロセス・指標かも未確定。
DOMがBun側の増加原因だと結び付けたり、リークと断定したりはできない。
9229のCDPエンドポイントは利用できず、当該会話のCPU/GC/heapトレースはまだない。

参考：
[WebView2のメッセージ/API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2)、
[React startTransition](https://react.dev/reference/react/startTransition)。
もしJSコンパイル自体が支配的なら、SDK側で`PostWebMessageAsJson`等のデータ転送APIを
使う案もあるが、順序・navigation・再接続を含むSDKレベルの別検証になる。

## 6. 保存済み出力のDOM削減実装

ユーザーの実装指示後、通信処理ではなく、実際の装飾要素を減らす変更を追加した。

- `App.tsx`の保存済みentryを`SavedOutputContext`で識別する。
  `ToolBlock.tsx`では確定結果だけに絞り、更新可能な設定Cardは除外する。
  `ChatContent.tsx`で選ばれたRendererとそのDefaultRendererには従来構造を使わせる。
- `HighlightedCode.tsx`の`CodeText`は初回マウント時にだけ描画方式を決める。
  配信中に作ったDOMを、保存完了時にまとめ直さない。`DiffHunk`も同じ扱い。
- `token-runs.ts`の`codeRuns`で同じ装飾のspanを行をまたいで共有する。
  **文字自体のnodeは行・token単位のまま**なので、新しい行の追記で既存行の文字列を
  丸ごと置き換えない。新しいキャッシュや内容の切詰めは追加していない。
- 空白だけの不要なspanも除く。ただし背景・font装飾のある空白は残す。
  背景や下線等が改行に広がらないよう、装飾付きの行境界は結合しない。
- 差分は全幅の追加・削除背景を描く行要素を残し、その内側の余分な装飾spanだけを減らす。
  ターミナルの既存方式、折り畳み既定、8行preview、履歴保持、更新頻度は変更していない。

`output-dom-ui.test.ts`で、同じ内容の従来構造と削減後を実Edgeに並べて比較した。
下表は`pre`配下の件数で、**要素数とText nodeを含む総数を区別**する。

| 合成表示 | 要素数：従来→削減後 | Text nodeを含む総数：従来→削減後 |
| --- | ---: | ---: |
| コメント1,200行 | 1,201→2 | 3,600→2,401 |
| 通常の構文色付きコード200行 | 2,401→1,601 | 5,000→4,200 |
| 日本語・CRLF・空行のコード | 24→13 | 50→39 |
| 太字等を含むMarkdown言語のコード | 14→12 | 30→28 |
| 行番号付き差分 | 30→18 | 未集計 |

通常コードの例では要素を約33%、総DOM数を16%削減した。
コメント例の「要素99%以上減」は、全文字nodeが99%減るという意味ではない。

同テストは全文・改行・ネイティブ全選択コピー、字形位置・色・font・背景、
スクロール寸法と位置、逆方向選択の端点、注釈用のNative Range、追記・完了、
本番Chatと完了ツールの初回表示、Snapshot更新、拡張Renderer追加/削除も検査する。
`token-runs.test.ts`は150通りの部分解析結果で本文と装飾の一致も検査する。
既存の不採用例（大きなtext nodeの全文置換）は変更していない。

これは保存済み内容の初回表示を対象とする限定的な実装であり、
**既に配信中から表示していた全DOMを後から減らすものではない。**
実アプリの2.6→4.5GB増加の解消、長時間のCPU/GC/入力遅延改善はまだ確認していない。
インストール済みアプリの更新やユーザーセッションの再起動もしていない。

検証結果：

- 直接`tsc`、`tsgo`、変更した8ファイルのBiome検査、UI専用Lintは通過。
- 必須の`pnpm test:ui`は**26 passed / 0 failed**。既存の選択・履歴・pane・theme等の検査も含む。
- `pnpm test`は**1,000 passed / 1 failed**。失敗は`ChatOpening.test.tsx`の隔離子プロセス内の
  モデル区切りのSVG位置と「New chat」ボタン数の2assertion。
  新しい保存済みProviderを外したAppの一時コピーでも同じ2件が失敗することを確認し、
  コピーとpreloadは削除した。既存assertionや許容値は変更していない。
- 全体`pnpm lint`は別の作業中ファイル
  `apps/desktop/src/stories/proposals/lens-{data,health,read,search}`と`lens.css`の
  書式・a11yエラー7件で停止した。`statistics.css`のspecificity警告3件もある。
  これらは今回編集しておらず、全体の検査を通すための変更もしなかった。
- `git diff --check`は通過。
