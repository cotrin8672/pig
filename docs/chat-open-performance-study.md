# チャットを開くまでの遅延：原因調査と改善案

## 実装追記

- SDK managerを開いた直後に履歴を表示し、モデル・拡張・Trust UIの準備とは分離した。起動失敗でも読めた履歴は残す。
- 最新50 entryを目安に、応答単位で取得する。古い履歴はcursor付きの追加取得。ツール結果と応答統計を保つため、長い単一応答は途中で切らない。
- ページ追加時は閲覧位置を保護し、配信中・再接続後も取得済み履歴を維持する。branch revision / epochで古い応答を拒否する。
- Skeletonを外し、実行準備中は送信・再生成・分岐を無効にした。SDKの完全な会話contextは変更しない。
- 通常openの探索をSDK `findById`＋選択ファイルのheader検証に変更。Windowsの区切り文字・大文字小文字を比較時に正規化し、登録scope・ID・header所属検証は維持した。
- 手元の7件ではheader探索が約1.3〜4.0ms。実際のクリックから描画までの時間ではない。
- 全551テスト、型チェック、変更対象18ファイルのlint、Vite buildが成功。全体lintは並行変更中のWindowTitlebar・送信回復テスト側で4件を検出した。UI実機操作による最終確認は未実施。

以下は実装前の調査記録。改善候補のすべてを実装したわけではない。

## 結論

優先するのは **「履歴を読める」と「エージェントが送信を受け付けられる」を分けること**。

現在のpigは、初めて開く既存チャットでも、履歴の読み取りだけでなくモデル環境・拡張・`session_start`・UIアダプターの準備まで完了してから会話を表示する。このため、エージェント初期化の待ち時間が、そのままチャット閲覧の待ち時間になる。

ただし、今回の調査ではクリックから描画までの実機トレースは取得していない。**構造上の待ちを確認したことと、各処理が何秒占めるかを実測したことは区別する**。

画像の `Session does not belong to this project or was not found` は別の問題。同じWindowsパスの区切り文字違いで、このエラーを再現した。ただし画像の操作がそのケースだったかは未確定。

今回は調査文書のみを追加。既存の未コミット変更、製品コード、ユーザーのセッション内容・設定は変更していない。

## 1. 現在のクリティカルパス

主な対象：

- `apps/desktop/src/mainview/rpc.ts`: `openChat` / `openSnapshot` / `connectRuntime`
- `apps/desktop/src/bun/session-host.ts`: `open` / `bind` / `snapshot`
- `apps/desktop/src/bun/session-files.ts`: `resolveSessionFile`
- `apps/desktop/src/bun/model-runtime.ts`: `createModelRuntime`
- `apps/desktop/src/mainview/App.tsx`: `Chat`

初回オープンは概ね次の順序。

```text
チャット選択
  → connectRuntime（未接続ならruntimeState取得）
  → openSession RPC / 登録済みプロジェクト検証
  → SessionManager.list(cwd)でID→ファイルを探索
  → SessionManager.open(file)
  → プロジェクトリソース探索 / Trust確認
  → セッション専用ModelRuntimeの作成・ローカルcatalog refresh
  → loadExclusiveの順番待ち
  → settings / desktopResourceOptions / SDK resourceLoader.reload
  → 拡張provider登録 / 再度ローカルcatalog refresh
  → モデル・effort復元 / AgentSession作成
  → bindExtensions
      → session_startをawait
      → resources_discoverをawait
  → アダプター設定準備 / attach
  → 全branchのSnapshot作成
  → readyイベントとRPC応答
  → Reactで会話描画 / Markdown / レイアウト / 末尾へスクロール
```

### 確認できた問題

1. **履歴表示が実行環境の完成を待つ**
   - `SessionHost.open`で`manager`を開くのは早い段階だが、履歴を含む`ready`は`bind`完了後。
   - SDK 1.5.0の`AgentSession.bindExtensions`は`session_start`と追加resource discoveryをawaitする。
   - 拡張が重ければ履歴まで遅れる。モデルが使えなくても、過去の会話を読むこと自体は可能なはず。

2. **閉じたチャットの探索に、プロジェクト内全セッションの全文走査を使う**
   - `resolveSessionFile`は`SessionManager.list(cwd)`からIDを検索する。
   - 導入中のSDKの`buildSessionInfo`は各JSONLを最後まで読み、全文検索用の`allMessagesText`まで作る。pig側はそれを使っていない。
   - 一覧更新にも同じ処理を使う。今回の5件では数十msだが、件数・ファイルサイズとともに増える。
   - 通常オープンのバックエンドには、この探索を同じ処理内で二重に行う箇所はない。リンク経由では全workspaceの一覧探索が前段に加わる。

