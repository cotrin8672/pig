# 起動高速化候補のA/B計測

## 結論

`v0.6.0` / `91deb0c`を基準に、`perf/startup-ab-profile`で実行した隔離実験。
**製品コードは変更していない。配布アプリのクリック→Window可視化→操作可能までを測った結果ではない。**

- **最大の前倒し余地はSDKのartifact境界。** 追加2accountの試験ではWindow作成**呼出し**まで1141.6ms→9.0ms。ただしサービス準備完了は1141.6ms→1229.2msで、仕事そのものを1秒減らしたわけではない。
- **UI分割の組合せは実際に軽くなる。** 初期JS 1,496,591→820,930 bytes（45.1%減）。HTML受信後の初期化反映136.1→103.8ms、初期ScriptDuration 50.1→36.2ms。CPU 4倍低速化条件では595.3→475.7ms。
- **単純な`React.lazy`＋`Suspense`はそのまま採用しない。** このfixtureでは初回の画面遷移／terminal／同期Markdown fallbackに約300msの待ちを作った。module promiseを共有する非同期componentで比べると、この待ちは避けられ、組合せの初回追加待ちは設定+8.5ms、terminal+17.5ms、fallback+14.2msだった。
- **未使用ページだけの分割は、今回の速度改善として弱い。** 約53KB削減できるが初期CPU時間の一貫した改善は確認できない。xterm分割の方が優先度は高い。
- **bootstrap分割と全account catalogのオンデマンド化は別。** SDK準備後のbootstrapは約23〜27ms。軽いmetadataの読出しは約0.2ms。追加accountの投影を省いても今回の短縮は約2〜4msで、account分離契約を変える理由には弱い。

これらの差は**加算できない**。とくにSDK待ちの前倒しとbootstrap待ちの前倒しは、処理の削除ではなくスケジューリング変更である。

## 1. 方法と範囲

### 共通

- Windows、Ryzen 7 5700X、16 logical CPU。
- source基準は`91deb0c9790233b3ce97014447e060371fe51252`。
- running pig／dev server／build lockは停止・変更していない。既存`dist`／`build`にも出力していない。
- user settings、credential、user extension、既存ブラウザprofileは使用していない。
- 各条件の順序を反復ごとに回転。OS file cacheは消去していないので「完全なdisk cold」ではない。
- 数値は中央値（偶数個のbootstrap集計は上側中央）。JSONには全sampleとmin/maxを保存。信頼区間や有意差検定ではない。

### UI

`apps/desktop/scripts/profile-startup-ui-ab.ts`でViteの本番buildをメモリ上に生成。
実際の`App`・RPC controller・store・ページ・terminal broker・Markdownを使用し、Electrobun transportだけfixtureに置換した。

- Edge 157.0.4341.42 / V8 15.7、1280×840、fresh headless browser profile、HTTP loopback、cache無効。
- 40 models、1 provider、標準account＋追加2accountのsynthetic bootstrap。projects／history／draftは空。
- native CPU: 8条件×7反復。CDP CPU throttling 4倍: 5条件×5反復。
- CPU profileは別の1反復ずつで採取し、反復集計には含めていない。
- 各browserを閉じ、profileを削除。build用Bunには試行前にGCを要求する。
- `readyAfterHtmlMs`: HTMLの`responseEnd`から、`initialized`通知後の2回のrAFまで。実ユーザーのキー入力遅延やSDK readinessではない。
- `fcpAfterHtmlMs`: 同じ起点からFCPまで。FCPの存在を待って取得し、欠測・非finite metricは失敗にする。
- `scriptDurationMs`／`taskDurationMs`: 初期化後、初回機能操作**前**のCDP累積値。compile／layout等の内訳を完全に表す一つのwall timeではない。
- 操作は実際のnavigation／broker／componentを使うprogrammatic操作。DOM成立またはterminal `ready`を待ち、2回のrAFまで測る。warm操作は同一browser内で再訪する。
- 数式はWorker正常系とWorker無効時を別の本文で試す。全試行でWorkerのcompleted／failedとmain-thread engineへのfallback不使用を検査。cache hitでfallback試験を代用せず、分離したengineのloadも検査する。

HTTPのHTML応答終了が試行により大きく揺れた。通常CPUのnavigation起点のreadyはbaseline 198.0〜266.8ms、combined-managed 126.2〜363.8ms、一方でpage系等には約1.4秒の試行も残った。
そのため**navigation全体の中央値の差を製品の起動短縮とは扱わず**、raw timingを残した上で、HTML受信後の区間とCDP CPU値を主に比較した。
この区間にもJS／CSS転送とrenderer schedulingは含まれ、WebView2の`views://`と同じではない。

