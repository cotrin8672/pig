# リソース保持・差分配信・数式ストリーミングの実装方針

状態：**共有キャッシュ容量制限・数式の配信表示・metadata差分を実装済み**。
履歴専用起動・自動休止は未実装。
全体UIは45成功／0失敗で完走した。全unitには既存の一覧metadata検査の失敗が残る。
実装内容と検証の内訳は第7節を参照。

対象は、ユーザーが指定した次の4点に限る。

1. 構文ハイライトの共有キャッシュに容量予算を付け、未使用分から解放する。
2. 履歴閲覧とSDK起動を分け、一定時間使われていない停止済みランタイムを休止する。
3. 不変のレコード情報・完了済みツール状態も差分配信する。
4. 数式の配信中に、組版済み表示と生TeXが交互に現れる現象をなくす。

SDK 1.5.2と調査時点の作業ツリーを対象にした。関連ファイルには既存の未コミット変更がある。
特に `ClientHub` / `rpc.ts` / `runtime-sync.ts` は、再接続とpublication順序の変更が進行中。
実装開始時に最新の契約・テストを再確認し、これらを巻き戻さない。

## 1. 変更しない契約

- 会話・ツール出力を切り捨てない。取得済み履歴の仮想化・自動破棄は今回の対象外。
- 送信頻度や本文の既存100ms samplerを、単に遅くして負荷を隠さない。
- 選択、コピー、注釈Range、下書き、IME、スクロール位置を維持する。
- promptの自動再送、結果不明の送信の推定成功・推定拒否をしない。
- 差分の不整合時は現在の表示を保ち、権威ある完全Snapshotへ戻る。
- プロジェクト・アカウント・Trustの境界を維持する。休止からの復帰で権限を引き継いだと推測しない。
- 本文・認証情報を性能ログへ出さない。件数・推定bytes・時間・状態だけを測る。
- Composer下の状態メッセージ、新しいローディング行、表示高さの予約を追加しない。

## 2. 構文ハイライトの共有キャッシュ

### 現状と注意点

対象：

- `apps/desktop/src/mainview/syntax-highlighting.ts`
- `apps/desktop/src/mainview/HighlightedCode.tsx`
- `apps/desktop/src/mainview/render-worker-queue.ts`

現在は最大32件で、容量制限がない。独立Edgeの解析のみの試験では、約7.8万文字・
1,500行のコード32種類で、GC後のmain-thread JS heapが約10MiBから166MiBになった。
40種類ではほぼ頭打ちで、無制限リークという証拠ではない。

`Cached.users` はPromiseを待っている人数で、解決時に減る。
**これを「現在画面に表示している人数」と解釈してはいけない。**
表示中のtokensは `useHighlightedLines` のstateにもあり、共有キャッシュの解放とは別である。

### 方針

- 32件制限を残し、推定容量にも予算を付ける。初期候補は**16MiB/ウィンドウ**。
  これは共有キャッシュの推定値であり、プロセス全体や表示中データの上限ではない。
- source/key、行配列、tokenオブジェクト、文字列を保守的に見積もる。
  実ヒープと完全一致する値とはせず、既存の大きいfixtureで過小評価を検査する。
- 挿入時だけでなく、解析完了でtokensが増えた時にも予算を再評価する。
- 未使用の完了済みentryを優先し、その中で最近使われていないものから外す。
  単独で予算を超える結果は呼出元へ返すが、再利用キャッシュへ残さない。
- 解析待ちの共有と、完了結果の保持を区別する。キャッシュから外すだけで、
  利用者が残るWorker要求をキャンセルしない。同じ入力のin-flight共有も壊さない。
- 表示利用の把握が必要な箇所は、effectの取得からcleanupまでのleaseにする。
  Promiseの待機人数とは分離し、unmount・入力変更・失敗で必ず解放する。
- 全entryが表示利用中でも、予算を守るため共有索引から外してよい。
  呼出元のtokens、色、DOMは消さず、予算のために再描画や解析を強制しない。
- Markdownキャッシュ、Workerの同時実行数、構文checkpoint、色・token形式は一緒に変えない。
  新しい汎用キャッシュ基盤や依存は追加しない。

### 受け入れ条件

- 小さい入力は従来どおり共有し、同じ入力・言語aliasの重複解析を防ぐ。
- 大きい入力、解析中のeviction、最後の利用者だけのcancel、古い完了結果、
  失敗・Worker再生成でも、容量集計と利用者数が壊れない。
