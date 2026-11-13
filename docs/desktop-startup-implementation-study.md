# 起動高速化：実装方針の成立性と段階的な設計

後続の[候補別A/B計測](desktop-startup-ab-results.md)で、SDK artifact境界・bootstrap・UI分割と初回待ちを比較した。
単純な`React.lazy`＋`Suspense`による初回約300msの待ちも観測しており、遅延境界の実装方式を区別する必要がある。
以下の所有権・配布・failure契約は、性能の比較実験だけで解決済みとはしない。

## 判定

**「起動シェルの分離」「初期UI bundleの削減」「shell metadataとcatalogの分離」は妥当。ただし、そのままimportを書き換えて一括実装するのは危険。配布物の読込境界と、サービスの寿命・状態所有者を先に決める必要がある。**

[前回のボトルネック調査](desktop-startup-investigation.md)を、現在のコード・導入済みElectrobun 2.0.6・生成物・既存テスト・小さなbundle実験で掘り下げた。

| 方針 | 判定 | 採用条件 |
| --- | --- | --- |
| xterm／未使用画面の遅延読込 | 採用しやすい | root brokerを残し、chunk失敗・terminal ready期限・保持状態を扱う |
| SDK初期化より先にWindowを作る | 採用すべき | static依存graphだけでなく、bundle後もSDKが初期entryへ巻き込まれないこと |
| shell metadataとcatalogの分離 | 採用可能 | 未取得と未接続を区別し、settings／appearance等は整合した単位で反映 |
| account別catalogの完全オンデマンド化 | 初回変更では保留 | accountごとの未取得状態、無効化revision、検索・選択の仕様が必要 |
| SDK準備前の自由な入力・送信queue | 初回変更では保留 | address未確定draftの永続化・close時ACK・取消しまで設計する必要がある |
| SDKや拡張初期化の自動再試行 | 原則しない | module cache・factory副作用を安全に巻き戻せることが確認できた段階だけ |
| Rust／別processへの移行 | 今回不要 | 同一Bun process内の整理で進められる |

今回は調査用scriptと文書のみを追加。製品コード・設定・配布物は変更せず、アプリも起動・再起動していない。以下のAPI名・ファイル名は提案であり、実装済みではない。

## 1. 追加調査で分かった重要事項

### 1.1 `import()`に変えるだけでは、SDKが遅延読込にならない場合がある【再現】

次の構成を、アプリを実行しないin-memory buildで比較した。

```text
entry:   shellを出す → start()の中でimport(service)
service: SDKをstatic import → サービスを生成
```

Bun 1.4.2と、現在のdev buildに同梱されたBun 1.4.4の両方で、以下を確認した。

| build方式 | 出力の初期entryにSDKのstatic importが残るか |
| --- | --- |
| local serviceをdynamic import、`splitting:false` | **残る**。serviceの本体評価だけを遅らせても、外部SDK importは初期ファイルに残る |
| 同じ構成で`splitting:true` | SDK importは別chunkへ移る |
| SDK自体をfactory内でdynamic import | 最小実験ではSDKのdynamic importとして残る |
| 別途生成したservice artifactをruntime URLでimport | 最小実験のshell出力にはSDK importが入らない |

元のSDKはexternal指定されているため、このstatic importが残ると、entry本文のWindow作成より前にSDK依存が評価される。

導入済みElectrobunの`BundlerOptions`には`external`等はあるが、**公開設定型に`build.bun.splitting`はない**。`as any`で追加したり、生成devkitを修正したりして解決済みにしてはいけない。Bunの一般機能と、Electrobunが公開しているbuild設定は区別する。

また、静的なローカル依存を型消去後に走査すると、起動entryの直接依存からSDK package／`sdk.ts`へ到達する経路を8本確認した：

- `default-model.ts → sdk.ts`
- `login.ts → pi-service.ts`
- `model-settings.ts → runtime-profile.ts → sdk.ts`
- `packages.ts → pi-coding-agent`
- `pi-data.ts → sdk.ts`
- `pi-service.ts → pi-ai / SessionHost等`
- `runtime-profile.ts → sdk.ts`
- `usage/host.ts → pi-service.ts / pi-ai`

