# DesktopUIの断続的な入力遅延・新規チャット直後の重さ

## 結論と確度

ユーザー報告は「継続利用中に入力・UI操作が極端に遅くなる」「自然に戻ることもある」「新規チャット直後が特に怪しい」「PC全体の使用率は高くない」。

**実装の問題を複数再現し、修正した。ただし、症状発生中のインストール済みアプリからCPU/入力遅延トレースは取得できていない。今回の全症状を解決済みとは断定しない。** 稼働中アプリの再起動、ユーザーの会話・設定の変更は行っていない。

追加対応として、同期解析のWorker化・Snapshot差分配信・全文を保持するDOM削減を実装した（第10節）。第8〜9節の「未修正」と検証結果は、その前段階の記録。

最重要の発見は、新規チャットごとのモデル環境初期化で、プロバイダー登録1件につき全体refreshが発生していたこと。44プロバイダーで45回の全体refreshを実測した。

## 1. 新規チャット：モデル環境初期化のrefresh連発【再現・修正】

対象：

- `apps/desktop/src/bun/model-runtime.ts`
- SDK `ModelRuntime.registerNativeProvider` / `refresh`
- 新規 `apps/desktop/src/bun/model-refresh-coalescer.ts`

`createModelRuntime()` は、各セッションに独立したSDK ModelRuntimeを作り、pig用のプロバイダーを順次登録する。SDK 1.5.2の `registerNativeProvider()` は、登録のたびに `void this.refresh({allowNetwork:false})` を実行する。これは当該プロバイダーだけでなく、全体の再構築、catalog更新、利用可能性・認証の再確認を伴う。

登録44回＋最後の明示refreshで45回。これは「ネットワークなし」でも起きる。新規チャットだけでなく、runtimeの作り直しにも効く。

一時HOME・拡張なし・`PI_OFFLINE=1` の別プロセスで、実SDKの `ModelRuntime.prototype.refresh` の呼び出しを計測：

| 指標 | 修正前 | 修正後 |
| --- | ---: | ---: |
| 登録プロバイダー | 44 | 44 |
| 実際の全体refresh回数 | 45 | 1 |
| `createModelRuntime()` wall time、各1回の参考値 | 1022.8ms | 131.2ms |

時間は単発値で、ネットワーク・実ユーザーの拡張・WebView描画を含まない。アプリ全体が必ずこの比率で速くなるという値ではない。回数削減は構造的な回帰テストで検査する。

修正は各runtime内だけで、同じ `{allowNetwork:false}` 要求をまとめる。実行中に新しい登録があれば追加のpassを行い、待機者はそれも完了してから返す。ネットワーク、provider指定、force、AbortSignal付きの要求のoptionsは変更せず、先行する登録refreshを待ってから実行する。そうしないと遅れたoffline passがnetwork取得後のcatalogを上書きするため、この順序も回帰テストで保証する。同じproviderオブジェクトの再登録も省く。認証結果のキャッシュや、セッション間のModelRuntime共有ではない。

検査：`model-refresh-coalescer.test.ts`、`model-runtime-performance.test.ts`、既存のruntime隔離・アカウント・手動refreshテスト。

## 2. 新規Composer：閉じたモデル一覧と入力ごとの再計算【再現・修正】

対象：`ModelPicker.tsx`、`ChatOpening.tsx`。

修正前は閉じたnative detailsの中にもモデル一覧のReactツリーを作っていた。新規Composerの `onSelect` も入力のたびに別関数になるため、子のmemo化だけでは止められない。

- モデル一覧は開いたときだけmountする。
- ModelPickerをmemo化し、新規Composerの選択callbackを安定させる。
- 遅延mount後の検索欄フォーカスをeffectで保証する。

Edgeの実描画fixtureで1000モデルを用意し、新規Composerに12文字を入力。修正後の入力中catalog再参照は0回、閉じたモデルoptionのDOMは0件。新規Composerのfixture描画は約33msだったが、待機frameを含む値であり、実アプリのnew-chatレイテンシではない。

開いた一覧の高さ、検索、account選択、枠内スクロール、検索欄フォーカスも同じ描画テストで確認。

## 3. 継続利用：IPCでmemo化が無効になる【再現・修正】

対象：`chat-snapshot.ts`、新規 `transcript-sharing.ts`、`LazyDetails.tsx`、`ToolBlock.tsx`。

ホストは返信更新時にTranscriptをSnapshotで送る。IPC後は保存済みの過去entry・tool stateまで別オブジェクトになる。`ToolBlock` のmemoは参照が変わるので効かず、さらにDisclosureのContextも毎回新しい値だった。