### Host／bootstrap

`apps/desktop/scripts/profile-startup-host-ab.ts`で実際の`index.ts`をBun single-file buildし、SDK external化は維持。
Electrobun native APIだけproxyに置換して、Window constructor到達と実際のbootstrap handlerを測った。

- builder Bun 1.4.2、childは既存dev配布物のBun 1.4.4。
- 3構成×追加account数0/2/10×7反復＝63 fresh child processes。
- fresh HOME／APPDATA／XDG／agent dir。環境変数もallowlist化。OAuthはsyntheticで有効期限内、API呼出しは行わない。
- `PI_OFFLINE=1`に加えて`fetch`を拒否。全63試行でnetwork attemptsは0。
- 追加accountがある条件は標準OpenAI Codex credentialもある。表示modelはSDK builtinの8件。実利用者の大きいremote catalogの再現ではない。
- timer開始はchildのfixture生成後、host artifact import直前。launcher／Bun process起動を含まない。
- 各processのサービス準備後、bootstrapの`all`／`none`／`first`を順序回転して4回ずつ呼ぶ。各scopeの集計は28読出しで、cold 1回だけの集計ではない。
- `none`／`first`が省くのは追加account catalogだけ。標準provider scopesとunion modelsは残す。製品にそのまま適用できるprotocol変更ではない。
- 一時artifactはworkspaceの`node_modules`をjunctionで参照する。**relocated packageの配布検証ではない。**

## 2. UI候補ごとの結果

通常CPU、各7反復。時間はms、サイズはminify後・非gzipの初期JS。
`managed`はmodule promise/cacheを共有し、effectでcomponentを反映する比較用実装。失敗／取消し／保持状態を含む完成品ではない。

| 条件 | 初期JS bytes | HTML後の初期化反映 | 初期ScriptDuration | 主な初回操作 |
| --- | ---: | ---: | ---: | --- |
| baseline | 1,496,591 | 136.1 | 50.1 | 設定32.7、terminal48.3 |
| pages / Suspense | 1,443,186 | 143.1 | 50.1 | 設定333.3 |
| pages-managed | 1,443,283 | 129.8 | 48.0 | 設定47.9 |
| terminal / Suspense | 1,199,488 | 117.3 | 40.0 | terminal349.2 |
| terminal-managed | 1,199,652 | 112.9 | 39.6 | terminal66.0 |
| Markdown fallback / Suspense | 1,171,315 | 118.4 | 47.1 | fallback328.8 |
| all / Suspense | 820,955 | 96.5 | 34.8 | 設定336.3、terminal349.6 |
| all-managed | 820,930 | 103.8 | 36.2 | 設定41.2、terminal65.8 |

`all-managed`とbaselineのHTML後区間は、それぞれ94.5〜117.4ms、126.0〜157.6ms。
HTML後FCPは124.4→95.1ms、TaskDurationは96.0→79.8ms。

### 初回へ移る待ち

| 操作 | baseline | all / Suspense | all-managed | managedのbaselineとの差 |
| --- | ---: | ---: | ---: | ---: |
| Settings初回 | 32.7 | 336.3 | 41.2 | +8.5 |
| Providers初回 | 35.6 | 332.7 | 37.4 | +1.8 |
| Extensions初回 | 33.5 | 332.3 | 33.0 | -0.5 |
| terminal `ready` | 48.3 | 349.6 | 65.8 | +17.5 |
| Worker数式初回 | 144.0 | 143.8 | 132.9 | -11.1（小差を改善と断定しない） |
| Worker無効の数式初回 | 43.6 | 331.1 | 57.8 | +14.2 |

warm Settings／Providers／Extensionsは、baseline 32.6／32.0／33.6ms、all-managed 32.3／32.9／32.7ms。
初回のReact Suspense側の約300msを、単なるchunk転送時間と見積もるべきではない。
実装時はmodule失敗通知、表示を失わないfallback、terminal ready期限／subscribe-before-ready／parser ACKを別途検証する必要がある。
今回のterminal操作は実brokerを通すが、terminal出力のbackpressure全体を検証した試験ではない。

### CPU低速化での感度

CDPの4倍低速化、各5反復。低性能PCそのものの再現やOS／disk／networkの4倍低速化ではない。

| 条件 | HTML後の初期化反映 | 初期ScriptDuration |
| --- | ---: | ---: |
| baseline | 595.3 | 310.4 |
| pages-managed | 594.6 | 323.9 |
| terminal-managed | 505.4 | 248.9 |
| Markdown fallback / Suspense | 578.8 | 320.4 |
| all-managed | 475.7 | 211.8 |