- キャッシュ解放後も表示中の全文・既存色・DOM・選択が変わらない。
- 消費者を外した独立EdgeでGC後の保持量を比較する。
  RSSが即座に下がることや、アプリ全体が16MiBになることは合格条件にしない。

## 3. 数式のストリーミング

### 再現できた原因

対象：

- `apps/desktop/src/mainview/markdown-engine.ts`
- `apps/desktop/src/mainview/markdown-processing.ts`
- `apps/desktop/src/mainview/MessageContent.tsx`
- `apps/desktop/src/shared/math.ts`
- `apps/desktop/src/mainview/ChatLayout.tsx`

`rehype-katex` が別行数式を変換すると、生成されたトップレベルの
`.katex-display` に元Markdownの `position` が残らない。
`retainedMarkdown()` はpositionを根拠に不変ブロックを残すため、
**閉じた数式の後ろへ文章を追加しただけでも、その数式を保持できない。**
解析待ちに元の数式を含む生テキストへ戻り、完了時に組版し直す。

独立Edgeで本番 `Markdown` とCSSを使い、Workerを意図的に保留した再現：

| 状態 | 組版済み数式 | 元の数式DOM | 本文高さ |
| --- | ---: | --- | ---: |
| 初期、閉じた数式 | 1 | 接続中 | 約68px |
| 後ろに段落を追加、解析待ち | 0 | 切断 | 約174px |
| 解析完了 | 1 | 別DOM | 約103px |

この値は最小fixtureの形状で、実WebViewの遅延測定ではない。
ただし、完成した数式が一度消える経路はブラウザでも確認できた。
inline数式を段落ごと保持できるケースでは同じ現象にならなかった。

### 第1段階：表示済み数式を戻さない

- KaTeX変換前の数式scopeのsource範囲を、変換後の外側ノードへ引き継ぐ。
  生成HTML内のoffsetを元Markdownのoffsetとして使わない。
- 同じsource範囲・内容の完成済み数式は、解析待ちでも元のHASTとDOMを保持する。
  新しい追記だけを従来のescaped textで表示する。
- display/inline、`$` / `$$` / `\(` / `\[`、math fence、無効TeXを確認する。
  `normalizeMath()` は閉じた時点でsource長を変えるので、正規化前後の位置を混同しない。
- 編集・削除・別sourceへの置換では古い数式を残さない。
  異なるメッセージ間でJSXやDOMを共有しない。

この修正は表示内容・更新間隔を変えず、最初に行う。

### 第2段階：書きかけの数式を安定させる

- `$$` の数式は未閉鎖でもEOFを終端として組版され得る。
  「今のASTに数式がある」だけで、確定済みとは判断しない。
- 配信中の未完成式は、最新sourceを同じ領域に一定の方式で表示し、
  文字ごとの不完全な組版と生TeXを往復させない。
  閉じた式から組版し、完了・停止時は既存の全量解析結果へ確定する。
- 閉じ判定は既存パーサーの構文・source範囲に基づく。
  `$` の偶数判定や、単純な正規表現でのMarkdown分割は採用しない。
  escape、コード内の記号、リスト・引用内の数式も区別する。
- 後置リンク定義・脚注・表等は後続入力で前方の意味が変わる。
  文書全体の解析を保ち、独自の増分Markdownパーサーへ置き換えない。
- 未完成式の表示方式は試作で確認する。先に確定済み表示の退行を直し、
  途中の内容を隠す案、全文を終了まで待たせる案、点滅をfadeで隠す案は採用しない。

### 第3段階：同じ数式の組版をやり直さない

第1段階後に、数式が多い応答の解析・転送・React commitを分けて測る。
まだKaTeXが支配的なら、Worker内で同じTeX・displayMode・設定の組版結果を再利用する。
既存Markdown全文キャッシュとは別に追加する場合も、ノード数・推定bytesで小さく制限する。
macros等の状態依存はキーに含めるか再利用対象外にし、安全なURL処理を維持する。
この最適化を新しい巨大キャッシュにしない。

### 受け入れ条件

- Workerを保留し、確定済み数式のDOM・選択・注釈Rangeが全frameで残る。
- 新しい数式が原因で、以前の数式のある領域の高さが一時的に膨らまない。
- 書きかけの分数・行列・align、複数式、低速Worker、訂正・短縮、
  停止・完了・エラー・再生成の最終表示を従来の全量pipelineと比較する。
