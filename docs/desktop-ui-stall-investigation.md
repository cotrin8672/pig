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

## 11. 追加分離：アクティブ会話更新をAppの画面枠へ伝えない

UXを変えづらい⑫の残件として、`selectAppView` からSnapshot全体の参照を外した。
画面枠はタイトル・cwd・接続状態・設定等の必要な値だけを選び、会話用の
`ConversationWorkspace` が `selectConversationView` でSnapshotを購読する。
本文の切り捨て、更新頻度の変更、バックグラウンド更新の停止、新たな履歴キャッシュはない。
フォーカス移動・分割・リサイズでChatの型やキーを切り替える設計にもしていない。

- 実Edgeの本番App fixtureで、アクティブSnapshotを6回更新。Appだけが使うラベルの読み取りを
  計測し、変更前14回 → 変更後0回。本文は毎回更新され、他ペインの本文再読取も0回。
  ラベルの読み取り回数は入力latencyの測定ではない。
- `pane-updates-ui.test.ts` を拡張し、アクティブペイン切り替え後も枠側の再描画0回、
  タイトル/cwd変更の反映、IME・選択・下書き・フォーカス・スクロールの保持、
  分割/リサイズでのDOM保持、起動プレビューとepoch切り替えを検査した。
- selector単体では100回のアクティブ更新、metadata変更、拡張タイトルの追加/削除/空文字、
  一覧タイトルから起動プレビューへの移行を検査する。⑤の追加キャッシュは今回導入していない。

検証結果：

- `pnpm --filter @pig/desktop exec tsc --noEmit`、全体Lint成功。
  標準の `pnpm typecheck` は `electrobun sync` のbuild lock待ちで180秒後に停止。
  起動済み開発アプリの停止やlock削除はしていない。
- 対象のselector/ペイン検査16件成功。単体全865件も、同じ対象を並列化せず実行すると成功。
  標準 `pnpm test` は2回とも863成功/2失敗で、失敗箇所が異なる5秒timeoutだった。
  標準の並列実行が安定したとは扱わない。
- 必須 `pnpm test:ui` は2回とも10成功/2失敗。今回のペイン検査は成功したが、
  タイトルバー単独fixtureのpage geometry検査と、会話fixtureのtimeoutが残った。
  検査項目・許容誤差・timeoutは変更していない。全体UI成功や原因解消とは報告しない。
- ログ：`%TEMP%/pig-shell-isolation-unit.log`、`pig-shell-isolation-unit-retry.log`、
  `pig-shell-isolation-unit-serial.log`、`pig-shell-isolation-ui.log`、`pig-shell-isolation-ui-retry.log`。
- 実症状の会話での入力遅延改善、症状中のCPU/GC/heap推移、インストール版との一致は未確認。
  稼働中のユーザーセッションの再起動・更新はしていない。

## 12. 派生計算の計測・request ID集合の共有と一覧キャッシュ

### 12.1 ⑤：計測後、送信照合の重複走査だけを削減

`profile-transcript-derivations.ts` は保存済み100/1000/10000件と更新されるlive末尾を作り、
モデル境界・request ID集合・作業折り畳み・応答フッターを各100回計測する。
ユーザーのファイル・拡張・認証情報は使わない。

今回のBun参考値では、10000件でモデル境界の平均約0.23ms、作業折り畳み約0.19ms、
フッター約0.38ms。これらへ追加の増分キャッシュは入れなかった。計測はWebViewや
入力latencyの測定ではなく、実症状の支配箇所を特定したという意味でもない。

一方、Chat・Composer・OptimisticMessages・SendControllerの4か所にrequest ID集合の生成があった。
未反映の送信がなければ集合を作らず、必要な場合だけ `transcript-requests.ts` のWeakMapで
同じ不変records配列の集合を共有する。配列が変われば必ず再計算するため、末尾追記の仮定はない。
値はID集合だけで、過去のrecords配列や本文への強い参照を保持しない。

- 10000件・4消費者の合成計測：集合生成の平均約1.30ms → 約0.30ms。
- 実EdgeのApp fixture：送信がない6回の更新で、Chat・Composer・楽観表示によるrequest ID読取0回。
- 単体：共有時の走査1回、request ID変更/削除、履歴追加、並べ替え、分岐、保存ID移行、
  照合不要時の読取0回、受信確認後の楽観本文解放を検査する。