Edgeで40件の保存済みツールと配信中返信を作り、IPC相当のcloneを伴う更新を6回実行：

| 指標 | 修正前 | 修正後 |
| --- | ---: | ---: |
| 内容不変の40ツールの再描画 | 240回 | 0回 |

同じepoch・history revisionの保存済みentryだけ参照を復元する。live entryや変更されたenvelopeは再利用しない。tool resultも、当該entryのcanonical payloadを指していることを確認できる場合だけ共有する。拡張が表示用に変えた結果は上書きしない。

Disclosure Contextの参照を安定させ、ToolGroupの比較も関連するcall・state・card・targetだけにした。展開済みグループで不変ツールの描画0回、1ツールだけstatusを変更したときはその1件だけ描画されることも確認。

## 4. 配信中Markdown・大量探索【再現経路を修正】

- `MessageContent.tsx`：ReactMarkdownの `components` に毎回新しい関数型を渡していた。コードや画像の子コンポーネントが配信更新でremountする。型を固定し、不変コードのDOMが保持されることをEdgeで検査。
- `shared/tool-view.ts`：探索ツールのグループ化で、伸びる配列全体を毎回 `every()` していた。O(n²)をO(n)に変更。2000件の探索callを、時間閾値ではなく実際の判定回数で検査。

## 5. 実プロセスと会話データの読み取り専用調査

稼働中のインストール済みpig 0.5.0のWebView rendererは、調査中の一時点でworking set約1208MiB、private memory約1165MiB。その後の5秒サンプルではprivate memory約1608MiBだった。rendererのCPU増分は1コア換算約17%、Bun約10%。

これは単発サンプルで、リークや原因の証明ではない。GCの前後、会話内容、GPU/ブラウザ内部のメモリを分解できていない。別のテスト用Edgeも存在したが、ユーザーのプロセスは終了していない。

PC全体の使用率が低くても、入力を受ける1本のスレッドの処理待ち、同期レイアウト、GC、IPC待ちでUIは遅くなる。`Responding=true` も入力レイテンシが良好という証拠ではない。

保存済み36会話から大きい5ファイルを読み、JSONLを変更せずactive branch相当を再構成。現在の50entry目安・応答単位ページングと `packTranscript` を使ったサイズ：

| ファイルbytes | tail records | pack後tail bytes | Bun JSON.parse平均、10回 |
| ---: | ---: | ---: | ---: |
| 8,097,361 | 118 | 3,070,246 | 7.69ms |
| 5,476,999 | 91 | 1,360,228 | 3.39ms |
| 4,229,114 | 104 | 1,110,891 | 3.52ms |
| 4,203,615 | 117 | 4,203,478 | 4.55ms |
| 3,583,188 | 89 | 503,846 | 1.78ms |

長い1応答は50件で切らないので、tailが大きくなる。3.07MBを32msごとに送ると、Transcript JSONだけで理論上約96MB/秒になる。**これは実測した通信帯域ではない。** 暗号化、WebView側のparse、React、レイアウトは上のparse時間に含まない。

ユーザーの会話本文・認証情報は調査ログやこの文書に出していない。SessionManagerを開いてmigrationを走らせる方式でもない。

## 6. まだ残る候補・次の調査

- **全量Snapshot転送**：今回は描画参照を共有したが、転送・parse量はまだ減らしていない。background sessionも配信されるので、新規チャットに移動しても古い実行中チャットの負荷は残りうる。差分プロトコルにはbase revision、取りこぼし時のfull snapshot復旧、reconnect/epochの検査が必要。今回の修正と混ぜて安全性未検証の差分配信を入れない。
- **拡張初期化**：新規chatごとにTrust、resource discovery、session_start、adapter attachが走る。今回のisolated試験は実ユーザーの拡張をロードしていない。特定拡張を主因とは断定しない。
- **同期ハイライト**：Shikiは長さ・行数制限と32件cacheを持つが、実際のtokenizeは画面スレッドで行う。remount削減だけで長い単一処理まで解決するわけではない。long-task traceで支配的ならworker化を検討する。
- **長い会話のDOM・layout**：読み込んだ履歴は保持される。1000行fixtureの初回描画は単独実行で約233〜300ms、他テスト並行時に約446ms。入力欄の自動高さ計算は `scrollHeight` を読むので、大きなDOMの同期layoutも追加調査対象。履歴を勝手に切る、選択・注釈・scroll位置を壊す変更は行っていない。
- 永続的なイベント購読増殖、PC全体のCPU不足、特定GPUドライバー問題は今回確認できていない。