- フォント読込後の変化、末尾追従、途中を読む位置、ユーザーのwheel/keyboard操作、
  IME入力を実Edgeとnative WebViewで検査する。
- 単なる解析時間だけでなく、数式DOMの脱落回数、不要な高さ変動、
  最終表示までの遅れ、入力応答を測る。

## 4. 本文以外の差分配信

### 現状と落とし穴

対象：

- `apps/desktop/src/bun/sdk-projector.ts`
- `apps/desktop/src/bun/snapshot-delta.ts`
- `apps/desktop/src/bun/client-hub.ts`
- `apps/desktop/src/shared/snapshot-delta.ts`
- `apps/desktop/src/mainview/rpc.ts`
- `apps/desktop/src/mainview/runtime-sync.ts`
- `apps/desktop/src/mainview/chat-snapshot.ts`

本文とlive textの追記差分は既にある。一方、record envelope、順序、toolsは毎回届く。
envelopeは保存済みでも不変ではない。保存時に過去recordの `branchId` が更新され、
`order` / `requestId` / optional fieldの削除も意味を持つ。
`done` のtoolでも拡張の表示用resultやmetadataが変わり得るため、statusやIDだけで固定しない。

さらに、UIのrecordsには明示取得した古い履歴が混ざる。
**現在の表示records全体を、直前に受信したtailと同一視してはいけない。**

### 方針

- 既存の完全Snapshot経路を残し、wire形式だけを小さな段階で拡張する。
  最初は完了tool状態の差分、次にrecord envelopeと順序へ進む。
- toolは変更分と権威あるID集合を送る。集合からの除外で削除を表し、変更resultは完全置換を基本にし、
  既存のcanonical result参照とrunning出力の追記差分を維持する。
- recordは変更envelope・追加record・権威あるID順序を送る。順序列からの除外でtailの削除を表す。
  順序列が同じなら省略し、変わる場合はまず完全なID列を送る。
  初めから任意の配列編集言語や複雑な圧縮方式を作らない。
- optional field削除をmergeで取り逃さないよう、変更envelopeは完全置換する。
  branch変更・並べ替え・tail境界変更を単純な末尾追記と見なさない。
- 直前のwire tailのID列と基底を、表示用の履歴結合から分離する。
  tailから外れたrecordと、会話履歴から本当に削除されたrecordも区別する。
- 新しい省略には `hostId/sessionId/epoch`、履歴revision、正確な基底sequenceを要求する。
  不足・不正な参照・重複ID・順序不整合は全パケットを不採用にし、完全復旧する。
- windowごとの基底を維持する。`publicationSeq` はRootのイベント順序、
  `snapshotSeq` はsessionのSnapshot、wire基底は実際の受信済みtailであり、
  同じ番号と仮定しない。追加のwire frame番号は必要性を確認してから決める。
- 完全RPC読取・runtimeState・reconnect・page reload・休止/復帰では基底をリセットする。
  `RuntimeSync` のstate読取境界と、その前後の通知・terminal・所有者移行の順序を維持する。
- 送信側は最新1世代の必要なmetadata/IDだけを保持する。
  SDKの可変オブジェクトをそのまま基底にせず、版または所有済みの値を使う。
  既存projectorのimmutableな共有は活用するが、大きいresultの全量コピーや
  JSON化をクライアントごと・更新ごとに増やさない。

### 受け入れ条件

- 各更新後の全フィールドを、差分なしの完全Snapshot経路と比較する。
- toolのstatus/result/metadata変更・削除、recordの追加・削除・並べ替え、
  field削除、保存ID移行、branch/epoch変更、履歴prependを含む。
- 欠落・逆順・重複、復旧RPC中の更新、連続配信中のreconnect、複数windowを検査する。
  自動prompt再送・自動再openは0回とする。
- 2,000件の既存fixtureで、本文が少し増えただけの更新に比例したパケットへ近づける。
  bytesだけでなく、encode・復元時間・保持量も比較し、差分化でheapを増やさない。

## 5. 履歴閲覧とランタイム起動の分離・自動休止

### 単純なcloseでは実装しない

対象：