これはローカル98moduleのstatic走査で、全package・native依存まで解決した最終bundle解析ではない。しかし、`pi-service.ts`だけを遅延化しても不十分なことは確認できる。

根拠：`apps/desktop/scripts/study-startup-boundaries.ts`、ローカル`.hutch/devkit/api/config/ElectrobunConfig.ts`、既存buildの`Resources/app/bun/index.js`。

### 1.2 サービスを別bundleにすると、共有singletonの複製が問題になる【コード確認】

shellとserviceを別々にbundleし、両方から同じTSファイルをimportすると、その内部状態も別々に生成され得る。特に次はそのまま共有できない。

| 現在の状態 | 危険 |
| --- | --- |
| `settings.ts`の`runtimeSettings` | shellで保存・更新してもserviceの`currentSettings()`は初期値のままになり得る |
| `usage/observation.ts`のlistener | shellで登録したobserverに、service側のmodel responseが届かない |
| `model-runtime.ts`のowned runtime集合 | 二重化するとrefresh／解放の対象が分断される |
| `session-host.ts`のloaderQueue | SDKのprocess-global登録を直列化する契約が崩れる |
| `runtime-theme.ts`／terminal環境 | process-globalのtheme／keybindingを二重初期化する |
| `pi-service.ts`のruntime／SessionHost／timer | そもそも一つのアプリサービスでなくなる |

**サービス間の共有状態を、同じsource fileをimportすることで共有したつもりにしない。** live getter／callbackをfactoryへ渡すか、状態の所有者を一方に集約する。

現行`SessionHost`はすでに`settings: () => Settings`、`disabled: () => readonly string[]`、session account persistence、emit callback等を受け取れる。その注入点は利用できる。

### 1.3 catalogを省略すると、account分離の既存の意味が変わる【コード確認・既存テスト】

`account-picker.ts`では、標準accountのcatalogがない場合に`bootstrap.models`へfallbackする。現行bootstrapでは各標準accountに明示的なcatalogを返す一方、`bootstrap.models`はaccount別catalogを含むunionである。

したがって「lazy化のために標準accountのcatalog keyを省略する」だけだと、そのaccountでは利用できないmodelをunionから表示する可能性がある。追加accountについては、missing catalogを別accountへfallbackしない既存テストもある。

初回実装では、**shellからcatalogを切り離すだけにとどめ、catalog response自体は既存の自己完結な内容を維持する**のが安全。全accountのオンデマンド化は後段に分ける。

### 1.4 SDK準備前の入力は、現在のdraft永続化では自動的に守られない【コード確認】

`draft-store.ts`はSessionAddressで所有されるdraftを扱い、rendererの`flushDrafts`も`drafts.flushAll()`を呼ぶ。一方、`newChatDrafts`と一部のopening queueはZustand側のmemory stateであり、SDK未準備・address未確定の新しい入力全体をこのflush経路だけで永続化できるとは言えない。

「シェルを早く出す」に「新しい無所属editorと送信queueを追加する」まで含めると、起動高速化より大きな仕様変更になる。まずはWindow操作、project操作、アプリ設定など、既存の安全な保存先がある機能を早める。SDK準備前入力の拡張は別課題とする。

## 2. 推奨する依存・所有権の境界

同一Bun process内で、**小さいshellと、一つの遅延service module**に分ける。新しいWorker／sidecar／SDK runtimeの複製は導入しない。

```text
bun/index.ts（shell entry）
  ├─ Electrobun、native window control、appearance
  ├─ desktop設定のmigration／保存、projects、DesktopStateStore
  ├─ RPC登録、起動status、shutdown制御
  └─ AppServicesGate（SDKをimportしない）
       └─ runtime URLによるservice artifact読込
            └─ createAppServices(deps)
                 ├─ SDK／モデル／global resource catalog
                 ├─ SessionHost／復旧DB／loader queue
                 ├─ provider login／model settings／packages／SDK data
                 └─ usage service／observer／network refresh scheduling
```

### shellに残すもの

