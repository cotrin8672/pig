# 起動の遅さ：Window表示前とUI表示前のボトルネック

追加の実測：[候補別A/B・初回操作への移転・CPU profile](desktop-startup-ab-results.md)。
以下は当初の調査記録で、後続のA/Bもnative end-to-end起動の実測ではない。

実装前の追加調査：[実装方針の成立性と段階的な設計](desktop-startup-implementation-study.md)。
Bunの単一ファイルbundleではlocal `import()`だけでSDK読込を遅延化できない場合があるため、
配布artifactの境界、サービスの寿命、bootstrap分割の契約を先に検証する。

## 結論と確度

ユーザー報告は「Windowが出るまで遅い」「Windowが出てからUIが出るまでにも待つ」。現在の作業ツリーを調べると、**二つの区間にそれぞれ独立した待ちがある**。

1. **Window前：重いSDK importとモデル／ユーザー拡張初期化が、Window作成の前提になっている。** 空プロファイルでも、同梱Bun 1.4.4で`pi-service`のimport＋top-level初期化に約1.49〜2.21秒を観測した。
2. **Window後：UIの初期JSが約1.50MBあり、まだ使わない機能まで評価対象になる。** xtermや、Markdownの同期fallbackのためのKaTeXも初期chunkに入る。
3. **さらに主要UIはbootstrap完了まで待つ。** bootstrapがprovider・model・utility model・各accountのcatalogを揃えるので、Windowを作ってもそのまま操作画面が出る構造ではない。

優先するのはRust化ではなく、**小さな起動シェルと重いエージェントサービスの依存分離、UIの起動に必要なデータとcatalogの分離、初期bundleの削減**。

今回の数値は、fresh process／一時的な空プロファイル／ネットワーク無効での部品計測と、現行ソースの本番bundle解析。**配布済みアプリのクリック→Window可視化→UI paintの実測ではない。** 稼働中pigの再起動・設定変更・ユーザー拡張や認証情報の読込は行っていない。製品コードの修正も行っていない。

## 1. 現在の起動経路

```text
OS／ショートカット起動
  → Electrobun launcher／native core／Bun起動          [今回未計測]
  → ホストentryの依存moduleを評価
      → sdk.ts
          → private auth-storage moduleのimport
          → pi-coding-agent package rootのimport
      → pi-service.tsのtop-level await
          → createModelRuntime()
          → refreshUserCatalog()
              → global resource discovery／user extension factory等
          → loadEfforts()
          → background catalog refreshを開始（awaitはしない）
          → SessionHost生成／theme／recovery DB等
  → index.ts本文
      → desktop config準備
      → desktop state／model preferences読込
      → projects.json読込
      → settings／appearance読込
      → RPCとイベント接続
      → channel確認
      → devのみlocalhost:5173確認（最大1000ms）
  → new BrowserWindow(...)
      → native Window／WebView作成                     [可視化時刻は未計測]
  → HTML／CSS／初期JSの読込・評価
  → main.tsx → createRoot → App初回commit
      → shell／brand／cacheがあればsidebar
      → initRuntimeConnection()
      → refresh()
          → bootstrap／appearance／settingsを並行要求
          → 必要ならlegacy UI preference移行の保存をawait
          → initialized = true
  → 主要画面を描画
  → session一覧の更新／使用量取得等
```

ES moduleのstatic importはentry本文より先に評価される。**`new BrowserWindow`の行を上へ移すだけでは、static importの依存先にあるtop-level awaitは飛ばせない。**

## 2. Windowが出るまで

### 2.1 SDK全体を早期にimportしている【実測あり】

`apps/desktop/src/bun/sdk.ts`は、auth-storageのprivate moduleをimportした後、`@earendil-works/pi-coding-agent`のrootを動的importして、その結果から多数のexportを取り出す。