- モデル境界・フッター・折り畳みの全履歴の確認走査自体は残っている。

### 12.2 ⑨：一覧専用のファイル単位キャッシュ

`session-list-cache.ts` を `listSessionFiles` に接続した。SDK 1.5.2の一覧は、pigが使わない
`allMessagesText` まで作るため、タイトル・cwd・ID・最終会話時刻だけを投影する読み取りに分離した。
最初のユーザー本文、最新の名前と明示クリア、user/assistantだけのactivity、header/mtimeのfallback、
同時刻の順序を維持する。SDKの一覧との比較を `session-files.test.ts` に追加した。
SessionManagerをopenせず、ファイル修復や書き換えもしない。

- 再取得時もディレクトリ探索とstatを実行する。同時要求だけディレクトリ単位で集約し、
  明示更新・focus復帰の外部CLI変更探索は止めない。
- size/mtimeだけでなくdev/ino/ctime/birthtimeも確認。読み取り前後の属性が変われば結果をキャッシュせず、
  差し替え・縮小・削除・保存先変更を扱う。削除/差し替え中の古い読み取りから旧結果を復活させない。
- 空・不正・読取失敗は負のキャッシュにしない。途中JSONLやUTF-8境界で不完全だった読取は次回再試行する。
  有効行から得られるmetadataはSDK同様表示し、読取中の追記で整合を確認できなければ同じ所有者の直近の正常値を保つ。
- 保持するのはファイル属性と一覧情報だけ。4096件・推定8MiBの予算でLRU削除し、巨大なタイトルは
  省略せずキャッシュ対象外にする。全会話本文や検索用の連結本文は保持しない。
- default sessionDirの副作用なしの計算は `session-directory.ts` に共通化し、従来のSDK一致検査を維持した。

`profile-session-list-cache.ts` の一時ファイル12件、合計約7.5MBの参考値：

| 操作 | 平均wall time | キャッシュの本文読取 |
| --- | ---: | ---: |
| SDK一覧、5回 | 約54.9ms | SDK内部は未計測 |
| 新キャッシュ初回、1回 | 約49.0ms | 12ファイル |
| 変更なし、5回 | 約0.42ms | 0ファイル |
| 1ファイルの名前変更後、1回 | 約13.3ms | 1ファイル |

一覧情報はSDKと一致。速度は一時ファイルのBun計測で、実ユーザーの一覧表示時間ではない。
初回・変更されたファイルのJSONL読み取り/JSON.parseは引き続き残る。

### 12.3 検証時の作業ツリー

- 初回（起動UIの並行変更前）は直接の `tsc --noEmit` と
  `tsgo --noEmit -p apps/desktop/tsconfig.json`、全体Lint成功。
  `electrobun sync` を含む標準wrapperの再検査はしていない。
- 同じ時点の標準 `pnpm test`：880成功/0失敗。`pnpm test:ui`：12成功/0失敗。
- 一覧のSDK比較、セッション削除、SessionHost性能、pi-serviceの選択した統合検査：6成功/0失敗。
  統合suite全体の実行ではない。
- ディレクトリ削除時のmetadata解放の検査を追加した後、起動UI関連の並行変更も入った。
  全体単体の再検査は879成功/2失敗、さらに再実行で880成功/1失敗（881件）。
  最新の失敗は `chat-opening-navigation.test.ts` の起動フロー検査。
  型検査は `rpc.ts` のopenId型、Lintは起動関連ファイルのformat/import/finallyで失敗した。
  並行編集中のファイルは上書き修正せず、全体成功とは扱わない。
  キャッシュ/送信照合の対象14件はこの後の個別実行でも成功。最終の関連検査45件と、
  変更対象13ファイルのBiome検査も成功。UI全体の12成功は並行変更前の結果である。
- 検査項目・許容誤差を緩めて成功させたものではない。ただし過去のUI timeoutの恒久解消は断定しない。
- ログ：`%TEMP%/pig-derived-calculations-profile.log`、`pig-session-list-cache-profile.log`、
  `pig-list-and-derived-unit.log`、`pig-list-and-derived-unit-retry.log`、
  `pig-list-and-derived-ui.log`、`pig-list-and-derived-integration.log`、`pig-list-and-derived-targeted.log`。