- `desktop-config.ts`、`settings.ts`、`appearance.ts`、`desktop-state.ts`、`model-preferences.ts`等のSDK非依存処理。
- 必要なsettings／appearance／projects／desktop metadataを読み、一貫したshell snapshotを返す。
- `windowControl`、安全なexternal URL、project folder登録等のnative操作。
- 起動statusの照会・通知、shutdown中フラグ。
- 完了通知をnativeに出す処理はshellへcallbackしてよい。completion tracking／snapshot delta等をどちらへ置く場合も、一つのownerにする。

`runtime-profile.ts`はSDKの`getAgentDir()`を実行するためshellへ残さない。起動時のagent pathログもservice読込後へ移す。SDKのpath解決を軽量化のために独自再実装したり、`PI_CODING_AGENT_DIR`を勝手に変更したりしない。

Babelを持つcustom renderer compilerやPhoton等、SDK以外の大きな依存も個別に確認する。ただし今回の第一段階で全機能を細分化する必要はない。native shellを遅延service側からimportして、Electrobun自体を二重にbundleする設計は避ける。

### serviceへ渡す依存

概念例：

```ts
type AppServiceDeps = {
  signal: AbortSignal;
  currentSettings: () => Settings;
  disabledModels: () => readonly string[];
  readSessionAccounts: (id: string) => SessionAccounts;
  writeSessionAccounts: (id: string, value: SessionAccounts) => Promise<unknown>;
  emitRuntime: (event: RuntimeEvent) => void;
  emitUI: (event: ExtensionUIEvent) => void;
  emitTerminal: (event: TerminalHostEvent) => void;
  emitNotice: (notice: Notice) => void;
  // native browser launch等も、小さなcallbackとして必要な箇所へ渡す
};
```

これは同一processの通常の関数呼出しで、callbackをRPC越しに送る話ではない。contractsはtype-onlyまたは純粋なwire helperとし、`export *`等でservice本体をshellへ再importしない。

projectsや設定を初期化開始時のsnapshotで固定しない。初期化中にproject追加・設定変更をしても、後から作ったserviceが最新の値を参照する。現行のscope検証・session membership検証は操作ごとに残す。

## 3. 配布物の読込境界：先に小さく検証する

現行Electrobunの公開設定だけで進める候補は、**service用のJS artifactをpreBuildで別途生成し、`build.copy`で配置する方法**。

```text
Resources/app/
  bun/index.js                 # Electrobunが生成するshell
  services/app-services.js     # 独立buildしたservice
  node_modules/...             # 現在と同じ、検証済みSDK production closure
  sdk-runtime-manifest.json
```

shellは例えば、実行中のentryを基準に固定の相対URLを組み立ててimportする。フロントからimport pathを受け取らない。

```ts
// 概念例。実際の生成・copy・relocation検証を先に行う。
const moduleUrl = new URL("../services/app-services.js", import.meta.url);
const module = await import(moduleUrl.href);
```

サービスbundleもSDK rootsをexternalに保つ。元のSDK module／隣接Wasm・worker・package identityを保持する既存の配布契約は変えない。[SDK distribution assets](../apps/desktop/scripts/sdk-runtime-assets.md)に従う。

候補の比較：

| 方法 | 評価 |
| --- | --- |
| Electrobun設定に未公開の`splitting:true`を追加 | 不採用。型／builderの契約を満たしていない |
| 既存hostのsingle-file内で全SDK importをasync factory化 | 技術的には可能だが、SDK再export経路・全transitive importの監査範囲が大きい |
| 別service artifact＋固定runtime URL | 推奨PoC。SDK読込境界を生成物で監査しやすい |
| アプリ全体のbuildを独自pipelineへ置換 | 今回は過剰。native frameworkのbundle/path前提まで変えてしまう |

最初のPoCでは、実際のElectrobun buildを別検証用出力で作り、repository外へrelocateし、**shell操作中にSDK sentinelが評価されないこと、service開始で一度だけ評価されること**を検査する。SDK自身の本格的な起動とは別に、まず小さなsentinel moduleで成立性を確認する。

copy漏れ、古いservice artifact、sourcemap中のsource path、dev rebuild時のstale出力、release ZIP・checksumへの含有も確認する。生成物は同じapp buildに属するものとして一緒に更新する。