導入済みSDK 1.5.2の`dist/index.js`は、session・model・resource APIだけでなく、CLI main、interactive mode、TUI components、builtin extension群、theme、image utilities等も再exportしている。実行時のroot importは、選んだexportだけをtree-shakeして読み込むAPIではない。

現在はSDK packagesを本番でもexternalにし、依存closureを実ファイルとして同梱している。これは`import.meta.url`、隣接Wasm／worker、動的module loader等を守るための意図的な設計で、**起動対策として丸ごとbundleすればよいとは言えない**。

また、SDK依存は`pi-service`だけではない。`runtime-profile.ts`、`default-model.ts`、`pi-data.ts`、`packages.ts`等にも実行時のSDK依存がある。`pi-service`だけdynamic importに変えても、起動entryから別の経路でSDK rootへ到達すれば遅延化できない。

候補：

- 起動シェルの依存graphからSDKを外す。
- SDKの初期化は共有された一つのready promise／サービス状態として起動後に進める。
- さらに必要ならSDK側の公式なgranular entrypoint、重いCLI/TUI/builtin機能のlazy importを検討する。
- private deep importの増殖は、version依存やmodule identity問題を増やすため、最初の対策にはしない。

### 2.2 モデル・global extension初期化をWindow前にawaitしている【構造確認・空環境の実測あり】

`pi-service.ts`では次をtop-levelで待つ：

- `runtime = await createModelRuntime()`
- `await refreshUserCatalog()`
- `await loadEfforts()`

`refreshUserCatalog()`は`reloadUserCatalog()`から`createAgentSessionServices()`へ進み、SDK resource loaderの初期化を行う。project trustはfalseだが、**user-globalな拡張のfactory／providerを読む経路は残る**。AgentSessionの`session_start`を実行しているわけではない。

したがって実ユーザーのglobal extensionの遅さ・失敗もWindow表示前へ伝播し得る。今回の隔離計測は実ユーザーの拡張を実行していないので、特定拡張を主因とはしない。

`refreshInBackground()`によるnetwork refreshはawaitされていない。ネットワーク完了を直接Windowの前提にしているとは言わない。ただしWindow前に開始されるため、disk／CPU処理が後続の起動処理と競合する可能性はある。今回のoffline試験には含まれない。

### 2.3 その他のWindow前処理【所要時間は未計測】

- `SessionHost` constructorのruntime theme初期化、recovery／diagnostic DB生成、config loader開始。config reloadのPromise全体をconstructorでawaitしているわけではないが、同期部分は通る。
- `prepareDesktopConfig()`、desktop state／model preferences、projects、settings／appearanceのファイル読込。
- `Updater.localInfo.channel()`。
- **dev channelのみ**、Vite URLのHEAD確認。Vite不在・応答不良時は最大1000msの追加待ちになり得る。通常のstable起動の原因には数えない。
- Electrobun自体のnative core／Bun起動、Window作成、WebView2 environment／controller初期化。今回のSDK部品計測では除外されている。

外観・言語等の小さな設定は、間違った設定で一瞬描画することを避けるために必要な場合がある。一律に後回しにするのではなく、最小の起動metadataとしてまとめ、SDK準備とは切り離す。

## 3. Windowが出てからUIが出るまで

### 3.1 初期bundleに不要な機能が載っている【本番build graphで確認】

`profile-startup.ts --bundle`でViteの本番buildをメモリ上で実行。既存の`dist`や配布物は書き換えない。

| 項目 | 観測結果 |
| --- | ---: |
| 初期JS chunk（minify後、非gzip） | 1,502,054 bytes、約1.50MB |
| 初期chunkのmodule数 | 583 |
| KaTeX moduleのrenderedLength | 600,708 bytes |
| xterm moduleのrenderedLength | 291,975 bytes |
| React DOM client moduleのrenderedLength | 644,593 bytes |

moduleの`renderedLength`は**chunk最終minify前**であり、minify後の1.50MBと加減算できない。サイズはparse／evaluate時間でもない。