- 実症状の会話での改善確認、長時間CPU/GC/heapの計測、インストール版との一致は依然未確認。
  ユーザーの稼働中セッションの再起動・更新はしていない。

## 13. 手動の履歴ボタンを廃止し、先頭付近で自動先読み

ユーザーの明示依頼により、履歴取得の操作を変更した。`use-history-paging.ts` の
IntersectionObserverが、先頭の約1画面手前（最低320px）で既存の履歴RPCを呼ぶ。
ページのサイズ・応答単位の境界・本文は従来のまま。取得済み履歴の破棄・仮想化はしない。
初期表示の末尾から全履歴を取得するのではなく、読む位置に応じて1ページずつ取得する。
会話領域はキーボードでもスクロール可能とした。

- 同じ表示のowner/revision/cursorへの要求を集約し、検索ジャンプとも共有する。
  先頭到達で停止し、進まないcursorや不一致のrevisionはエラーにして自動ループを防ぐ。
  古いbranch/epochやunmount後の応答は適用しない。
- エラーは既存通知に出す。会話内にローディング行・エラー行を挿入して高さを変えない。
  一度失敗した位置へ再接近、またはfocus/online復帰で再試行できる。
  先頭にいる場合も再度の上wheel/キー/タッチ操作で再試行できる。失敗直後の入力連打だけ500ms抑制し、通常の取得は遅延させない。
- `thread-anchor.ts` が、要求開始時ではなく反映直前の読む位置を記録する。
  全体のscrollHeight差だけで補正せず、同時に伸びた末尾の分を読み位置へ加算しない。
- 描画テストで、先頭追加後の遅い数式整形によって読む位置がずれるケースを再現した。
  追加後は表示中要素を一時的にアンカーとし、遅い上側の高さ変化を補正する。
  次のwheel/touch/pointer/key操作、検索ジャンプ、末尾への移動、branch変更で保持を解除する。
  通常のスクロールはpreventDefaultせず、操作後の古い位置への引き戻しもしない。

検査：

- `history-paging-ui.test.ts` を必須UI suiteへ登録。実Edgeのtrusted wheelで先頭到達前に取得開始し、
  RPC保留中もtrusted入力・wheelを処理すること、同じ要求が重複しないことを検査した。
- 100→150→200件の先頭追加で、既存DOM・選択・下書き・読む位置を保持。
  古いページの数式が整形された後も位置を維持し、その後のwheelと遅い上側の成長では
  アプリ側scrollTop書込0回とブラウザのアンカリングを確認する。
- エラー通知と再試行、全件到達時の停止、古いbranch/epochの応答破棄、進まないcursorの停止も検査。
  `thread-anchor.test.ts` は末尾同時成長の除外と、ブラウザ補正との二重書込防止を検査する。
- 個別の履歴・折り畳み・ペイン・検索のUI検査5件は成功。直接の型検査、全体Lint、単体886件も成功した。
- 初回の必須UI全体は12成功/4失敗。履歴RPCのオブジェクトキー順が従来と変わっていたため
  JSON文字列比較に失敗した点は、従来の順序を維持して修正した。残りはペイン/使用量の並行変更部分とtimeout。
  修正後のペイン・検索・履歴の個別再実行は成功した。
  会話全体fixtureの個別再実行は履歴250件の追加・位置保持まで通過したが、後半のツール注釈でtimeout。
  timeoutや検査項目・許容誤差は緩めていない。
  必須UIの再実行は15成功/1失敗（16件）。会話全体fixtureも全工程を通過し、通常スクロールの
  読む位置のdrift 0・アプリ側scrollTop書込0回、履歴250件の追加、選択/注釈/8行previewを確認した。
  この再実行の1失敗はタイトルバー単独fixtureのpage geometry検査だった。
  先頭での再試行操作の検査を追加した最終の必須UIも15成功/1失敗。自動履歴・ペイン・検索等は成功したが、
  今度は会話全体fixtureの後半scrollbar geometryでtimeout。全体UI成功とはまだ扱わない。
  最終の直接型検査・全体Lint・単体886件、およびBackendの読み取り専用履歴検査1件は成功した。