今回の最小build実験はこの候補の技術的根拠にはなるが、**実Electrobunのrelocated packageでの動作保証にはまだならない**。

## 4. 起動・終了の状態機械

### 4.1 module評価と初期化を分ける

現在の`pi-service.ts`はimportそのものがruntime生成、global catalog、timer、SessionHost生成を開始する。これを`createAppServices(deps)`という明示的な一回の初期化へ移す。

- module import：関数／型の定義。可能な限りアプリの副作用を起こさない。
- factory：migration／shell設定読込後に呼び、一つのserviceを生成する。
- ready公開：event sinks、session account persistence、settings getter、disabled model取得先が接続済みになってから。
- network refresh／usage polling：必須のローカル準備とは分け、追跡・停止できるtaskとして開始する。

現行`refreshUserCatalog()`はuser-global factoryを読む。builtins→設定適用→global拡張の登録順、`loadExclusive`による直列化を維持する。builtinだけを先に「完成したcatalog」として返し、後でglobal拡張を足す方式は、上書き・auth・仮想modelの意味が変わるため初回変更では行わない。

### 4.2 共有gateを一つにする

概念的な状態は`idle → importing → initializing → ready`、失敗時`failed`、終了時`stopping`。

- 同時に複数RPC・ready通知が来ても、同じin-flight Promiseを共有する。
- `startupId`／generationはshell側で生成する。まだ存在しないSessionHostの`hostId`を偽造しない。
- shutdown開始後は、新しい初期化・open・promptを受け付けない。
- import／factoryが遅れて完了しても、shutdown／旧generationならreadyを公開せず、作られたresourceを一度だけdisposeする。
- disposeは再入可能にし、ready時のdispose、初期化失敗時のcleanup、close直後の遅い完了を区別する。

**Promiseをtimeoutで捨てても、dynamic importや同期extension factoryが停止したことにはならない。** signalを受ける処理にしか協調cancelは効かない。native exit直前に新しくSDKを読み始める`await ensureReady().dispose()`は特に禁止する。

### 4.3 再試行は自動で保証しない

SDK module cache、OAuth flowのprocess-global登録、runtime theme、global factoryの副作用には、一律の巻き戻し保証がない。resource loader側にもロード済みextensionをunloadできない前提がある。

初回の設計では、side-effectfulな初期化失敗は`failed`としてshellへ伝え、設定等は使えるままにし、通常の終了・再起動で回復する。失敗moduleをcache bustして無理に再importしない。

ファイル読込等、副作用前の安全な段階だけを明示的に再試行可能とする。現行のstartup testが検査する「RPC取得失敗後の再取得」と、SDK factoryの再実行は別である。

### 4.4 重い初期化をいつ開始するか

Window作成後、shell metadataが届いてrootがcommitした旨の通知などを起点に、共有gateを一度だけ開始する候補がよい。ただしReact effect／dom-readyは実paint完了の証明ではない。

- ユーザーの明示操作が先なら、同じgateをその時点で開始できる。
- hidden windowではrequestAnimationFrameが進まない場合があるため、それだけを開始条件にしない。
- rendererの通知が欠けても永久に待たないよう、host側の期限付きfallbackを持つ。
- 長い固定delayで画面だけ速く見せたり、完全なユーザー操作待ちにして初回chatへ遅さを移したりしない。

具体的なfallback値と、shell表示／agent-readyのどちらが改善したかは、配布buildで測って決める。

## 5. RPCとbootstrapの分割

### 5.1 新しいshell snapshotを追加し、既存bootstrapを一度に破壊しない

`getShellBootstrap()`相当はSDK非依存の情報だけを返す。

- pigのsettings／appearance
- registered projects／generalCwd
- desktop metadata／model visibility preferences
- startupId、shell revision、現在のservice状態

SDK所有のdefault model／modelOverrides／provider auth／model catalog等はここへ混ぜない。現行`bootstrap()`は当面、サービスready後に返す自己完結したcatalog取得として残せる。状態名を分離し、従来の`initialized`を無条件にtrueにする互換hackは行わない。