- `apps/desktop/src/bun/session-host.ts`
- `apps/desktop/src/bun/session-files.ts`
- `apps/desktop/src/bun/composer-bridge.ts`
- `apps/desktop/src/bun/sdk-send-receipts.ts`
- `apps/desktop/src/bun/ui-request-broker.ts`
- `apps/desktop/src/bun/app.ts`
- `apps/desktop/src/shared/runtime-contract.ts`
- `apps/desktop/src/mainview/rpc.ts`
- `apps/desktop/src/mainview/runtime-events.ts`
- `apps/desktop/src/mainview/draft-store.ts`
- Pane・Composer・送信・選択変更・履歴取得の各呼出元

`closeSession()` / `destroy()` は、キュー回収、UI取消、draftのretire/remove、
SDK終了、session削除を行う。UIも `closed` でSnapshotを外すため、休止への流用は危険。
`ready: false` も現在は起動中previewを意味するため、休止に流用しない。

SDKの `AgentSessionRuntime.dispose()` は `session_shutdown(reason: quit)` を発行し、
認証更新の保存完了も待つ。SDK 1.5.2に任意拡張のメモリ状態を保存する汎用休止APIはない。
**ここでの休止は、無停止のpauseではなく、SDKを終了して後で再構築するcold suspensionである。**

### 段階A：まず履歴だけ開けるようにする

- 検証済みsession fileを `readSessionFile()` で読み、SDK・resource discovery・
  拡張・MCP・モデル環境を起動せず履歴を表示する。閲覧のためにファイルを修復・変更しない。
- 閲覧状態と実行状態を別に持つ。履歴、タイトル、下書きのownerを保つ軽量handleと、
  必要な間だけ存在するlive runtimeを分離する。
- 単に閲覧・スクロール・検索しただけではruntimeを起こさない。
  初回送信、拡張コマンド等の本当にSDKが必要な操作で、1つに集約した起動へ進む。
  モデル変更・effort・fork/rewind・draft操作も必要性を分類する。
- Composerの `listSlashCommands` 等のeffectで、閲覧直後に結局SDKを起こす経路をなくす。
  外部拡張に依存する補完は、実行環境がある場合の取得と明示操作での起動を区別する。
- 下書き同期をruntimeの有無から独立させる。初回送信時も、最新のCAS revisionと
  確認済み画像・添付を使い、起動前の本文を後から上書きしない。

### 段階B：非表示・停止済みruntimeを休止する

暫定候補は**全windowで未使用かつ安全な停止状態が5分継続**。最終値は計測後に確定する。
`agent_end` ではなく、settled hookまで終わった状態から判定する。

自動休止の除外条件：

- どれかのwindowのPaneで使用中。非アクティブPane・非フォーカスwindow・最小化中も保護する。
- SDKのstreaming、tool実行、compaction、retry、settled hook、拡張コマンド、
  adapter処理、画像準備、起動、reload/モデル変更等の操作が残る。
- 承認・入力要求・terminal、送信受付中、Steering/follow-up、
  未確認send intent、復旧待ちがある。
- 下書きに本文・paste・画像・ファイル・注釈がある、保存未確認、競合、
  読込中添付・送信/CAS flightがある。初期実装は非空下書きを休止対象にしない。
- 拡張の独自バックグラウンド処理の有無や、終了後の再構築安全性が不明。

windowごとのPane使用・ローカル入力保護をRootの接続leaseと結び付けてHostへ通知する。
フォーカス中の1チャットだけでは判断しない。通知には世代を付け、
遅れた古いwindow通知で使用中の保護を消さない。heartbeat欠落だけで安全と推定せず、
状態不明なら保護する。nativeなpage close等で確定した解放は反映する。

休止候補の選定後、既存の直列化と同じ境界で全条件を再確認し、
新規操作の受付と休止開始を排他的にする。休止中に開く/送る操作は復帰へ合流させる。
プロセスごとのtimerは増やさず、Hostに1つの低頻度sweeperを置く。
単なるstatus更新で永久に休止が延期されないよう、実作業・保護状態を基準にする。

### 段階C：終了・復帰・障害

- SDKの正式なshutdown/認証書込待ちを通す。子プロセスを外から一律killしない。
  未知の子プロセスを「全部MCP」と推測しない。
- 終了後はmanager全tree、projector、resource loader、adapter、購読、timerへの
  強い参照を軽量handleから外す。大きい閉鎖時SnapshotをHostに複製して残さない。