確認できた経路：

```text
main.tsx → App.tsx → UIRequestBroker.tsx → TerminalDialog.tsx → xterm
main.tsx → App.tsx → MessageContent.tsx → rehype-katex → KaTeX
main.tsx → App.tsx → Settings / Extensions / Providers
main.tsx → App.tsx → DynamicTheme → material-color-utilities
```

重要なのは、**解析をWorker化したことと、依存コードを初期UI bundleから外したことは別**という点。

`MessageContent.tsx`にはブラウザWorkerが使えない場合／SSR向けの同期Markdown pathが残り、`rehype-katex`、`remark-gfm`、`remark-math`をstatic importしている。通常のWorker経路で起動しても、KaTeXを初期chunkから除けていない。

一方、syntax Worker用約2.65MBとsyntax engine用約2.38MBはdynamic chunkで、**初期chunkのstatic dependencyには入っていなかった**。Workerのサイズを全量「最初の画面までの読込量」に加算するのは誤り。後から履歴を表示するときの負荷とは分ける。

候補：

- TerminalDialog／xtermを実際のterminal要求時にlazy loadする。rootのUI broker自体は常駐させ、trust／startup requestの到達性を守る。
- Worker正常系では必要ない同期Markdown plugin群をfallback境界の内側へ移す。Worker失敗時の安全な表示・既存DOM／選択保持は維持する。
- Settings／Extensions／Providersは画面遷移時にloadする。ただしbootstrapやroot通知brokerまで一緒に遅延化しない。
- DynamicThemeの初回`useLayoutEffect`もpaint前の同期処理。現状の起動停止の主因とする計測はないため、別途時間を測ってから扱う。

### 3.2 bootstrapがUI表示のゲート【実装・既存テストで確認】

`mainview/rpc.ts:refresh()`は、bootstrap・appearance・settingsを`Promise.all`し、完了後に`initialized: true`を一度に反映する。

`App.tsx`の主要領域は`initialized`がfalseの間、通常画面を描画しない。サイドバーには既存のlaunch cacheがあり、`cachedSidebar`がtrueなら前回一覧を出せるが、**bundle評価前の待ちや主要領域のbootstrap待ちは消えない**。

ホストのbootstrapは、少なくとも以下を待つ：

1. `listProviders()`：accounts／名前／credential list、全providerの認証可否チェック。
2. `availableModels()`。
3. `utilityModels()`：image／classifierの利用可能一覧。
4. model override読込。
5. providerごとのcatalog投影に加え、設定済みの各accountについて`accountModels()`。
6. desktop state保存queueのsettle、default model読込等。

空の隔離profileでこのうちprovider／model／utilityの読込は約37〜45msだった。**実ユーザーのaccount数・catalog量での時間ではない**。全model catalog取得が現在の実機の空白時間を何ms占めるかは未確定。

認証チェックについても、SDKの`checkAuth`はOAuth credentialの存在チェックとAPI key providerのcheck等を区別する。bootstrapが必ずOAuth refreshを待つ、と一括りにはしない。拡張providerの実装やcredential resolverが遅い場合は、個別に計測する必要がある。

改善するなら「設定・projects・表示準備完了」と「provider/model catalog準備完了」を別契約にする。**単に早く`initialized = true`にして、未取得を未接続／空一覧として描画する変更は避ける。** 現行startup testは偽の空・接続状態や古い設定への巻き戻しを防いでいる。

### 3.3 bootstrapの後に動くものと、並行処理を区別する