- 入力観測は約64〜65ms、ページ反映観測は約66〜83msでrunnerのpoll/frame待ちを含む。
  rAFの最大gapは最終の全体実行で約50ms、他の実行では約33〜300msまで観測した。これらは合成Edgeでの観測であり、
  実症状の会話の滑らかさや物理キー入力latencyを保証する値ではない。
- ログ：`%TEMP%/pig-auto-history-unit.log`、`pig-auto-history-lint.log`、`pig-auto-history-ui.log`、
  `pig-auto-history-transcript.log`、`pig-auto-history-focused-ui.log`、`pig-auto-history-ui-retry.log`、
  `pig-auto-history-ui-final.log`、`pig-auto-history-unit-final.log`、`pig-auto-history-lint-final.log`、`pig-auto-history-backend.log`。
- 未完了：実際の重い会話での連続した遡り・配信中wheel・長時間利用の計測。
  SDK起動に失敗した会話の閲覧では、ページごとのファイル全体再読込も従来どおり残る。
  インストール済みアプリへの反映・ユーザーセッションの再起動はしていない。

## 14. UX不変を優先した⑤・⑥・⑩の追加対応

### 14.1 ⑤：モデル境界の不要な生成だけを削減

再計測でもモデル境界・フッター・折り畳みの計算は10000件で平均1ms未満だったため、
履歴prefix用の汎用キャッシュは追加しなかった。`model-dividers.ts` は同じモデルの連続stepで
毎回Modelオブジェクトを生成せず、読み取り専用のラベルを計算中だけ共有する。
全履歴の順序を毎回確認する処理は残し、先頭追加・編集・並べ替え・branch・保存ID移行を末尾追記扱いにしない。

独立した変更前の計算と800通りを比較し、境界位置・provider/modelの値が一致した。
`profile-transcript-derivations.ts` の参考値では10000件・100回の平均が約0.223ms → 約0.159ms。
小さな改善であり、実会話全体の入力遅延改善率ではない。フッター等の全履歴走査は引き続き残る。

### 14.2 ⑥：Workerキューが保持する不要な元入力を解放

`render-worker-queue.ts` はpostMessageの構造化コピーが完了しても元入力をjobに保持していた。
また、起動待ち中にキャンセルしても、Promise executor内のcancelクロージャからrunのinput引数が
保持され続けることを、WeakRefと強制GCを使う検査で再現した。

- postMessage後・キャンセル時・失敗時にjobの元入力を解放する。
- cancel/cleanupのクロージャをrunの引数スコープから分離する。job.inputを空にするだけでは
  GC検査が失敗することも確認した。
- Workerに渡した本文全バイト、実行順、同時1件、待機/実行中キャンセル、古い結果の破棄を維持する。
  同期的なWorker生成例外もPromiseの拒否として返し、clone失敗時も全待機者を解放する。
- 転送済み入力はWorkerの計算中でも回収でき、キャンセル済み入力はWorker起動の完了前でも回収できることを検査。
  回収を待ってからWorkerの結果を返し、その結果と転送済みの独立したコピーが正しいことも確認する。

会話Snapshot・取得済み履歴・解析済みの表示キャッシュは捨てない。cache上限変更や自動session停止もない。
これはキューの不要な参照の解消であり、実アプリ全体のheap/プロセスメモリ削減量を測定したものではない。

### 14.3 ⑩：索引用の候補と、正確な部分一致を併用

`search-query.ts` を追加。必要な語だけの `LIKE ... ESCAPE` を必ず残し、全語の確認と
`ORDER BY ts DESC` の後に件数を制限する。未使用語に対応していた `LIKE '%'` は冗長なため除去する。
FTS MATCHへの置換や、リテラル記号の扱いを変えるESCAPE削除はしていない。

- 語の中から `%` / `_` を含まない3 Unicode codepoint以上の連続部分を選び、
  ESCAPEなしの必要条件LIKEを追加してtrigram索引で候補を絞る。候補は最大64 codepointに留め、全文の語は最終条件で確認する。
- NULを含む語からは候補を作らない。SQLite LIKEがNULで止まるため、後ろの部分を必要条件と決めつけない。
  短い日本語・記号だけの語など、安全なtrigram候補を確認できない場合は正確な全走査へ戻す。