- UIの会話・スクロール・下書きを `closed` として消さない。
  休止状態をruntimeStateにも含め、再接続で「消えたsession」と扱わせない。
- 復帰時は同じsession IDを検証済みファイルから開き、外部追記・枝変更も確認する。
  新しいepochを発行し、draft等の移行は既存の明示transfer規則を使う。
  古いepochのcallback・応答・差分を復活させない。wire基底は完全Snapshotで再確立する。
- 復帰要求は集約するが、送信自体は各request IDで一度だけ受け付ける。
  結果不明の旧送信を新epochへ自動再送しない。
- cleanup失敗・timeoutでは休止完了を宣言せず、既存のquarantine方針を守る。
  失敗したruntimeを二重起動せず、履歴を閲覧可能なまま通知する。

### 自動休止を有効化する前の必須確認

任意拡張の独自timer・サブエージェント・MCPの仕事は、現在の
`isStreaming` / `AdapterRuntime.busy` / brokerだけでは全て観測できない。
拡張の一時メモリまで保持したまま再開できるとは約束しない。

そのため、まず隔離fixtureでshutdownと再起動を調べる。休止可否を観測できない拡張は
保護側へ倒し、必要な場合だけkeep-alive/vetoの契約を検討する。
context-modeについても、実行中処理・background指定・子プロセス終了を別途確認する。
**この確認前に全拡張へ一律の自動休止を有効にしない。**

受け入れ試験はfake clockで境界・再表示・新規送信との競合を作り、
複数window、下書き、送信受付、承認、terminal、OAuth書込待ち、cleanup失敗、
外部ファイル変更、再接続、複数回の休止/復帰を含める。
一時profileの子プロセスfixtureで終了を確認し、実利用中のアプリを止めて試さない。

## 6. 実装順と検証

| 順序 | 単位 | 完了条件 |
| --- | --- | --- |
| 1 | ハイライト共有キャッシュの容量予算 | 保持量比較＋既存表示/Worker契約維持 |
| 2 | 数式位置情報の保持 | 完成済み数式が解析待ちに消える負例を回帰テスト化して解消 |
| 3 | 未完成数式の安定表示、必要なら組版再利用 | 最新source・最終組版・入力・スクロールを維持 |
| 4 | 完了tool、次にrecord envelope/順序の差分 | 各更新の全量oracle、復旧・複数window・保持量検査 |
| 5 | 履歴専用handleと必要時起動 | 閲覧だけのSDK/MCP起動0、送信/下書き/権限保護 |
| 6 | 安全性を確認したruntimeの自動休止 | 全除外条件と終了・復帰fixture、native長時間確認 |

各単位を独立した変更にし、キャッシュ・通信・lifecycleを同時に全面改造しない。
UI/SDK動作を触る段階では型検査・Lint・unit・関連integrationに加えて
`mise exec -- pnpm test:ui` を実行し、`docs/ui-guidelines.md` の関連契約も更新する。
「遡る再解析待ちを増やすな」という既存規則については、
表示中結果の保持と未使用の共有cacheの容量制御を明確に分けて記述する。

### 実装前の調査で実行したもの

- 上記の数式保持を調べる最小pipeline probeと、独立Edgeの保留Worker fixture。
  未閉鎖式と、完成済み式の後ろへの追記を分けて確認した。本体修正後の試験ではない。
- 既存のcache/Markdown/Worker queue/delta/ClientHub/reconnect/recoveryの8ファイルを
  別プロセスで実行。最終の個別実行は計43件成功。
  RPC差分fixtureは初回に外側の5秒timeoutで失敗し、同じ条件の単独再実行で成功した。
  閾値を緩めておらず、安定性解消の証明とはしない。
- LSP referencesはserverが応答せず利用できなかったため、実ソース・依存ソース・
  呼出元検索・上記実行結果で調査した。全体の型検査・全unit/UI suiteは今回は未実行。

未確認：任意拡張の休止互換性、context-modeの全background処理の安全な終了、
症状発生中のnative WebViewのCPU/GC/合成内訳。今回の方針だけで画像のメモリ全量や
数式配信中の全遅延が解消すると断定しない。

## 7. 実装済みの段階と検証

### 実装範囲