3. **全履歴の転送と描画**
   - `SDKProjector.snapshot`はbranch全体を投影する。toolResultはrecordsとtoolsの両方に載る。
   - 初回readyは同じSnapshotをイベントとRPC応答の両方に載せる。受信後の重複排除はあっても、転送前の重複は残る。
   - `projectEntries`は結果を使わない`getEntries()`と`getTree()`も呼ぶ。SDKの`getTree()`は全entryのnode作成・関連付け・sortをする。
   - `App.tsx`の`Chat`は全recordを走査し、表示対象をReactで描画する。ツール作業の折り畳みはあるがviewport仮想化はない。
   - 応答footerにも履歴検索があり、長い会話では追加の繰り返し走査が発生する。描画の寄与率は未計測。

4. **初回アプリ起動にも別の重い待ちがある**
   - `pi-service.ts`のtop-levelでSDK import、モデル環境、`refreshUserCatalog`をawaitする。
   - user catalogだけでもglobal拡張factoryをロードし、各セッションでも個別に初期化する。
   - これは主に「アプリ起動→利用可能」に効く。SDK importはホスト内で一度なので、毎クリックの原因として数えてはいけない。

### すでに実装済みの高速経路

- frontendには、liveなSnapshotを保持しているチャットへの即時切替がある。
- backendにも、readyなセッションが開いたままならそのruntimeを再利用する経路がある。
- pigはすでに同一Bunホスト内のSDK方式。単に「常駐サーバーにする」「RPCをSDKに変える」は改善案にならない。
- builtinモデル初期化は`allowNetwork: false`。LLMの応答待ちが原因とは確認できていない。拡張自身の処理・通信は別途計測が必要。

## 2. 読み取り専用の計測

調査時点：Windows、プロジェクトSDK 1.5.0。計測用Bunはmise経由の1.4.2。開発アプリのログには同梱Bun 1.3.13が出ているため、**開発アプリのクリック実測とは同一条件ではない**。

実ファイルを読み、一覧取得は同一プロセスで3回実行。最大ファイルの復元計測は永続managerを開かず、JSONを読み取ってin-memory managerにロードした。旧形式の自動migrationによる書き換えを避けるため。拡張factory / session_start / LLM実行は行っていない。

| 対象 | 結果 |
|---|---:|
| SDK import、一度のみ | 約675ms |
| pigのセッション数 / JSONL合計 | 5件 / 3,034,454 bytes |
| SessionManager.list(pig)、3回 | 45.1 / 30.0 / 27.0ms |
| Trust用リソース探索 | 約5.1ms |
| desktopResourceOptionsのみ | 約5.8ms |
| 最大JSONL | 1,677,250 bytes / 282 entries |
| 最大JSONLのread / JSON parse / index | 1.2 / 5.8 / 0.25ms |
| branch投影 | 約1.1ms / 281 records |
| TranscriptのJSON.stringify | 約5.7ms |
| シリアライズしたTranscript | 2,267,640 bytes |

読み取れること：

- 今のデータ量では、一覧取得やローカルJSON parseだけで秒単位の待ちは説明できない。
- 最大会話はTranscriptだけで約2.27MB。全量Snapshotの二重配送、WebView側のparse・描画は削減候補。ただし転送・描画の所要時間は未計測。
- 残る初期化・拡張hook・フロント描画に計測点を入れる必要がある。数値なしに特定拡張を主犯とはしない。

参考：導入済みpi-lens 4.4.11のコードには、`session_start`内でLSP設定初期化と`handleSessionStart`をawaitする経路がある。後者のwall budgetは5秒。一部のwarm-upは非同期で、**このbudgetは実際に5秒待った証拠ではない**。

## 3. 画像のセッションエラー

`session-files.ts`は`info.cwd === cwd`で所属を判定している。SDK自身はWindows向けに解決済みパスのcase-fold比較を持っているが、pig側の比較は文字列一致。

実在する同じプロジェクトで再現：

```text
C:\Users\gummy\ghq\github.com\cotrin8672\pig → 一覧5件
C:/Users/gummy/ghq/github.com/cotrin8672/pig → pigの一覧0件
同じIDを後者でresolve → Session does not belong to this project or was not found
```