combinedのHTML後区間は456.1〜543.9ms、baselineは526.9〜740.0ms。
combinedによる短縮は中央値で119.6ms、ScriptDurationは98.6ms。
主にxtermを外す効果が見える一方、page分割だけのCPU改善はここでも確認できない。
別の反復runではcombinedの短縮が通常CPUで約27ms／4倍低速化で約80msだった。
表とJSONはWorker経路の検査を追加した最終runで、差の大きさにはrun間の変動もある。

### メモリとtheme

- 初期`performance.memory.usedJSHeapSize`の中央値は6.45→4.36MiB（約2.09MiB減）。GC未強制のpage初期値であり、WebViewのRSS／private bytes／アプリ全体の削減量ではない。
- DynamicThemeの`createThemeTokens`はbaselineで6.3ms、4倍低速化で39.0ms。別途採取したCPU profileにも配色計算が現れる。
- themeのキャッシュ化・設定反映の遅延は今回実装していない。上記はコストの計測で、同じ時間だけ必ずpaintを短縮できる証拠ではない。
- hostのheap/RSSはサービス準備と12回のbootstrap後の参考値。SDKを別artifactに移しても準備後の保持runtimeは同じで、総メモリ削減とは扱わない。

## 3. SDK／service artifact境界

時間はms。`Window call`はnative proxy constructorに到達した時刻で、可視化・paint時刻ではない。

| 追加account数 | 構成 | Window call | host準備完了 |
| --- | --- | ---: | ---: |
| 0 | 現行bundle | 1301.7 | 1301.8 |
| 0 | local importのみ | 949.7 | 1186.4 |
| 0 | 別artifact | 9.2 | 1194.4 |
| 2 | 現行bundle | 1141.6 | 1141.6 |
| 2 | local importのみ | 920.8 | 1161.8 |
| 2 | 別artifact | 9.0 | 1229.2 |
| 10 | 現行bundle | 1184.3 | 1184.4 |
| 10 | local importのみ | 903.1 | 1149.6 |
| 10 | 別artifact | 9.4 | 1157.6 |

追加2accountでの範囲：現行Window call 1107.3〜1260.7ms、別artifact 8.1〜10.8ms。
別artifactのmetadata読込自体は中央値約0.6ms。その後に同じ重いhost artifactを固定runtime URLでimportする。

- 現行出力: 1,107,579 bytes、SDKのstatic import宣言13本。
- local import版: 1,121,193 bytes、static import宣言13本が残る。
- 別artifactのshell entry: 22,975 bytes、SDK static importなし。重いartifactは別途必要で、配布総量が22KBになるわけではない。
- local importでもサービス本体の評価は後ろへ移るが、SDK依存評価は約0.9秒残った。別artifactと同じ前倒しにはならない。
- 追加2accountの現行`createModelRuntime`は約54ms、user catalog初期化約85ms。この区間もSDK依存の評価やWindow前の他処理と区別する。

**これは`createAppServices(deps)`の完成実装ではない。** 比較wrapperは軽いmetadata moduleを別途bundleし、既存hostのWindowをproxyで一つに束ねている。
settings／DesktopStateStore等の重複所有、dispose、shutdown、初期化中の設定変更、failure/retryを解決していない。
productionでは前回の[所有権・lifecycle設計](desktop-startup-implementation-study.md)が必要。

また、別artifact importを開始してもSDKの同期評価は同じBun event loopを使う。
「Windowを作れる」は測れたが、「SDK準備中も全shell RPCが応答する」は未検証。測定値をそのまま1.13秒早い操作可能状態と読まない。

## 4. bootstrap／catalog

現行bundleでのSDK準備後のhandler時間。各scope 28読出しの中央値。

| 追加account数 | 現行: 全追加account | 追加account省略 | providerごとの先頭追加accountのみ | 現行bytes → 先頭のみbytes |
| --- | ---: | ---: | ---: | ---: |
| 0 | 23.7 | 23.5 | 22.6 | 6,931 → 6,931 |
| 2 | 25.1 | 21.9 | 22.5 | 17,016 → 14,559 |
| 10 | 27.2 | 22.8 | 24.4 | 37,336 → 15,223 |

JSON stringifyは約0.1〜0.2ms。追加account 10でも先頭だけにした短縮は約2.8ms。
現行bootstrapには44個の標準provider scopesがあり、省略試験でもそれらとunion modelsは残す。

settings／appearance／desktop等の**小さいmetadata subset**は約504 bytes、サービス準備後の再読出しは約0.2ms。
このsubsetをshellが所有すれば、catalog取得約23〜27msを主要画面表示のgateから外せる余地がある。
ただし、これは本番のshell RPC／revision／ready stateを実装して測った結果ではなく、SDK準備前のcatalog取得時間とも足せない。