## 7. 新規チャットの段階別診断

`PIG_PERF_OPEN=1` で起動すると、`[pig:open-performance]` のJSONを出す。記録するのはopaque openId、結果、段階名、wall timeだけ。通常は無効、1open最大32段階、完了後のhookからは追記しない。

段階：file解決、SessionManager、preview送信、Trust確認/人間の回答待ち、ModelRuntime、resource services/queue、利用可能モデル、AgentSession作成、拡張/adapter bind、ready送信。

PowerShell（開発アプリが未起動のときに設定。`mise run dev` は起動済みならフォーカスするだけなので、そのプロセスの環境は変わらない）：

```powershell
$env:PIG_PERF_OPEN = '1'
mise run dev
```

ログ：`%TEMP%/pig-dev.stdout.log`。Trustの人間待ちと処理時間を混同しない。hostのready送信までの値であり、画面に描かれた時刻や入力latencyではない。

## 8. 追加調査：前回の3点以外の重い経路

「それだけか」という追加依頼を受け、送受信とアダプター側を別に計測した。以下も今回のユーザー症状の直接トレースではなく、再現できた実装経路・synthetic計測である。

### 8.1 画像付き下書きの裏返送【再現・修正】

`createDraftMirror` はRPCのrequest/responseから既知画像を省いていたが、`ComposerBridge.commit` が `extensionUIEvent` で全画像を送り返していた。RPC応答だけを検査する既存テストでは見落としていた。

画像8MiBを保持して文字だけ10回同期した実測：

- 修正前の通知JSON合計：83,893,092 bytes（約80MiB）。
- 修正後：2,173 bytes。通知回数は10回のままで、通知自体を捨てていない。

ホストでは既知画像を再cloneせず、通知では画像IDと参照元revisionを送る。UIは**最後に確認済みのホスト画像**だけを参照し、同じIDの未同期ローカル編集を参照元にしない。参照が欠けた/飛んだ場合は `getSessionDraft` でそのaddressの下書きだけを取得する。並行missは1本にまとめ、後続通知のrevisionまで追跡する。閉鎖/置換後の返答は無視し、ローカル競合を保持する。初回同期・画像変更・再接続の完全なdraftは維持する。

検査：`draft-image-references.test.ts`、`draft-image-recovery.test.ts`、実RPC handlerを使う `draft-rpc.test.ts`。画像サイズ、echo、参照欠落、同一IDの未同期変更、古い返信、閉鎖を含む。

### 8.2 背景更新の二重ストア通知【再現・修正】

同じaddressが既に登録済みでも、全Snapshotで `register` がaddressesを更新し、その後にsnapshotも更新していた。背景chat更新100回、20project/保存一覧10000sessionのsynthetic subscriberで、通知200回を実測。修正後は100回。重複/古いSnapshot・WireEventの通知は0回。

これは「画面全体が200回描画された」という意味ではなく、Zustand購読者のselectorがその回数動くという値。背景の本文が描画されなくても入力と同じJSスレッドに負荷が残る。

### 8.3 待機中の状態更新→一覧の再探索【再現・修正】

`rpc.ts` は `snapshot && !running` だけで `refreshSessions` を起動していた。アダプターの状態やmodel catalog等の更新でも、待機中ならSDK `SessionManager.list` に戻り、JSONL一覧を読み直す経路になる。in-flightの集約はあったが、順次届く更新を止める条件ではなかった。

完了のrunning→idle、追加・削除・置換、title/cwd/modified変更時だけ自動再探索するよう修正。内容不変のidle更新100回で追加探索0回、完了時/close時はowning projectを再探索する。外部CLIの発見用focus/明示refreshは残す。

### 8.4 アダプターが本文deltaで全履歴を複製【再現・修正】

`adapter-source.ts` はすべてのSDKイベントでsnapshot購読者を起動した。`AdapterRuntime` の `sources.entries()` は隔離のため全entryをcloneするため、UIへの32ms集約とは無関係に、本文deltaごとに複数アダプターが全履歴を複製し得る。

約2.2MBの保存済み履歴・本文delta100回の試験で、全履歴取得100回→0回。raw `onEvent` の100イベントは省略しない。hookがentryを書いたdelta、tool progress、明示refreshは通知を継続する。サンプルplan adapterも、raw本文deltaによる不要なsaved-view再構築を避け、command/lifecycleイベントは保持する。