- 初期案は頻出語でかえって遅くなったため、そのまま採用しなかった。既存FTSの語彙metadataを
  接続内TEMP語彙テーブルから参照し、先頭/末尾の最大2 trigramがどちらも広い場合は索引候補を使わない。
  件数は既存docsize metadataから取得・自分のinsert/deleteで更新し、本文を数え直さない。
  この情報は実行経路を選ぶヒントだけで、結果を絞る条件にはしない。
- 永続schema/version・索引に保存する本文は変更しない。旧version-1索引が再索引なしで利用できることも検査する。
- 旧SQLとの比較には、短い日本語、`%`/`_`/backslash/引用符、Unicode・NUL、全語AND、同時刻の順序、
  LIMITより後ろになりそうな古い真の一致、snippet・session/entry ID・ジャンプ先、再open/削除を含める。
  EXPLAINで希少候補の `VIRTUAL TABLE INDEX ... L0` と、頻出語の全走査への復帰を確認した。

`profile-search-query.ts` の10000メッセージ・約1KB/件・各20回の交互計測（Bun/SQLite in-memory参考値）：

| クエリ種別 | 旧SQLの平均 | 新SQLの平均 |
| --- | ---: | ---: |
| 希少語＋短い日本語 | 約16.86ms | 約0.39ms |
| リテラル記号を含む全語検索 | 約12.40ms | 約0.80ms |
| 全件にある頻出語 | 約38.79ms | 約30.96ms |
| 2文字の日本語 | 約14.86ms | 約13.78ms |
| 記号のみで一致なし | 約11.94ms | 約12.13ms |

返す行は旧SQLと一致。すべての検索が速くなるという保証ではなく、2文字検索は依然全走査。
時間は検索パレットの描画・IPC・実データのI/Oを含まない。

### 14.4 検証の切り分け

- 最終のtsc/tsgoによる直接の型検査、全体Lint、単体905件は成功した。
  SDKを使う `session-history.test.ts` の個別実行も1件成功した。
- 初回の必須UIは15成功/3失敗（18件）。会話全体fixture後半のscrollbar geometryのtimeout、
  ペインの本文再描画検査、使用量Popoverの検査が失敗した。
- ペイン検査はrecords配列へのアクセスを本文再描画の代用として数えていた。最新turnの状態を読む
  `interruptedSession` でも計数されるため、実際のmessage.contentへのアクセスへ計測を変更した。
  metadataだけを読む場合は0、明示的な本文読取は1となる正の対照も置き、再描画0の閾値は緩めていない。
- 修正後の関連UI6件（ペイン・自動履歴・折り畳み/コピー・検索・本番inline Worker）は成功。
  本番Workerで全文・数式・UI heartbeatを確認し、通常スクロール・選択・下書き・検索ジャンプの検査も維持した。
- 必須UIの最終再実行は17成功/1失敗（18件）。ペインと使用量Popoverは成功し、
  会話全体fixture後半のscrollbar geometryのtimeoutが残った。履歴・検索・コピー・本番Workerは成功。
  assertion・許容差・timeoutは緩めていない。この残件を解決するまで全体UIを成功とは扱わない。
- 現段階の結果をもって実会話での全症状改善や、全体UIの恒久安定を断定しない。
- ログ：`%TEMP%/pig-model-dividers-profile.log`、`pig-search-query-profile.log`、`pig-search-query-profile-final.log`、
  `pig-safe-optimizations-unit.log`、`pig-safe-optimizations-lint.log`、`pig-safe-optimizations-ui.log`、
  `pig-safe-optimizations-focused-ui.log`、`pig-safe-optimizations-unit-final.log`、
  `pig-safe-optimizations-lint-final.log`、`pig-safe-optimizations-ui-final.log`、
  `pig-safe-optimizations-history-backend.log`。

## 15. ⑪の分割索引と、①・②の事前互換性検査

### 15.1 ⑪：読込から登録までを分割

従来はJSON.parseのloopだけに8ms予算があり、その前にファイルの残り全量をBuffer化・UTF-8 decode・
改行splitしていた。SQLite登録も、解析で集めた行を1 transactionでまとめて処理していた。

`search-jsonl.ts` / `search-index.ts` の対応：