全accountオンデマンド化は引き続き保留。missing catalogをunionへfallbackする既存contractのまま省略するとaccount混同が起こり得る。
今回の数msより、安全な未取得状態・invalidation・検索・選択を設計するコストの方が大きい。

## 5. 実装の優先順位と未計測項目

1. **xtermの遅延境界**を小さく実装し、初回readyの追加待ちを実端末で確認。root brokerは残す。約300msのSuspense待ちを作る実装は避ける。
2. **SDKを含まないshell／service artifact**を独立PoCにする。UI軽量化より大きなWindow前の前倒し余地があるが、native/package・共有状態・event loopの検証が必要。
3. **shell metadataとcatalogを分離**。空catalog／未接続に見せず、loading/ready/errorの契約を残す。
4. Markdown fallback分離は組合せで確認。単独の通常CPU試験では速度改善は弱く、主な利点は初期サイズ／heap。page分割だけの優先度は低い。
5. account catalog完全オンデマンド化、SDK準備前send queue、自動retry、別process化は今回の数字だけでは進めない。

未計測／未実装：

- launcher→native Window可視化、WebView2初期化、`views://`のchunk読込、relocated package。
- shell先行RPCと実際の初回agent送信を含む**native end-to-end combined**。UIとhostの差を加算して代用しない。
- 実user credential／extension／history／catalog、network有効の起動、大量cache・custom renderer、process全体のprivate bytes。
- completed service factoryのdispose／late completion／shutdown／module失敗／terminal parser ACKの回帰試験。

稼働中dev環境のproject build lockは触っていない。配布物の次段階は、独立worktree／出力先と隔離profileで行う。
なお`v0.6.0`はtag push済みだが、CI／Releaseのテスト失敗により**release未公開**だったことを確認した。
当該[CI](https://github.com/cotrin8672/pig/actions/runs/43355748157)のtranscript UI／real SDK adapter、
[tag Release](https://github.com/cotrin8672/pig/actions/runs/43355748372)のtranscript UI／inline worker失敗の修正は、本計測branchに混ぜていない。

このbranchのローカル検証は`pnpm lint`、`pnpm typecheck`、`pnpm test:ui`（5件）、
`PIG_REQUIRE_UI_TESTS=1 pnpm test`（852件）を通過。これは通常sourceに対する回帰検証であり、
全variantで全テストを実行した意味ではない。各variantでは上記の実画面・terminal ready・Worker・fallbackのprofiling probeを通した。

## 6. 再現コマンドと証跡

repository rootで実行。Bunのpathは使用する配布runtimeに合わせる。

```powershell
mise exec -- bun --no-install apps/desktop/scripts/profile-startup-ui-ab.ts --samples=7 --report=docs/performance/startup-ui-ab-native.json
mise exec -- bun --no-install apps/desktop/scripts/profile-startup-ui-ab.ts --samples=5 --cpu-rate=4 --only=baseline,pages-managed,terminal-managed,markdown,all-managed --report=docs/performance/startup-ui-ab-cpu4x.json
mise exec -- bun --no-install apps/desktop/scripts/profile-startup-host-ab.ts --samples=7 --accounts=0,2,10 --bun=./apps/desktop/build/dev-win-x64/pig-dev/bin/bun.exe --report=docs/performance/startup-host-ab.json
mise exec -- bun --no-install apps/desktop/scripts/profile-startup-ui-ab.ts --samples=1 --only=baseline,all-managed --cpu-profile-prefix=docs/performance/startup-cpu --report=docs/performance/startup-ui-cpu-sample.json
```

- [UI通常CPUの全sample](performance/startup-ui-ab-native.json)
- [CPU 4倍低速化の全sample](performance/startup-ui-ab-cpu4x.json)
- [Host／bootstrapの全sample・生成物import一覧](performance/startup-host-ab.json)
- [CPU profile採取時の参考値（集計とは別）](performance/startup-ui-cpu-sample.json)
- [baseline `.cpuprofile`](performance/startup-cpu-baseline-1.cpuprofile)
- [all-managed `.cpuprofile`](performance/startup-cpu-all-managed-1.cpuprofile)

出力JSONをrepositoryで保管する場合は`mise exec -- pnpm exec biome format --write docs/performance`で整形する。

`.cpuprofile`はDevToolsのJavaScript Profilerで開ける。1ms sampling・単一試行・minified nameで、細かい関数順位の精密比較には使わない。
仮のHTTP URLに対するprofileであり、永続的に配布したJS／sourcemapではない。