- `refreshSessions()`は`initialized = true`のstore反映**後**にawaitされる。全projectの一覧読込完了を待ってから初期主要画面を出すわけではない。ただし各projectの一覧表示はこの読込待ちになり、重い処理が描画と競合する可能性もある。
- `initRuntimeConnection()`は別effectで開始する。通常のcold startで、bootstrap前に全会話を再openしている経路とは確認できない。
- `reloadChatRenderers()`は`main.tsx`でrender要求の後に非awaitで開始する。custom rendererがあればBun.build／Babel parse等が起動中に走り得るが、直接の主要画面ゲートではない。
- 使用量取得はinitialized／hostを待つ。起動前の必須処理ではない。
- sidebar cache／notification historyはUI module評価時にlocalStorageから同期取得する。大量化した場合のparse負荷は候補だが、今回は実ユーザーcacheサイズ・所要時間を測っていない。

## 4. 今回の計測

再実行用：`apps/desktop/scripts/profile-startup.ts`を追加した。

安全性：各sampleを別processで実行し、HOME／USERPROFILE／APPDATA等を一時profileへ向け、provider key等の環境を引き継がず、`PI_OFFLINE=1`かつfetchを拒否する。実ユーザーのSDK設定・credentials・session・拡張を開かず、終了後に一時profileを削除する。UI解析は`write:false`のbuildで、pigは起動しない。

### 同梱Bun 1.4.4：各3回

| 処理 | 3回の範囲 | 中央値 |
| --- | ---: | ---: |
| sdk.tsのimport（依存graphを含む） | 888.5〜1187.7ms | 1141.0ms |
| model module追加import（SDK読込済み） | 34.2〜59.1ms | 52.6ms |
| createModelRuntime、44 providers | 51.0〜85.7ms | 59.8ms |
| user-catalog module追加import | 14.7〜18.7ms | 18.2ms |
| 空profileのreloadUserCatalog | 82.3〜170.2ms | 87.3ms |
| pi-serviceのfresh import＋top-level初期化 | 1487.0〜2205.5ms | 1627.5ms |
| service import後のprovider/model/utility読込 | 36.6〜45.2ms | 38.9ms |

上段のstaged測定と、下段のpi-service測定は**別processの異なる実行順序**。重複するimport・初期化を含むため、全部を合計して起動時間にしない。OSのfile cacheをflushしたcold disk試験でもなく、sample数3からp95等は求めない。

ローカルmise Bun 1.4.2でも同じscriptを3回ずつ実行し、SDK import約1.05〜1.64秒、pi-service import約1.22〜1.55秒を観測した。最初の計測には並行bundle解析の負荷もある。Bunバージョンの優劣比較には使わない。

**同梱Bunを使っていても、今回はworkspaceのソースと依存配置を読み込む。配布bundle内のJS・同梱node_modules配置をそのまま起動した計測ではない。** 配布版の総起動時間からこの値を引けるわけではない。

### 再実行コマンド

```powershell
# ローカルBun。offline／空profileの部品計測
mise exec -- bun apps/desktop/scripts/profile-startup.ts --repeat=3

# 現在のdev build内に同梱されたBunで同じ部品計測
& ./apps/desktop/build/dev-win-x64/pig-dev/bin/bun.exe apps/desktop/scripts/profile-startup.ts --repeat=3

# 現行UIのproduction bundle graph。distには書き込まない
mise exec -- bun apps/desktop/scripts/profile-startup.ts --bundle
```

build配下のBunは、そのbuildが存在する場合だけ使える。実行時に出力されるBun.versionを確認する。

## 5. 改善順序の提案

### P1：最小shellをSDK準備から独立させる

Window＋正しい外観／言語のshellは、モデルや拡張の準備を待たずに作れる構造にする。既存static import graphを分離し、SDK依存を後段サービスへ集める。

これはsplashを表示して待ちを隠す話ではない。最小のナビゲーション・履歴閲覧準備・draft入力等を、エージェント実行準備と分離する。ただし現状のComposerがcatalog前提の箇所もあるため、未準備時の操作契約は明示的に設計する。

RPC handlerは一つのready promiseを共有し、初期化を重複実行しない。エラー状態からの再試行、起動途中のclose、custom extensionの失敗、未準備でのprompt禁止を扱う。呼出し順を変えて未初期化変数やevent transportへアクセスしないようにする。