- 本文は最大8MiB単位で読み、完全なLFに到達した行だけを扱う。旧文字列prefilterと等価なbyte検査で
  対象外のtool出力はdecode自体を省く。UTF-8の途中・CRLF・短いreadを扱い、未完了行は次回へ残す。
  保持量はファイル全量でなく、read chunk＋最長の単一JSONL行＋登録待ちの本文が基本となる。
- 正規化後の登録待ち本文は約256KiB/128 actionまで。無視するtoolResultの連続区間はcheckpointだけにまとめ、
  raw JSONを登録待ちに保持しない。最初の小chunk案では過剰なI/O/checkpointで遅くなったため、そのまま採用しなかった。
- decode/解析とSQLite登録の両方で8msを目安に制御を返す。登録loopも1行ずつ時間を確認する。
  Windowsで粗くなるsetTimeout(0)は使わずsetImmediateでI/O loopへ戻る。長い行の途中でもtimerが処理される検査を置いた。
  **単一の巨大JSON.parseやFTSの1行登録は割り込めないため、最大停止8msを保証するものではない。**
- 行と、直後の絶対バイトoffset・64byte tailを同じtransactionで保存する。中断・I/Oエラーの後も
  確定済みprefixから再開し、登録済みentryを再登録しない。
  未検証の進捗はsize=-2で識別する。再開時に元のstampが変わっていれば捨て、reopen時も未検証行を公開しない。
  I/Oエラー時は元ファイルが不変と確認できたprefixだけを再開可能にし、書換え＋中断＋再開で新旧本文を混ぜない。
- refreshの新世代・保存先変更・forget・close後は古い処理を反映しない。forgetはroots取得待ちや
  queued follow-upにも有効で、run終了後はtombstoneを保持しない。古いroots取得の失敗で最新要求を捨てない。
- 同名置換・縮小・同サイズ書換えはファイルidentity/ctime・header・tailから検査する。
  版1の既存索引を再構築せず、任意の追加metadataテーブル `file_identity` を遅延補完する。
- 読込中にサイズが増えた場合、読んだ固定範囲のhashとheaderを再検査して通常の追記と書換えを区別する。
  読込開始後の追記は次回の対象とし、変わったfileは最大1回だけ再試行する。

appendの高速経路には元からのtail方式の検出限界がある。同一inodeで、過去に読んだ中間部だけを
書き換えて同時に追記し、headerとcheckpoint tailを残すような任意の外部改変に対して、過去prefix全量を
毎回hashし直してはいない。任意の改変を完全検出する保証とは扱わない。

検査は `search-jsonl.test.ts` / `search-index-streaming.test.ts` / 既存の検索SQL比較。
1〜80byteのchunk・短いread、UTF-8境界・CRLF・未完了行、同名置換・同サイズのmtime復元書換え、
増大する書換え・header変更、削除・forget・roots変更・close、中断再開、単一chunkより大きい行の全文を含む。
検索の本文・順序・snippet・session/entry IDは変更しない。SDK履歴取得・会話キャッシュも変更していない。

参考計測（`profile-search-indexing.ts`、6000 record / 約29MB、うち検索対象600件）：
変更前の1回は全体約92ms・最大timer gap約54.5ms。途中には約135ms・最大6.7〜12.7msというrunもあったが、
反復中の負荷・Windowsのtimer粒度で値が大きく変動した。最新2回（byte prefilter/8MiB chunk）は全体約226〜233ms・
最大timer gap約16.2〜45.5ms。**同一負荷のpaired計測ではなく、一定の改善率やスループット向上は報告しない。**
索引完了までの時間は増え得る。会話履歴の取得経路は変更せず、低速ディスク・大量ファイル・巨大1行は引き続き要計測。
heap/RSSのtimer samplingは停止中の一時peakを逃すため、メモリ削減量の根拠にはしない。

`profile-session-indexing.ts --current-session` でも、現在の会話の読み取り専用コピーを一時索引へ投入した。
約6.35MB・721行・検索対象44件が全文oracleと一致し、参考値は約43.5ms、最大timer gap約8.3ms。
元の会話は変更せず、コピーと一時DBは削除した。本文やIDはログへ出していない。
**症状が出ていた特定の会話や、インストール済みWebViewのスクロール性能を測ったものではない。**

### 15.2 ①：単純な行統合は実装しない