### 8.5 Ready Composerの入力ごとの再計算【修正・Edge確認】

新規待機Composerだけでなく、実行準備済みの `Composer` でも毎回 `filterModels`、全recordのrequest ID集合、折り畳んだpasteの展開をやり直していた。入力と関係ない依存が変わらない間は再利用する。1000モデルのready Composerで12文字入力し、catalog再走査0回をEdgeで確認。

### 8.6 同期ハイライト【強い停止候補、未修正】

同じ `highlightCode` とJS正規表現engineをBun上で実行。63,000文字・1000行のTSXは既存の100k文字/2000行制限内だが、以下を観測した。

| 操作 | wall time | heartbeatで観測した最大event-loop gap |
| --- | ---: | ---: |
| cold TSX | 約939ms | 約884ms |
| 末尾だけ変更して再tokenize | 約178ms | 約179ms |
| 再度変更 | 約220ms | 約220ms |

UIと同じtokenizerだが、これはBun上の測定であってWebViewの実トレースではない。少なくともこの処理が同期で長く止まること、100msの本文sample間隔や長さ制限だけでは十分でないことは再現した。Worker化等が必要で、今回は完了していない。前回直したremountやハイライト保持だけでは解決しない。

### 8.7 Markdown/GFM/KaTeX【強い停止候補、未修正】

同じplugin構成をReact server renderで実行した参考値：500行table/約12.5k文字で約133ms、数式100個/約4.6k文字で約420ms。後者の出力は約374k bytesに膨らむ。これはparser/KaTeX/React生成の同期CPU時間で、ブラウザDOM/layout/paintを含まない。実WebViewの値として扱わない。

現在は配信本文を約100msごとに全体parseするので、本文量によってはsample間隔より1回の処理が長い。`memo` や `useDeferredValue` だけで、この同期処理中に入力を割り込ませられるわけではない。段階処理/Worker化の次の優先候補。

### 8.8 まだ全量を送る背景Snapshot【計測、未修正】

約2.2MBの不変record＋live replyというsynthetic packetは、JSONで2,360,191 bytes/update。Bun parseは同条件でも平均約3msから負荷時約25msまで変動した。転送量そのものは今回の参照共有や二重通知削減では変わらない。

これに暗号化/復号、WebView parse、store処理、GCが加わる。新規chatへ切り替えても古い実行中sessionの配信は止まらない。差分配信/閲覧購読制御は未実装であり、重要な残件。

### 8.9 DOMとメモリ保持【構造確認、一部の主因候補を除外】

- 8行previewは高さ制限でありDOM件数制限ではない。既存Edge fixtureでも10000行diffは10000 span、展開した探索groupは500ツールをmountする。長い実行中responseの大量出力はlayout/DOM/GCの候補。選択・注釈・全内容への到達を守るため、無断の切り捨ては行わない。
- 新規chat作成では古いidle SessionHost/SDK sessionが自動closeされず、各snapshot・resource/extension状態も保持される。保持が累積する構造はあるが、独立したModelRuntimeだけで1GBを説明できるかは別。
- 空の隔離profileでModelRuntimeを20個保持した計測では、GC後heapは約13.7MiB→20.2MiB、release後約15.6MiB。ModelRuntime単独の不可逆リークを主因とはしない。AgentSession、実拡張、履歴、WebView DOMを含まない。
- 実Edgeで1000会話行の横で `sizeEditor` を12回測ったp95は1行約0.8ms、20行約0.9ms。少なくともこのfixtureでは、入力欄の高さ計算単独を長時間停止の主因とする証拠はなかった。実操作latencyではなくhelperの同期時間。
- 追加の実機サンプルは16論理CPU、物理RAM約64GiB、空き約29GiB、page read/input 0。観測時の物理RAM枯渇は確認できない。pig renderer private memoryは約1.8GiBだったが、heap/DOM/GPUの内訳やリークは未確定。16CPUなら1コアの飽和でも全体約6.25%なので、低い全体CPU表示はJS thread停止を否定しない。

再実行用（synthetic/offline。後者は空の一時profileの別プロセス）：

```powershell
mise exec -- bun apps/desktop/scripts/profile-desktop-hot-paths.ts
mise exec -- bun apps/desktop/scripts/profile-model-retention.ts
```

## 9. 第二段階終了時の検証範囲