### P2：初期JSからxterm・同期fallback・未使用画面を外す

起動時に不要なparse／evaluateを減らす。manual chunkに分けるだけでstatic importを残す方法では、初回の依存読込は減らない。実際のlazy boundaryが必要。

現在のShiki Workerはすでに遅延chunkなので、起動対策としてそれをまたWorker化する、という二重施策は不要。

### P3：bootstrapをshell metadataとcatalogへ分ける

外観・言語・projects／desktop metadataが揃えば表示可能なものと、catalog完成後にだけ有効にする機能を分ける。account別catalogは必要時に取得／安全に再利用する設計を検討する。

catalogの未取得と「認証なし」「0モデル」を混同しない。古いauth／model情報をそのまま実行可否の根拠にしない。cached sidebarだけではこの問題は解決しない。

### P4：実ユーザー条件で支配項を計測してから下層へ

上記の後もlauncher／WebView2初期化が支配的ならnative側を調査する。Cottontail／Rustメイン／Tauri等への切替は、その段階で効果とSDK互換コストを比較する。今はheavy importと待ち順序が残るため、言語変更を先に行う根拠はない。

## 6. 実アプリで次に必要な計測

今回読んだdevログには`[window] pig started`はあったが、各段階の起動タイムスタンプはなかった。このログもconstructor後の出力であり、ユーザーがWindowを見た時刻やfirst paintではない。

追加するなら、通常無効なstartup traceで以下を区別する：

| 時点／区間 | 計測の意味 |
| --- | --- |
| OS process開始／native launcher entry | 利用者の起動操作に近い起点。Bun entryより前 |
| Bun開始／lightweight entry到達 | native側の待ちとJS側の待ちの境界 |
| SDK import／runtime／global catalog／config読込 | 個別のホスト初期化時間 |
| createWindow呼出前後 | native API呼出の所要時間。Window可視化そのものではない |
| Window可視化／WebView environment・controller ready | native／WebView2の段階 |
| navigation start／DOM ready／JS entry | HTML・CSS・bundle読込と評価 |
| React初回commit／first shell paint | bootstrap前にどこまで表示できたか |
| bootstrap各subtask／UI受信／initialized commit | 主要画面を止めているdata gate |
| first usable UI／list ready／agent ready | 表示・閲覧・送信可能を別々に扱う |

ブラウザentryのmarkだけでは、その前のmodule依存評価を測れない。必要ならHTML側の小さなmark、navigation timing、CDP trace等で前段を測る。React commit、requestAnimationFrame、dom-readyを単独で「画面に描かれた時刻」と同一視しない。

native／Bun／WebViewの`performance.now()`は基準時刻が異なるため、数値を直接引かない。各process内のdurationと、起動ID付きの時刻対応・受渡しを記録する。会話・credential・拡張の機密出力は記録しない。

通常起動、OS再起動後、同一OSセッションでの再起動、devのbuild込みを別条件にする。`mise run dev`は既存windowのfocusだけの場合があり、その時間をcold startupと扱わない。

## 7. 検証と未実施

- 新規profilerのBiome check成功。
- desktopの`tsc --noEmit`成功。devkit同期を伴うwrapperではなく、既存devkitを使った直接型検査。
- 既存`startup.test.ts`の親子processテスト成功。bootstrap／appearance／settings完了前の状態保持、refresh／retry等の検査を含む。これは描画時間の測定ではない。
- profilerをローカルBun 1.4.2と同梱Bun 1.4.4で実行、production bundle解析も成功。
- 未実施：配布版の起動操作→Window可視化→実paintのtrace、実ユーザーのglobal extension／複数accountを含む起動計測、Windowsのfile I/O／Defender／WebView2内部の内訳、改善実装とその効果検証。
- UI／製品起動処理は変更していないため、今回`pnpm test:ui`やアプリの再起動は行っていない。