UIは次を区別する。

```text
shell:   loading | ready | failed
service: idle | importing | initializing | ready | failed | stopping
catalog: notLoaded | loading | ready | failed
```

`connected = bootstrap.models.length > 0`をcatalog未取得時の接続判定に使わない。「providerを接続してください」という現行welcomeは、catalog取得後に初めて判定する。未取得を赤い未接続dotや0モデルに見せない。

settings／appearance／projects等を整合した単位で反映し、legacy localStorage preference移行もSDK非依存の保存経路で扱う。遅い初期snapshotが、その間の設定変更・project変更・pin更新を巻き戻さないよう、revisionと既存mutation overlayを適用する。

### 5.2 RPCごとに開始前の契約を決める

| 種類 | 例 | サービス未ready時 |
| --- | --- | --- |
| shell操作 | Window、appearance、pig settings、project登録、起動状態照会 | SDKを起動せず処理可能 |
| 読込・catalog | 既存bootstrap、listSessions、provider catalog | 同じgateへ参加。boundedな待ちと失敗を扱う |
| address所有のruntime操作 | prompt、syncDraft、abort、terminalCommand等 | service未readyなら明示的に拒否。ready後は現行のaddress／recovery規則で判定し、後から自動再送しない |
| 認証／package変更 | login、install、remove account等 | 初期化前に勝手にqueueしない。ready確認後に一度だけ開始 |
| teardown | disconnect、cancel、dispose | 未起動なら初期化しない。現在存在する状態だけを終了 |

`listSessions()`は現在SDK／SessionHostを使うため、shell snapshotに一覧の実読込完了まで含めるとSDK待ちへ戻ってしまう。初回は既存sidebar cacheを表示用に使い、通常一覧更新はservice開始後とする。cacheはscope／存在／trustの権威にはしない。

独自のread-only JSONL parserをこの変更と同時に導入する必要はない。SDKなしの履歴閲覧は、別の互換・安全性検証を伴う後段機能に分ける。

### 5.3 UI leaseの接続を遅延化した場合の順序

現行UIはmount直後に`connectUI` messageを送ってheartbeatを開始し、`runtimeState()`で同期する。サービスを遅延化したままこれを無変更で動かすと、接続失敗・再接続・heartbeatが初期化中に増殖し得る。

推奨は、**startup statusの照会とsession runtime leaseを分け、サービスready確認後に現行のruntime接続手順を開始すること**。

- RPC root handler、Notifications、UIRequestBrokerは最初から登録／mountする。
- startupイベントだけに依存せず、snapshot照会でready通知の取りこぼしを回復する。
- startupIdとstatus revisionで旧通知を無視する。navigation後・pagehide後の遅いreadyで旧clientを接続しない。
- runtime接続を終えてからsessionを開く。trust request／terminal requestを待つ処理は、この接続より前に開始しない。
- `runtimeState()`の既存hostId／runtimeRevision／recovery復元・取りこぼし検知を維持する。未readyを偽の空RuntimeViewStateで返さない。
- disconnect／cancel messageは単純にready Promiseの後ろへqueueしない。古いconnectが後から復活する設計にしない。

サービスready、runtime同期済み、catalog取得済み、個別session readyは別条件。どれか一つのboolですべての操作を許可しない。

## 6. UI遅延読込の具体的な切り方

### Terminal

`UIRequestBroker`は常駐させ、terminal surfaceだけに小さなlazy境界を置く。lazy component型はrender関数の外で固定し、開始済みsurfaceはnavigationでunmountしない。

現在のtransportは`ready`後にTUIを開始するため、xterm読込待ちをそのhandshake前へ置ける。ただし既定のready期限は15秒である。chunk failure／期限切れ／closeをaddress付きcancelとして扱い、成功値として完了させない。

subscription→ready→output→xterm parser callbackでACK、という順を維持する。lazy化を理由に無制限のANSI bufferや新しい汎用queueを増やさない。フォーカス・IME・Escape・OSC URLの検証も既存のまま残す。

### Settings／Providers／Extensions