- 型チェック、全体Lint（UI style 75ファイル、違反0件）、Vite production build成功。
- `pnpm test:ui`：実Edgeで成功。入力、IPC clone、グループ更新、コードDOM、既存のscroll・注釈・8行プレビュー・Card等の回帰検査を含む。
- モデルrefreshの単体・実SDK性能・runtime隔離・アカウント・手動refresh・SessionHost性能の個別テスト成功。
- 初回roundの全体テストは778成功/2失敗。追加調査・修正後の全体テストは795成功/3失敗/1 error。provider/accountの旧dump-dom fixtureがreportを取得できない1件、並行実行時のTrustテストtimeout2件と、その後の一時directory削除に伴う非同期ENOENT。Trustテスト7件は単独再実行ですべて成功。全体成功とは報告しない。
- 追加修正の個別検査61件は成功。最新の `pnpm test:ui` も実Edgeで成功し、ready/new Composerの入力とeditor sizing計測を含む。旧dump-dom fixtureはModelPickerを変更前のHEAD内容に差し替えた別fixtureでも同じ失敗を確認した。
- 初回の全体検査では並行変更中のclipboardテスト・formatエラー、SessionHostのtimeoutも出たが、最終実行では解消。SDK catalog更新順序のテストで見つかったrefresh競合は修正し、OpenAI APIの認証優先順位・画像/classifier catalog同期も個別/全体とも成功。
- 最新ログ：`%TEMP%/pig-performance-tests-phase2.log`、`%TEMP%/pig-performance-ui-phase2.log`、`%TEMP%/pig-performance-build-phase2.log`。追加中に並行編集のStoryに型エラーも出たが、最終の型チェックは成功。
- インストール済みアプリへは未反映。実症状の再現、修正版を使い続けたときの入力latency/heap推移、実ユーザー拡張を含む段階別計測は未完了。

## 10. 第三段階：残っていた同期解析・転送・DOMの対応

### 10.1 ハイライトとMarkdown・KaTeXをWorkerへ

- `syntax-engine.ts` / `syntax.worker.ts`、`markdown-engine.ts` / `markdown.worker.ts` と共有の `render-worker-queue.ts` を追加。各Workerで実行は1件、不要になった待機ジョブは取り除く。実行済み処理を中断できたとは扱わないが、結果は破棄し、新本文を古い結果で上書きしない。
- Shikiは従来の文法・テーマ・ANSI処理・上限を維持。文法を静的bundleに含め、必要な言語だけコンパイルする。色が確定したprefixは共通のretained highlightingで保持する。
- Markdownは従来と同じReactMarkdown/GFM/Math/KaTeXで解析。HTML文字列ではなくHASTを返し、同じ安全なURL変換・React用コンポーネントで描画する。`innerHTML` による一括置換はしない。
- 同一sourceは共有し、cacheを件数・推定容量で制限する。本文の変化で利用者を解除し、使われない待機解析を取り消す。Workerが利用できない場合とSSRは従来エンジンにfallbackするため、その場合まで遅延を解消したとは主張しない。
- 未解析の新しい部分もescaped textとして表示し、全文表示の追加操作を要求しない。単純な文章は正確な段落/soft breakを即時生成し、解析待ちによる段落高の変動を避ける。既存の完成ブロック、追記中の段落、変更されたコードフェンスのpre/codeと最新本文を保持する。通常のparse完了時には従来の書式へ自動確定する。
- 非同期の書式確定で内容高が変わるため、`ChatLayout` のResizeObserverは直前に末尾にいた場合だけAppの既存追尾へ通知する。読んでいる途中の強制スクロールはしない。
- Worker用bundleでは `decode-named-character-reference` と `hast-util-from-html-isomorphic` をDOM非依存の実装へ解決する。ブラウザ条件の実装はdocument/DOMParserを要求し、そのままWorkerへ移すと起動に失敗することを実Edgeで発見・修正した。本番とfixtureは同じaliasを使う。

実Edgeでの検証：

- 1000行TSXの解析中と250個の数式の解析中、それぞれCDPのtrusted inputがWorker完了前にComposerへ届き、UI heartbeatも進む。観測約33msはrunnerのpoll/frame待ちを含む値であり、実ユーザーのキー押下から描画までの計測ではない。
- `render-workers-ui.test.ts` は本番Vite設定の `?worker&inline` を実際にbuildし、隔離したHTTP/Edgeで直接実行する。UI fallbackは経由しない。source全バイト、KaTeX tree、Worker完了数、heartbeatを検査する。最新の全体実行ではsyntax約543ms/math約466msの処理中もheartbeatが進み、観測最大gap約20ms。他の実行では環境負荷で約162msまであったため、常に一定の最大遅延を保証する値ではない。
- 独立した従来ブラウザpipelineとのDOM一致を、table/reference/code、HTML entity、数式/SVG、無効TeX、安全でないURL/raw HTMLで検査する。保持したcode DOM・色・最新本文、注釈、native scroll、履歴全行の検査も維持する。
- Edgeの遅れて現れるnative chromeでviewportが34px変化し、geometry検査が競合する問題は、fixtureをabout:blankから固定viewport設定後にnavigateすることで分離。許容誤差や検査項目は削らない。