`render-reuse-ui.test.ts` で、同じ色のspanを1つにまとめて追記する候補を実ブラウザで検査した。
全文・改行は同じでも、既存text nodeの全体置換で選択と注釈用Rangeが失われた。
独立した既存行は同じ操作でも選択・Rangeと位置を維持した。診断結果は
`existingLinesPreservedRange: true` / `naiveLiveMergePreservedRange: false`。

ユーザーの「確認後、問題なければ実装」に従い、この統合は本番へ入れない。
完成時だけ切り替える方式も、その瞬間の選択を壊し得るため無条件には採用しない。
既存のtokenRuns/大きなplain terminalの集約はそのままにした。①の追加削減は未実装。

### 15.3 ②：同じ解析済みtreeの後処理だけ再利用

解析cacheがあっても、同じHASTの親再描画でReactMarkdownの後処理・JSX生成が再実行されていた。
数式100個＋table/code/linkのfixtureで、参考値約30.3ms・tree getter参照1664回を観測した。
変更前にDOM・選択・Range・URL安全処理・拡張Renderer切替の互換性を確認してから、
`MessageContent.tsx` の `MarkdownTree` をmemo化した。

変更後は同じ参照の親再描画で約0.3ms・tree参照0回。異なる入力は新しいtreeへ進み、
各mountのDOM/stateは独立したまま。既存の解析cacheの容量や保持期間は変えていない。
画像Viewerの開閉・同一DOM/state、子の言語購読、nested image RendererとMarkdown Rendererの切替も検査する。
一般的な増分Markdown cacheや、別メッセージのJSX/DOMを共有するcacheは追加しない。

### 15.4 UI検査のtimeoutと前提条件

段階別計測で、タイトルバー検査だけで約12.8秒、後続のMarkdown等の区間で約12.2秒を使い、
多数の検査を追加した会話fixtureが35秒制限を使い切っていることを確認した。
タイトルバーの実Chat検査を既存の専用testへ移し、元と同じ1100×800 viewport、全6通り、
各10frame、35msの待機・hover保持時間・assertionを維持した。会話側は全スクロールバー検査を維持する。

共通browser driverも、about:blankでCDP接続後にviewportを固定してからfixtureへnavigateする。
会話driverにはあったこの処理が共通driverになく、Edgeの遅いautomation infobarでページ全体の高さが変化し得た。
DOMContentLoadedをloader IDで待ち、about:blank作成で残るbrowser chromeのfocusはPage.bringToFrontで解消する。
ユーザーのブラウザprofileには接続しない。timeout・許容差・検査対象を減らす修正はしていない。

ログは `%TEMP%/pig-indexing-*.log`、`pig-transcript-timing.log`、`pig-transcript-separated.log`、
`pig-render-reuse-before-measured.log`、`pig-render-reuse-after.log`。

### 15.5 最終検証

- 直接tsc・tsgo・全体Lintは成功。最終の標準単体検査は952成功/0失敗。
- 索引の境界・復旧・全文一致とSDK履歴の個別検査は37成功/0失敗。
- 必須UIの直近全体は23成功/0失敗。タイトルバー・全スクロールバー・ペインfocus・履歴・コピー・検索・
  本番Worker・Markdown再利用を含む。以後の追加修正はBun側の索引処理・検査のみで、描画codeは変更していない。
- 途中の全体検査ではisolated renderer/ChatOpeningの5秒timeout、並行追加中のgrep fixtureのimportエラー、
  about:blank切替後のfocus前提不足が出た。最終の型検査・単体は再実行で成功し、focusは共通driverの
  Page.bringToFrontで修正後、ペイン単独と全体UIで成功した。assertion・timeoutを緩めていない。
- インストール済みアプリへの更新・ユーザーsessionの再起動はしていない。問題の特定会話での連続操作・
  長時間heap/GC/入力遅延の実測は未完了で、全症状の解消とは扱わない。
- ログ：`pig-indexing-typecheck-complete.log`、`pig-indexing-tsgo-complete.log`、`pig-indexing-lint-complete.log`、
  `pig-indexing-unit-last.log`、`pig-indexing-recovery-verified.log`、`pig-indexing-ui-latest.log`、
  `pig-indexing-bounded-final-1.log`、`pig-indexing-bounded-final-2.log`。