ページ単位の`React.lazy`＋狭いSuspense／Error Boundaryが候補。App全体を境界に入れて、通知、root broker、sidebar、既存Composerを巻き込んで隠さない。

初回遷移に待ちが移る点は測る。起動時に全部prefetchして元に戻すのではなく、必要ならshell／サービスの重要処理が落ち着いた後や明示的な遷移意図でpreloadする。小さなpopoverまで細分化してwaterfallを増やさない。

### Markdown／KaTeX

通常のHAST→React描画と、sourceをparseする同期fallbackを分離する。既存`prepareMarkdown()`はWorker失敗時にもdynamic importでengineへfallbackする経路を持つので、そこへ重いpluginの所有を集める候補がある。

`MarkdownTree`の安定したcomponent型と既存DOMを保ち、最新の未解析textもescaped textで出す。component全体のlazy化で、整形済み本文・code DOM・選択・注釈を破棄する方法は避ける。

現在はSSR／`renderToStaticMarkup`でも同期結果を使うテストがある。browserからpluginを外すならserver向けadapter／entryを分け、**出力互換の検査は残す**。SSR分岐を削除してテストを緩めるだけでは完了にしない。

KaTeXのCSS／fontは、数式の完成表示と同時に正しく利用できるようにする。JSだけ外した場合と、CSSも遅らせる場合は別変更として扱う。

### chunkの失敗

React.lazyはPromiseをcacheするので、Error Boundaryをresetするだけでは必ず再fetchされるわけではない。[1] Viteのpreload error例にあるような無条件`location.reload()`も、未保存draft・送信状態のあるpigへそのまま適用しない。

shellと現在の会話を残し、対象画面／terminalだけに失敗を限定する。必要なエラーは既存通知UIへ出し、Composer下へ状態文を増やさない。実配布の`views://`、相対asset URL、遅延CSS、update後の古いchunk参照を確認する。[2][3]

## 7. account別catalogを後で分割する場合

第一段階では既存catalogを丸ごと返す。これが実ユーザー条件で支配的と分かった場合だけ、次を追加する。

- provider／accountごとに`notLoaded/loading/ready/error`を持ち、`[]`による代用をしない。
- default accountも明示的なscopeとして扱い、union catalogへfallbackさせない。
- host startupId、catalog revision、provider registration、account identity／変更revision、必要ならsession addressで要求と結果を結びつける。credential本体はwireに出さない。
- login／logout／account削除／provider再登録／model visibility・effort変更後に無効化する。
- 検索対象が未読込accountまで含むかを明確にする。選択中accountだけ取得して、全account検索ができるように見せない。
- 最近使ったmodel・default model・session-local catalog・account lockを維持する。表示cacheを送信許可の根拠にしない。

ここまでの契約が必要なので、起動改善の最初のPRへ混ぜない。

## 8. 段階的な実装案

| 段階 | 変更 | 完了条件 |
| --- | --- | --- |
| 0 | startup traceとartifact境界の小さなPoC | 配布形式でSDKの早期評価がないことを検査。Window／shell／agent-readyを別計測 |
| 1 | UIのページ／terminal／Markdown fallback分離 | initial chunkの依存削減、実描画・terminal・fallbackの回帰なし |
| 2 | service factory／依存注入／disposeを抽出。起動順はまだ維持 | 現行の動作・module identity・loader直列化・復旧が変わらない |
| 3 | service別artifactとshell先行起動 | 実Windowが早まる。初期化中のcloseでSDKを新規起動せず、遅い完了もcleanup |
| 4 | shell bootstrap／statusとcatalogを分離 | 取得中が未接続に化けず、設定競合・接続lease・event取りこぼしを処理できる |
| 5 | 必要な場合だけaccount catalogのオンデマンド化 | account間混線なし、検索・選択・無効化仕様を満たす |

段階0〜4が今回の推奨範囲。UI表示を早めてもagent-readyが大幅に悪化すれば完了にしない。前回のSDK部品計測の時間を、そのまま改善見込み秒数と見なさない。

## 9. 必須の回帰検証

### 自動検査に追加したいもの