### 10.2 保存済みrecord本文のSnapshot差分転送

- `bun/snapshot-delta.ts` と `shared/snapshot-delta.ts`。同じaddress/epoch/history revisionの保存済みentry本文だけを参照化する。ホスト側cacheはID/revisionだけで、過去の本文を余分に保持しない。
- 全recordの順序・branch・request receipt等のenvelope、live record、tool state、その他のSnapshot属性は引き続き送る。背景sessionの進捗・通知・完了を止める方式ではない。
- 初回/branch変更/owner変更とRPC/reconnect応答は自己完結のfull snapshot。欠落したrecord参照・不正なtool result参照はpartial transcriptとして適用せず、表示と下書きを保ったまま同じownerのfull snapshotを取得する。取得を集約し、古いsequenceやclosed/旧epochからの応答は復活させない。promptの再送やsessionの再openもしない。
- 合成fixtureの同一更新はfull 2,401,188 bytes → delta 1,068 bytes。展開後の全文、tool result、metadataが元のfull snapshotと一致することを検査する。record envelope/live本文等は全量のままであり、あらゆる履歴サイズに対して定量転送になったわけではない。
- 実RPC handlerの隔離テストで、欠落・順序逆転・close・epoch更新・ready通知欠落からの回復と、送信再実行0回を検査する。回復待ちのpublicationもreconnectのrevision判定を無効化し、古いruntime stateで上書きさせない。

### 10.3 全文保持のDOM削減

- `token-runs.ts` で隣接する同じ色/styleのtokenをまとめ、TokenLine/DiffRowをmemo化する。
- 200行超の無ANSI terminalは同じ状態色の連続範囲をまとめる。改行、CRLF、成功/失敗色の境界、全文を保持する。実Edgeで1万行が1 spanとなり、全文の選択文字列一致と末尾へのスクロール到達を検査した。
- 出力の切り捨て、履歴/ログの仮想化、8行以降の削除はしない。1万行diffの1万span、500ツールの展開も検査を残した。大きなDOM/React commitそのものを全面的に消したわけではない。

### 10.4 最新の検証と未確認事項

- 全体テスト：843成功 / 1失敗（844件、167ファイル）。残る失敗は以前から再現する `provider-accounts-ui.test.ts` の旧dump-DOM fixtureでreportを取得できないもの。今回のWorker/差分/保持/回復テストは成功。全体greenとは報告しない。
- `tsc --noEmit`、全体Lint（UI style 79ファイル・違反0件）、Vite production build成功。標準typecheck wrapperのSDK syncは並行build lock待ちになったため、型検査はdesktopのtscを直接実行して確認した。
- 最新の必須 `mise exec -- pnpm test:ui` は3成功 / 0失敗。本番Worker検査も登録し、Markdown DOM一致、trusted input、選択/注釈、スクロール、モデルPicker、Composer、8行preview、Cardを検査した。末尾へ戻った後の非同期Markdown整形への追尾と、読んでいる途中の非同期整形によるdrift 0も確認。ResizeObserverの判定にはpadding込みの実scrollHeightを使う。
- Windowsの一時Edge profile削除でBunのrmがEBUSYを返す問題は、Browser.close後の終了待ちとNodeのWindows対応recursive rmで処理する。永続的な削除失敗は握りつぶさずテスト失敗にする。
- 最新ログ：`%TEMP%/pig-render-workers-tests.log`、`%TEMP%/pig-render-workers-ui.log`、`%TEMP%/pig-render-workers-lint.log`、`%TEMP%/pig-render-workers-build.log`。
- 未確認：実症状時のWebView thread/heap trace、実ユーザー拡張の起動/継続保持、インストール済みアプリのviews://上のWorkerと長時間利用。HTML/React/DOM commit、非常に大きな履歴のenvelope/live本文転送は残る負荷。上記は合成Edge/SDK検査であり、実症状の全解消とは同一視しない。ユーザーの稼働中アプリは再起動・更新していない。