現在の保存済みプロジェクトと5件のheaderはすべて同じ表記だった。したがって、これは**再現した実装上の不具合であり、画像の原因を確定したものではない**。削除済みファイル、古いsidebar、ホスト再起動で消えた未永続化チャット等との区別が必要。

修正方針：登録時のproject identityとSDK headerのパス比較を整合させる。登録済みscopeの検証・session ID検証は維持し、任意パスをfrontendから渡して開く方式にはしない。`session-scope.ts`は意図的にaliasを拒否するので、全体を単純にcase-insensitiveな部分一致へ変える修正は不可。

このエラーはruntime作成前に発生する。同じopenなら拡張初期化の遅さとは別。ToastとOpening表示が同じ要求に属するかも、`openId`で確認する。

## 4. 他ハーネスの実装比較

### pi-client（Hu-Wentao）

対象commit：`ba2796568b86a3f224858f09e57bda75d4411cc6`。公開archive版であり、非公開後継版を調べたものではない。

- [workspace.vm.dart](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.vm.dart#L590)：初回は最新50メッセージ。履歴・tree・statsを並行取得する。ただし`Future.wait`で3つの完了を待ってから表示する。
- [pi-sdk-domain-session.ts](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-sdk-domain-session.ts#L327)：履歴APIは1〜200件、cursor、activeBranchRevision / treeRevisionを持つ。
- 同ファイルの`openPersistentSession`もSDK runtime/servicesを構築する。**「履歴を読むだけならruntime不要」を全経路で実現しているわけではない**。
- [pi-sdk-project-session-catalog.ts](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-sdk-project-session-catalog.ts)：プロジェクト発見用catalogはruntimeを作らず、metadataだけ取得する。

採るもの：最新50件・revision付きcursor、一覧とruntimeの分離。採らないもの：本文表示をtree/stats完了にも依存させること。ページングはUI転送量を減らすが、SDKのファイル全読込・branch走査まで自動でなくすものではない。

### pi-gna

対象commit：`5557d28251d4e0f0b6016d8d74d13694ec649cbc`。

- [session-host.ts](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L313)：pi process起動と履歴読み取りを並行実行。`get_state`は別途待ち、履歴が読めればopen結果を返す。起動中イベントは保持し、履歴の後に適用する。
- [session-file.ts](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-file.ts#L1)：JSONLを直接読み、`parentId`からactive branchを復元。起動失敗でも履歴を読める設計。
- [session-index.ts](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-index.ts#L1)：path + mtime + sizeでsummaryをキャッシュし、ディスクにも保存。変更されたファイルだけ読み直す。
- [session-host.tsのspare](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L759)：次の新規チャット用piを最大1つ予熱。cwd / trust / features / 入力ファイルの一致を確認して引き継ぐ。負荷・期限・idle数で破棄する。

pigに最も合う原則は**履歴表示と実行準備の分離**。pigではすでに早期にSDK managerを開いているため、まずそのbranchを投影すればよく、別JSONL parserや子process方式までコピーする必要はない。

### OpenCode

対象commit：`2ab149011f20708b4295109d4c847de7d6979fd9`。Issueの要望ではなく実ソースを確認。

- [history-machine.ts](https://github.com/anomalyco/opencode/blob/2ab149011f20708b4295109d4c847de7d6979fd9/packages/app/src/session/timeline/history-machine.ts#L1)：上端付近で古いページを取得。timeout、失敗後のcooldown、ページが進まない場合の停止、古いattemptの結果無視がある。
- [virtualizer.tsx](https://github.com/anomalyco/opencode/blob/2ab149011f20708b4295109d4c847de7d6979fd9/packages/app/src/session/timeline/virtualizer.tsx#L1)：viewport仮想化、sessionごとの計測値・展開状態キャッシュ。
- [cold-mount.ts](https://github.com/anomalyco/opencode/blob/2ab149011f20708b4295109d4c847de7d6979fd9/packages/app/src/session/timeline/cold-mount.ts#L1)：初回は軽い末尾から計測する段階処理。ただし非表示待ちもあり、3秒のfallbackで上限を設けている。

採るもの：ページングと描画範囲制限、古い要求の無効化、スクロール位置保護。大規模なstate machine群やSQLite移行まで持ち込む必要はない。

## 5. pigの改善順序

### P0：計測と所属エラーの切り分け

- `openId`ごとに、scope / resolve / file load / trust discovery / trust回答待ち / models / loader queue / resource reload / session create / bind / snapshot / frontend receive / first visible paintを記録。
- 人間のTrust回答待ちはアプリの処理時間と分ける。拡張factoryとhook別の時間も可能なら記録。
- 既存live切替・再起動後の初回open・新規chatを分けて測る。payload bytes、件数、cache hitを記録し、会話本文やcredentialはログに残さない。
- パス表記違い、見つからないID、別workspaceのID、消えたファイル、古いsidebarの回帰テスト。
- 既知の失敗は明確に終了表示する。安全なopenId照会を残しつつ、失敗を隠す再open・新規chat自動作成はしない。

### P1：履歴を先に見せる（最優先の体感改善）

既存の`SessionHost.open`でmanagerを取得した直後、runtime作成前にread-onlyの履歴previewを返す／通知する。

- 新しい別セッションや共有runtimeを作るのではなく、今開いているSDK managerを利用する。
- previewは実行可能なSnapshotと区別する。`historyReady`と`runtimeReady`を別に扱い、履歴閲覧・コピー・下書きと、送信可能性を混同しない。
- 最初は最新50件程度、かつuser / assistant / tool結果の関係が壊れない表示単位。SDKには完全なbranch・model contextを残す。
- 初期化はバックグラウンドで継続。通常のreadyで権威あるSnapshotに置換する。
- runtime初期化失敗でも、読めた履歴は残してエラーを示す。モデル未設定で会話まで消える挙動を避ける。
- `openId` / navigation revision / hostId / epoch / snapshotSeqによる古い結果の無視、キャンセル、起動hookが挿入したentryの整合性を維持。
- Trust未承認のproject codeは実行しない。履歴のcustom rendererも、未承認project codeをロードする抜け道にしない。

これはローディング表示を変えるだけでなく、実際に読める内容を早く届ける変更。

### P2：繰り返し処理と転送を削る

- まず`projectEntries`の使わない`getTree()` / `getEntries()`を削除候補にする。小さい変更だが、それだけで秒単位の改善とは約束しない。
- `cwd + sessionId → path + ファイルrevision + summary`のbackend indexを使い、通常openで全セッションを全文走査しない。cache miss時だけSDK discoveryへfallback。
- rename / delete / settleで対象を更新。外部更新はstat等で検出。永続indexは必要性を測ってから。cacheを所属検証の代わりにはしない。
- 初回readyの全量Snapshotを二重配送しない形にする。ただしRPC喪失後の`getOpenState`復旧・readyイベントによる再接続を壊さない。
- UI履歴はpaged response、本文中の画像・巨大tool outputは必要時に取得。custom renderer、fork / rewindのentry identityを維持する。

### P3：それでも重い経路だけ対処

- 描画が支配的なら、末尾の表示範囲制限と上方向追加を先に行い、必要なら仮想化。Markdownはviewport外まで初回に処理しない。
- 初期化が支配的なら、純粋なcatalogデータ・discovery結果・変換済みmoduleの再利用を検討する。セッションごとのprovider登録やExtensionRuntime自体は共有しない。
- 新規chatのruntime予熱は最後。最大1つ、同じcwd・Trust・settings・resourcesの場合だけ。`session_start`には副作用があるので、全プロジェクトのruntimeを無条件に先行起動しない。
- `loadExclusive`は理由を確認せず外さない。単純な全並列化でextensionのprocess-global状態を混線させない。

## 6. 完了判定と回帰チェック

目標値は実装前の仮置きであり、今回達成した計測結果ではない。

- 現在程度の会話で、初回の読める本文表示をp95で300ms以内にすることを目標にする。runtime readyは別途報告する。
- 新規chatは即座に入力でき、送信受付前の状態を明示する。既存live切替の高速経路を悪化させない。
- 空、短い会話、現在の最大会話、長大なtool出力、画像、分岐・巻き戻し後、外部追記中をテスト。
- runtime未準備ではpromptを受理しない。キャンセル直後や別chatへの移動後に遅い結果が表示・送信されない。
- preview→ready / 再接続 / ホスト再起動で二重entry、消えるdraft、古いepochへの操作を生まない。
- 通常系の改善前後で、履歴表示・runtime readyのp50/p95、転送bytesを同じ環境で比較する。

## 未実施・限界

他製品を起動しての速度比較、pigのUI操作・WebView描画トレース、拡張を実行しての時間計測は未実施。開発ログには段階別open timingがなく、主因の秒数はまだ確定できない。製品コードは未変更のため、ビルド・型チェック・テストは今回実行していない。