- `mainview/highlight-cache.ts` に構文専用の容量管理を分離し、
  `syntax-highlighting.ts` から使用。32件・推定16MiB、未使用優先LRU、
  完了時の容量評価、単独で予算を超える結果の非保持を実装した。
  in-flight共有は別に保持し、利用者のsignalはPromise解決後もeffect cleanupまで追跡する。
  表示中結果の共有索引からのevictionは、呼出元のtokensやDOMを消さない。
- `mainview/positioned-katex.ts` は既存のKaTeX変換を使い、完成した数式scopeの
  元Markdown位置を生成ノードへ引き継ぐ。閉じ判定はパーサーが識別したscopeに限定し、
  EOFの未閉鎖数式・math fenceを完成済みとして保持しない。
  `markdown-engine.ts` でこの変換を使用し、最終的な組版・URL安全処理は従来どおり。
- 配信中の未閉鎖display数式はKaTeXへ渡さず、同じliteralノードに最新sourceを表示する。
  Worker保留中も複数行の追記を反映し、以前に完成した数式のDOM・高さは保持する。
  閉鎖・停止・完了は通常の全量pipelineへ確定する。配信中／確定でcache keyと
  Worker要求を分け、遅い旧結果の採用を防ぐ。拡張Rendererの `{ text }` 契約は変えていない。
- `bun/snapshot-delta.ts` と `shared/snapshot-delta.ts` を拡張した。
  変わらない保存済みenvelopeはレコード参照、変わったenvelopeは全置換、
  完了toolはcanonicalな保存済みresultと正確なwire metadataが一致する場合だけ参照する。
  status・metadata・optional field削除、異なる拡張出力は引き続き反映する。
  全順序が同じ場合は変更行だけを送信し、順序変更時は完全なID／行の列を送る。
  toolの集合が同じ場合も変更状態だけを送り、集合変更時は残す参照IDを明示する。
- 新しい省略にはowner・epoch・history revision・正確な直前sequenceを要求する。
  `shared/transcript-wire.ts` はwire tailの件数とtool IDをWeakMapで記録し、
  `chat-snapshot.ts` / `transcript-sharing.ts` の履歴結合でもその基底を引き継ぐ。
  UIにprependされた古い履歴をwire基底に混ぜず、不足・不正・重複は全量復旧へ戻す。
  送信側は最新1世代のID・scalar envelope・比較用metadata・live textだけを保持する。
  完了toolの比較用metadataは1件4096文字以内・合計推定512KiB以内に制限し、
  大きいmetadataは比較途中で打ち切って完全送信する。本文・SDKオブジェクトは保持しない。
- `highlight-cache.test.ts`、`markdown-processing.test.ts` に容量・lease・
  競合・不完全数式・全量pipelineとの一致の検査を追加した。
  `render-retention-ui.test.ts` をUI suiteへ登録し、実Edgeでの保持を検査する。
- `docs/ui-guidelines.md` に共有キャッシュの予算、数式表示、wire基底の契約を追記した。
  この段階では画面レイアウト・CSS・送信頻度・Worker並行数・SDK lifecycleは変更していない。

### 保持量の参考比較

調査時と同じ独立Edge・本番ハイライト処理を使い、約7.8万文字・1,500行のコードを
32種類解析した後のGC済みmain-thread JS heapを比較した。
画面にはコードをmountせず、単なる共有結果の保持を測っている。

| 条件 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 初期 | 約10.2MiB | 約10.2MiB |
| 32種類を解析後 | 約166.4MiB | 約15.1MiB |
| 変更後40種類まで増加 | — | 約15.1MiB |

この比較は別実行であり、実WebViewの総メモリ、表示中tokens、
Worker自身のheap、GPU領域やRSSの削減量ではない。予算の16MiBも推定値である。

### 差分転送の参考比較

`scripts/profile-conversation-pipeline.ts` のオフラインBun fixtureでは、
2,000件の保存済みrecordの後ろへ1文字ずつ追記する更新が、
既存の本文差分だけでは約398KiBだったのに対し、metadata・順序差分では約902bytesになった。
最終計測の平均はencode約6.8ms、JSON decode約0.013ms、復元・共有・履歴保持約2.0ms。
以前の復元・共有・履歴保持は約6.5〜10.4msだった。別実行の参考値であり、性能保証ではない。