- **生成物の依存境界**：source import lintだけでなく、shell entryのstatic import closureにSDKがいないこと。sentinelを使ってservice開始前の評価0回、開始後1回。
- **single-flight／shutdown**：同時10要求でもfactory1回。import待ち・factory待ち・ready直後のclose。dispose重複0、shutdownを起点にした新規SDK読込0、旧generationのready採用0。
- **stateful module**：shellで変更した設定がSessionHostのgetterへ届く。usage observerが同じruntimeのresponseを受ける。loaderQueue／theme／OAuth登録を複製しない。
- **metadata競合**：snapshot待ち中のsettings／appearance／projects／pin変更、legacy移行、失敗後の再照会で巻き戻らない。
- **接続／復旧**：ready通知の欠落、pagehide→遅いready、host変更、reconnect、retained draft／send intent復元。promptの自動再送0。
- **auth／catalog**：未取得と0件を区別。標準account・追加account・session-local provider・logout直後の古いcatalogで混線しない。
- **terminal**：chunk読込遅延・失敗・15秒期限・close・hidden surface、subscribe-before-ready、ACK順、IME・入力・フォーカス。
- **Markdown**：Worker正常・失敗・利用不能・SSRの出力、safe URL／raw HTML／数式、既存code DOM・選択・scrollの保持。
- **配布**：repository外、空profile、`bun --no-install`、SDKのWasm／worker／theme／package identity、`views://`の遅延JS／CSS。

実装後は型検査、Lint、SDK packaging／post-build tests、該当runtime／startup testsに加え、必須の`mise exec -- pnpm test:ui`を実行する。shellの見せ方・状態変化は既存の[UIガイド](ui-guidelines.md)に従い、表示位置・高さを状態ごとに跳ねさせない。

### 実機計測

Window可視化、shell paint、最初の操作反映、catalog ready、agent readyを別々に測る。cold OS cache／warm再起動、通常利用profile／空profile、開発／配布buildを混ぜない。JS heapだけでなく、初期化後・利用後のprocess memoryも確認する。

## 10. 今回実施した検証と限界

追加script：`apps/desktop/scripts/study-startup-boundaries.ts`。

```powershell
mise exec -- bun --no-install apps/desktop/scripts/study-startup-boundaries.ts
& ./apps/desktop/build/dev-win-x64/pig-dev/bin/bun.exe --no-install apps/desktop/scripts/study-startup-boundaries.ts
```

- SDK／アプリmoduleを実行せず、sourceの静的走査と小さなin-memory buildだけを行う。
- Bun 1.4.2／同梱1.4.4で4方式の読込境界を確認。両方で同じ結果。
- 既存のstartup、runtime connection、account picker、opening sends、terminal transport、draft closeの6ファイルを再実行し、22テスト成功。親テストから起動する隔離child内の検査も含む。
- 追加scriptの型検査・Biome checkを確認。
- 実Electrobunの別service artifactのbuild／relocation／native起動はまだ未検証。実ユーザーの拡張のcancel・再試行可能性を保証したものでもない。
- 実装後のUI・起動速度・メモリの改善幅は未検証。今回はUI変更がないため`test:ui`は実行していない。

## 参照

1. [React: lazy](https://react.dev/reference/react/lazy) — component型の定義位置、Promise cache、rejectとError Boundary。
2. [React: Suspense](https://react.dev/reference/react/Suspense) — 未mount状態、再suspend、layout effectのcleanup。
3. [Vite 6: Building for Production](https://v6.vite.dev/guide/build.html) — relative base、chunking、preload error。
4. [Bun: Bundler / splitting](https://bun.com/docs/bundler) — 一般的なcode splitting機能。Electrobunの公開設定とは区別。
5. プロジェクトの`rpc.ts`／`startup.test.ts`／`account-picker.ts`／`draft-store.ts`／`opening-sends.ts`／`UIRequestBroker.tsx`／`TerminalDialog.tsx`／`terminal-ui.ts`。
6. ホストの`index.ts`／`pi-service.ts`／`session-host.ts`／`settings.ts`／`runtime-theme.ts`／`usage/observation.ts`／`user-catalog.ts`、導入済みSDKのresource loader、生成済みElectrobun設定型。