通常80件、1MiBのlive本文、1MiBのrunning tool、10,000件の取得済み過去履歴の
各fixtureも全フィールドの完全Snapshot oracleと一致した。過去履歴は本番の
`prependHistory()` 経路で作り、基底を失う独自の履歴結合では測らない。
これはアプリケーションpayloadの合成測定であり、SDK projection、外側のRPC、
Windows転送・JS compilation、React・layout、native WebView総メモリは含まない。

### 検証結果と残件

- 標準 `mise exec -- pnpm typecheck`、`mise exec -- pnpm lint` は成功した。
  LSPは利用不可だったため、空の診断結果をcleanの根拠にしていない。
- 差分・history保持・ClientHub・実RPC・reconnect/recoveryの関連10ファイルは
  最終56成功／0失敗。保存済み本文・配列・tool/resultオブジェクトのGCも検査した。
- 全unitの最終結果は `PIG_TEST_WORKERS=2` で**184ファイル・1144成功／1失敗**。
  失敗は変更前の段階でも発生した `session-list-cache.test.ts` の同一size/mtimeでの
  metadata書換え検査（`Edit name` を期待して `New title`）。単独11件は成功するが、
  全体の再試行でも同じ失敗が残った。全unit成功とは扱わず、検査や閾値も緩めていない。
- 新しいEdge fixtureでは、`$$`・`\[`・math fenceの3ケースについて、
  Worker保留・複数回の追記・確定を通じて各31frameで元の数式DOM・高さ・選択Rangeを保持した。
  共有cacheから表示中結果が外れた後も、全文・色・DOM・選択を保持した。
  未閉鎖式の逐次追記・改行、閉鎖／停止での全量pipeline一致、遅い旧結果の破棄も検査した。
- 最初の必須UI全体は39成功／2失敗。独自RPC stubを持つ会話・検索fixtureに、
  既存の送信API `pendingSteering` が欠けていた。
  共通fixtureと同じ空キューのstubを2か所に補い、assertionは変更していない。
  修正後の会話・検索の個別再実行は8成功／0失敗。
- 第一段階末のUI全体再実行は、各ケースの実行時間が大きく延び、420秒の外側の実行制限で中断した。
  titlebar fixtureの60秒timeoutも記録された。原因は未確定。
  残った今回の試験プロセスtreeだけを終了し、利用中アプリや他の試験は終了していない。
  この中断分を全体成功とは扱わない。
  中断した実行のログは `%TEMP%/pig-resource-retention-final-ui.log`。

- 今回の最終 `mise exec -- pnpm test:ui` は**27ファイル・45成功／0失敗**、
  約239秒で完走した。assertion・timeoutは緩めていない。
  ログは `%TEMP%/pig-resource-ui-continuation.log`。
  利用中アプリの再起動・session停止は行っていない。

第5節の履歴専用handle・必要時起動・限定的な自動休止は下記の追加段階で実装した。
KaTeX専用の追加cacheは未導入。インストール済みアプリへの反映・再起動や、
ユーザーのsessionの休止は行っていない。

### 休止互換性の追加調査

調査開始時のcontext-mode 1.0.169のPi adapterは `before_agent_start` でbridgeを
遅延起動し、`session_shutdown` でcleanupする。ただしbridgeのshutdownはsignal送出で、
そのPromise完了だけでは子の終了確認にならない。foregroundのidle reaperは無効化される。
旧1.0.169はmodule-globalのbridge共有により、会話Aの終了でBのchildが落ちる不具合を隔離環境で再現した。
これは拡張側の不具合であり、休止に限らず通常のCloseでも起きる。現行2.2.0では再現しない。
アプリ側で拡張ごとの例外処理は持たず、SDKの正式なshutdown契約に任せる。

## 8. 履歴専用起動・限定的な自動休止の追加実装

- `SessionHost` にSDKを持たない履歴handleを追加した。ファイルの所属・headerを検証し、
  閲覧・履歴ページ・下書き編集ではSDK、拡張discovery、MCP、モデル環境を起動しない。
  一時的なreadonly managerは保持せず、閉鎖時SnapshotもHostに複製しない。
- 送信は必要時起動の完了後に下書きCAS・予約へ進む。起動失敗では入力を保持し、
  promptを送らず、旧requestの自動再送もしない。モデル操作と明示的なslash補完も必要時起動へ合流する。
- Hostの15秒間隔sweeperで、全windowで安全な未使用状態が5分続くruntimeを休止する。
  SDKの正式なshutdown・認証書込待ちを通し、終了未確認時は成功扱いにせず二重起動を防ぐ。
  明示Closeでも、先に始まったcleanupの完了を待つ。
- Rootの全Pane・非空下書き・競合・添付読込・送信flight、Hostの実行・キュー・未確認send、
  UI要求・terminal・操作lane・transitionを保護する。
  usage通知の欠落・期限切れは未使用とは扱わず、古い世代の通知で保護を消さない。
- **拡張の有無では休止を拒否しない。** SDKの `dispose()` が正式な `session_shutdown` を発行し、
  拡張の後始末はその契約に従う。拡張固有の判定・fingerprint・background追跡は持たない。
  adapter・toolView設定のあるruntimeは引き続き除外する。
- 休止時に新epochを予約し、下書きownerとwire基底を明示的に移行する。
  復帰は同じ予約先へsingle-flightで再構築し、完全Snapshotから再開する。
  UIの表示keyは休止だけでは変えず、会話DOM・読込済み履歴・入力・選択・IME・スクロールを保持する。
  所有者移行だけの下書きechoは、到着順にかかわらず別編集と誤認しない。
- ファイルの同一size/mtime・同一leafの書換えも、保持するscalar digestで検出する。
  保存済みprefixの変更・枝変更では履歴revisionを更新し、未送信入力がある場合は変更を黙って採用しない。
  起動直前の内容相違でもSDK実行を開始しない。SDK復帰に遅れた履歴応答もactive snapshotへ合流する。
  readonlyの履歴ページにも同じprefix検証を適用し、起動失敗後の閲覧も含めて
  同一IDの書換えを旧revisionのページとして返さない。
- 再接続では全休止handleの本文を一斉にmaterializeせず、必要な表示Paneだけを補完する。

追加fixtureは `runtime-usage.test.ts`、隔離実SDKの `session-suspension.test.ts`、
`runtime-suspension-ui.test.ts` と既存のdraft/runtime/send-controller回帰テスト。


### 追加段階の検証結果・未確認事項

- CLI型検査・Lintは成功。UI style policyも0 violations。
  LSPは14ファイルともprimary serverの応答がなく未確定であり、cleanとは扱っていない。
- 最終の全unitは `PIG_TEST_WORKERS=2` で**187ファイル・1157成功／0失敗**。
  先行全体runでは一覧metadata検査が1失敗していた。今回のlifecycle変更では
  当該cache・検査・閾値を変更しておらず、直近の成功だけで原因解消とは判断しない。
- Stop/Close、モデル順序、account境界、削除、履歴、送信復旧、休止のSDK関連7ファイルは
  **8成功／0失敗**。最終の休止fixture再実行も2成功／0失敗。
  fake clock、複数Root、承認、送信予約、遅いshutdown、cleanup失敗、Close競合、
  ファイル書換えとreadonlyページ拒否、失敗時の入力保持、SDK呼出回数を検査した。
  休止後のAgentSession・managerのGCもWeakRefで確認した。
- draft/runtime/send/reconnect/実RPCの関連6ファイルは70成功／0失敗。
  所有者だけを移す空mirrorのechoが先／後の両方で、遅い入力を保持してCASできることを検査した。
- 追加段階の途中のEdge全体は**28ファイル・48成功／0失敗**で完走した。
  最終調整後の全体再実行は処理時間が延び、480秒の外側実行制限で中断したため、
  最新コードでのUI全体成功とは扱わない。assertion・fixtureのtimeoutは緩めていない。
  残った当該試験runnerのtreeだけを終了し、利用中アプリ・他の試験は停止していない。
- 最終調整後の休止Edge fixtureの個別実行は**1成功／0失敗**。
  整形DOM・選択Range・読込済み履歴・scroll位置・Composer・入力選択・IMEイベントを保ち、
  所有者移行echoでも偽の競合やSDK起動がないことを検査した。

ログは `%TEMP%/pig-suspension-{unit-final2,lint-final2,lifecycle-final2,sdk-last,ui-last,ui-complete}.log`。
integration suite全体、任意拡張のshutdown/restart、native WebViewでの長時間CPU・
総メモリ計測は未実施。WeakRefや独立Edgeの結果を、実アプリ全体のRSS削減量とは見なさない。
稼働中アプリの再起動・インストール・実sessionの休止は行っていない。
