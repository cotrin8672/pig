# 今後の実装に向けたパフォーマンス技術選定

## 結論

**Electrobunを維持し、TypeScriptで制御・UIを実装しながら、計測で必要になった計算部分だけWasmまたはRustネイティブへ切り出す構成は十分可能。Tauriへの移行はその前提ではない。**

ただし、言語より先に決めるべきなのは、実行場所、データの所有者、処理量の増え方。Rust化、別スレッド化、省メモリ化は別々の判断である。

推奨する基本構成：

```text
WebView UI thread：入力、表示状態、React、DOM
  ├─ Web Worker：表示に近い解析・変換
  │    ├─ まず既存JSライブラリ
  │    └─ 必要なカーネルだけRust/C製Wasm
  └─ Electrobun RPC：要求、変更通知、必要な範囲のデータ
       Bun：SDK、拡張、ファイル、認証、セッション制御
         ├─ 少数のBun Worker：ホスト側のCPU処理
         ├─ Node-API：頻繁に使うネイティブ処理
         └─ Rust sidecar：重いサービス、独立した停止・再起動が必要な処理
```

当面は **JS Worker → 既存Wasmライブラリ／Rust Wasm → 必要ならNode-APIまたはsidecar**。ただしファイル検索等、OS側にデータがある機能は最初からBun／ネイティブ側に置く。全処理をこの順番で書き直すという意味ではない。

調査は現在の作業ツリー、生成済みElectrobun devkit、公式ドキュメント・公式リポジトリを対象とした。製品コードの変更、アプリ再起動、今回新たな速度・メモリのベンチマークは行っていない。下記の「可能」は、pigの配布版での動作・性能保証とは区別する。

## 1. 現在地：まだ導入していない技術と、すでに使っている技術

| 項目 | 現在の確認結果 |
| --- | --- |
| シェル | Electrobun 2.0.6。`build.mainProcess: "bun"` |
| WebView | 各OSで`bundleCEF: false`。WindowsはWebView2。独自の軽量描画エンジンではない |
| UI | React 19、Zustand、Vite 6 |
| 表示解析 | 作業ツリーにMarkdown／KaTeXとShiki用のWeb Workerが存在。JS Worker方式はすでに採用されている |
| ハイライト | Shiki 4.6.0のJavaScript RegExp engine。現状はOniguruma Wasmではない |
| Rust製Wasm | `@silvia-odwyer/photon`をBunから利用。`images.ts`で`initSync`、`PhotonImage`、`free()`を使用 |
| ネイティブ呼び出し | Windowsクリップボードで`bun:ffi`を使用 |
| UI↔ホスト | 導入済みdevkitの通常RPCはJSON。loopback WebSocketではAES-GCMのラッパーを利用し、native bridge fallbackもある |
| ホスト内JS | devkitのBun pinは1.4.4。WebView2内のV8とは別のJavaScriptCoreランタイム |
| Rustメイン | devkitの設定型に`mainProcess: "rust"`があり、同梱`rust-sdk/Cargo.toml`のversionも2.0.6 |

根拠：

- `apps/desktop/electrobun.config.ts`
- `apps/desktop/package.json`
- `apps/desktop/src/bun/index.ts`
- `apps/desktop/src/bun/images.ts`
- `apps/desktop/src/bun/windows-clipboard.ts`
- `apps/desktop/src/mainview/{syntax-engine,markdown-engine,render-worker-queue}.ts`
- `apps/desktop/src/mainview/{syntax-worker-client,markdown-worker-client}.ts`
- `apps/desktop/.hutch/devkit/api/{config/ElectrobunConfig.ts,shared/bun-version.ts,browser/index.ts}`
- `apps/desktop/.hutch/devkit/api/sdks/main/core/BrowserView.ts`
- `apps/desktop/.hutch/devkit/rust-sdk/Cargo.toml`

これらは**現在の作業ツリー／ローカルdevkit**の確認結果。未コミットのWorker・差分配信等があるため、インストール済みアプリにも反映済みとは扱わない。既存調査の速度やrendererメモリの参考値は[断続的入力遅延の調査](desktop-ui-stall-investigation.md)にあるが、今回の実測値ではない。

## 2. ElectrobunとTauriについての整理

### WebViewを使うこと自体は、どちらにも共通する

TauriもWindowsではWebView2、macOSではWKWebView、LinuxではWebKitGTKを利用する。[1]

したがって「システムWebViewを使うからElectrobunの方が描画・メモリで有利」とは一概に言えない。Electrobunの主な適合理由は、**既存のTypeScript製エージェントSDK・拡張を、そのままBunホストに置けること**。Rustを書かずに済むというだけでなく、二重のバックエンドとその通信を避けやすい。

一方、TauriのRustホストには、ネイティブのデータ構造・スレッド・ライブラリを主系として使いやすい利点がある。ただし同じReact画面を載せ替えても、DOM、layout、画像デコード、WebView側のJS保持は自動では軽くならない。JS SDKを残すなら、Tauri側にもBun/Node sidecar等が必要になり、Rustホスト分が単純な削減になるとは限らない。

### ElectrobunのままRustメインにする選択肢もある

2.0.6のローカルdevkitと公式Rustガイドで対応を確認した。[2][3]

ただし、これは「設定を変えれば既存TSホストがRustとして動く」という機能ではない。ウィンドウのライフサイクル、callback、RPC handler等の実装を移す必要がある。公式資料ではネイティブSDKはcoreに近い手続き型APIで、TypeScript SDKと同等の高水準APIではない。特にtyped RPC相当のenvelopeはraw JSON bridge上で自分で扱う。[4]

pigではSDK／拡張を引き続きJSで実行する必要があるため、Rustメイン＋Bun sidecarは構成が複雑になる。**ホスト側の大部分がネイティブ処理になる場合の将来案であって、今の第一候補ではない。** Tauriとの比較は、その段階でAPI・配布・保守性も含めて行えばよい。

## 3. 選択肢の比較

| 選択肢 | 主に得られること | メモリ面 | 導入・運用コスト | 判断 |
| --- | --- | --- | --- | --- |
| Web Worker＋JS | 入力スレッドからCPU処理を分離。既存ライブラリを再利用 | Workerごとのheap、module、cloneが増える可能性 | 低〜中 | 表示解析の標準候補 |
| Web Worker＋Rust/C Wasm | 計算速度、compactな内部表現、Web/Bunでコアを再利用 | allocator管理は可能だがlinear memoryとJS側コピーが増える | 中 | 計算密度の高い部分だけ |
| Bun Worker＋JS/Wasm | ホストのevent loopからCPU処理を分離 | 別heap。SDK一式の再importは高コストになり得る | 中 | ファイル側・ホスト側の計算 |
| Rust Node-API addon | native実行、OS／スレッド／SIMD／既存native library | 二つ目のJS VMは不要。バッファ寿命管理は必要 | 中〜高 | 頻繁で太いnative処理 |
| Rust `cdylib`＋`bun:ffi` | 小さなC ABIで直接連携 | 明示的な所有権管理。誤りはホストcrashにつながる | 中〜高 | 限定用途。新規の標準経路にはしない |
| Rust sidecar | process単位のcrash分離、停止、再起動、メモリ回収 | process overheadとIPC。終了で回収しやすい | 高 | 検索・索引等の独立したサービス |
| Electrobun Rustメイン | JSを経由しないホスト主体の構成 | Bunを本当に外せる範囲で効果 | 非常に高 | SDK制約を考えると保留 |
| Tauriへ移行 | Rust中心のアプリ基盤 | WebView部分は残り、JS SDK用runtimeも必要になり得る | 非常に高 | 性能だけを理由に現時点で選ばない |

### A. Web Worker＋JS：非同期APIだけでは代わりにならない

`async`、Promise、Reactの優先順位制御は、同期parserの途中に入力処理を割り込ませる仕組みではない。WorkerならUIとは別のJS実行環境に処理を出せる。ただし結果から作るReactツリー、commit、DOM/layoutはUI側に残る。

Workerはセッションごと・メッセージごとではなく、機能単位の少数を遅延起動する方針がよい。複数Workerに大きな文法・parser・cacheを重複ロードしない。JS objectの巨大なASTを往復させればcloneとallocationが新しい支配項になる。

既存の`render-worker-queue.ts`には一つのWorkerに一つのin-flight jobという制御がある。ただし計算開始後のキャンセルは結果の破棄であり、同期計算そのものを止めるわけではない。

### B. Rust Wasm：実現可能。ただしWorker内で、粗い単位で使う

典型的な構成はRust crateを`wasm32-unknown-unknown`向けにbuildし、`wasm-bindgen`／`wasm-pack`でJS glueを生成してWorkerから初期化するもの。[5]

**向いている処理：** 大きな文字列の走査・検索、diff、tokenize、画像変換、圧縮、compactな索引。入力に対して計算が十分多く、返す結果を小さくできるもの。

**向きにくい処理：** React component、DOM/layout、ネットワーク待ち、細かいJS objectを大量に読み書きする処理、SDKのextension hookそのもの。

注意点：

- Wasm関数も通常は呼出元スレッドで同期実行される。UI上で重いWasmを呼べばUIは止まる。
- JS文字列とRustのUTF-8文字列の変換、JS→Wasm memoryのコピー、結果のJS object化を含めて比べる。関数単体の速さだけでは判断しない。
- 行／tokenごとにJSへcallbackせず、まとまった入力からoffset配列・token run等を返す。大きなJSON ASTを再構築すると利点を失い得る。
- Rust側でUTF-8 byte offset、UI側でUTF-16 indexを使う場合、絵文字・日本語・CRLFを含む位置対応が必要。既存の選択・注釈の契約を壊さない。
- Wasmは単独でファイルやOS APIを直接使えない。必要なhost機能は明示的に渡す。ブラウザ向けWasmとWASIは別で、WASI対応crateがそのままWebViewで動くわけではない。
- Wasmの`free()`はallocator内を再利用可能にしても、linear memoryのページ数をそのまま縮めるものではない。一般的なMemory APIはgrowのみ。[6] 巨大入力後の高水位が残る場合、instance／Workerの寿命も設計する。
- Wasm SIMDは候補になるが、native x86向けSIMD featureをそのまま有効にする話ではない。スレッド対応も別途必要。

#### Vite／views://の制約

Vite 6は`.wasm?init`を提供するが、WasmをES moduleとして直接importする統合は標準対応ではなく、生成glueによっては追加の扱いが必要。[7]

最小の導入候補は`wasm-pack --target web`の出力を使い、Worker内で生成glueを明示的に初期化する方法。**生成glueを無視して、bindgen用Wasmを裸の`?init`だけで呼べると考えない。**

現在は`?worker&inline`でblob Workerを使っている。そこへWasmを加えるなら、相対URLの基準をblobに任せず、Viteで解決したasset URL／Wasm bytesを明示する。以下を配布アプリで確認する：

- `views://`からWasm assetを取得できるか、MIME、CSP、Worker起動・初期化。
- `instantiateStreaming`がMIME等で使えない場合に、bytesからinstantiateできるか。
- Viteの`dist/assets`から配布物へのコピー、SDK／依存packageの隣接Wasmの同梱。
- 開発用HTTPだけでなく、実際のWindows WebView2。将来のmacOS/Linuxも別々に確認。

通常の単一Worker内WasmはSharedArrayBufferを必要としない。Rayon等による**Wasm内部のマルチスレッド化**にはshared memoryとブラウザのcross-origin isolationの成立確認が必要。COOP/COEP等の条件を`views://`で満たせるとはまだ確認していないため、第一段階から前提にしない。[8]

### C. Bun Worker：ホストをUIの代わりの詰まり場所にしない

UI処理をBunメインへ移すだけでは、SDKイベント処理、RPC応答、terminal I/O等とCPUを取り合う。ファイルのある側でCPU処理をするなら、Bun Workerへ分離する選択肢がある。[9]

Bunの公式Worker資料には、特にterminate周辺をexperimentalとする注意書きがある。ブラウザWorkerとBun Workerを同じ成熟度・寿命保証で扱わず、**同梱Bun 1.4.4**で起動、bundle、終了、異常系を検査する。ローカルCLIのBunでの成功だけでは不十分。

SDK sessionやclass instanceをそのままWorkerへ送るのではなく、入力bytes、ID、revision等の小さな契約にする。`smol: true`はメモリと速度の交換条件であり、UXを落としてまで一律指定する方針にはしない。

### D. Node-APIとFFI：ネイティブでも呼出し方は重要

Rustからは`napi-rs`等でNode-API addonを作り、Bunから`.node`をロードできる。BunはNode-APIを実装しているが、すべてのAPI・addonの完全互換を保証する説明ではない。[10]

CPU処理はnapi-rsの`AsyncTask`等でホストJS thread外へ出す。`compute`が速くても、`resolve`で巨大なJS objectを作ればメイン側に負担は残る。実行済み処理の中止も、PromiseやAbortSignalだけで保証されない。[11]

配布には対象OS／CPU別のartifact、Windows build tools、依存DLL解決、ロードとshutdownの試験が必要。ネイティブのcrashはBunホスト全体を巻き込む。

`bun:ffi`でRustのC ABIを呼ぶことも公式例にあるが、公式資料自身がexperimentalとし、安定性を重視するnative連携にはNode-APIを案内している。[12] 既存の限定的なWin32呼出しがあることと、今後の計算基盤をFFIで統一すべきことは別。

### E. Rust sidecar：重いサービス向け

BunからRust executableをspawnし、stdioのlength-prefixed protocol／JSONLやnamed pipe等で要求する方法。WebViewから直接起動する必要はない。

向くのは、大規模検索・索引、重い変換、ライブラリがcrashする可能性のある処理、確実なprocess再起動が必要な機能。Rust processは追加のJS VMを必要としないが、メモリや通信費がゼロになるわけではない。

要求ID、protocol version、revision、同時実行数、backpressure、最大frame bytes、終了時の子process回収を設計する。process killで計算を止められても、副作用やデータ損失の安全性は別問題。再起動してよい純粋な計算と、再送禁止の操作を分ける。

**別processであるだけではOS権限を制限するsandboxにならない。** RustやWasmへの移行を、project trust・認証・path検証の代替にしない。

## 4. 今後の機能別に、何を選ぶか

| 機能 | まず比較したい技術 | 留意点 |
| --- | --- | --- |
| Markdown／数式 | 現在のJS Workerを基準。必要ならpulldown-cmark／Comrak等をWasm化 | CommonMark parserだけでremark plugin・GFM・KaTeX・安全なURL処理が置き換わるわけではない |
| ハイライト | 同じWorker上でShiki JSとOniguruma Wasmを比較 | Wasmなら常に速いわけではない。Shiki公式もJS engineが言語によって速いと説明 [13] |
| ストリーミングコード | Shiki GrammarState、必要ならweb-tree-sitterの増分解析 | Rust化以前に全体再解析を減らせる可能性。末尾変更・文法状態の無効化が必要 [14][15] |
| 大きいdiff | Worker＋既存JSを基準に、Rust Wasmのcompactな差分結果と比較 | 計算量・最悪入力を評価。行ごとのJS callbackを避ける |
| 画像変換 | 既存Photon Wasmを基準。Bun Worker／native image library | 圧縮bytesだけでなく展開後pixelsとコピー数を見る。現在の同期Wasmも自動的に非blockingではない |
| 会話一覧・全文検索 | まずBun側のindex／`bun:sqlite`等。必要ならnative検索サービス | SQLite自体がnative実装。TSのままnativeの計算を使える。同期queryは長時間なら別thread等へ [16] |
| ファイル検索 | Bunから既存native検索ツール、必要ならRust sidecar | WebViewへ全ファイルを送ってからWasm検索する構成を避ける |
| SDK／拡張初期化 | Bun／TSを維持。副作用・寿命・共有可能なデータを整理 | 純粋な計算kernelでないため、Rust化の相性は低い |
| UI更新・巨大DOM | Reactの更新境界・データ表現・描画方式を検討 | WasmはReact commit／layoutを置き換えない。必要なら別途仮想化等をUX要件込みで評価 |

pulldown-cmarkはpull parserで、全文ASTを必須にせずeventとsource rangeを扱える。[17] ただし最終的に巨大HASTをJSに作り直すなら、その省メモリ特性がUI全体にそのまま引き継がれるわけではない。

Markdownの増分化は、閉じていないfenceだけでなく、後続のreference definition等で過去の解釈が変わる点に注意。「完成段落を永久固定」では互換性を維持できない場合がある。

WebGPU／WGPUは将来ローカル推論・大規模画像処理を載せる場合の別候補。通常の会話UI・DOM・文字列処理の汎用高速化手段ではなく、GPU memoryも使うため、今回の標準方針にはしない。

## 5. 省メモリのために、言語と独立して決めること

### データを誰が持つか

同じ本文について、SDK履歴、snapshot、IPC文字列、UI store、Worker入力、AST、token、React、DOM、画像pixelsが同時に存在し得る。Rustが削減できるのは、実際に置き換えた表現・allocationの部分だけ。

新しい機能では最低限、次を仕様に含める：

1. 原本を持つのは誰か。UIに全文が必要か、IDと表示範囲だけでよいか。
2. キャッシュの件数だけでなく推定bytes、寿命、利用者がいない場合の解放条件。
3. 同時job数、待機job数、入力／結果bytesの上限。進捗更新は最新をまとめられるか。
4. 「履歴を消す」ことと「再生成可能なASTを捨てる」ことを分ける。
5. 中断／遅い結果／Worker failure後も、本文・選択・draft・scroll・実行中sessionを守れるか。

### 転送方式の適用範囲

ブラウザUI↔Web WorkerならArrayBufferをtransfer listに入れてコピーを避けられる。ただし送信元bufferはdetachedになるため、storeの原本を誤ってtransferしない。文字列や普通のASTはtransferableではない。[18]

**このzero-copyはWebView↔BunのElectrobun RPCに自動で適用されない。** 導入済みdevkitはJSON.stringify／parseを使い、browser SDKのbinary Blob受信分岐も未実装コメントだった。TypedArrayをRPCに渡すだけでbinary／shared memoryになるとは扱わない。

巨大binaryが必要なら、別途認証されたasset URL／stream等のdata経路を設計し、既存RPCは小さなcontrol経路として残す。認証・origin・path・寿命管理を増やしてまで専用経路を作る価値があるかを計測する。暗号化を外すことを性能対策にしない。

### 寿命を制御するが、むやみに捨てない

Workerを常駐させればwarm性能はよいが、grammar／Wasm memoryの保持が続く。毎回終了させればmemoryを回収しやすいが、再compile／初期化待ちが戻る。少数pool、遅延起動、idle時の再生成可能cacheの解放を、実測で選ぶ。

idle sessionを閉じる施策は拡張の状態・queued prompt・切替速度に影響するため、単なるcache evictionと同一視しない。JS heapが減ってもprocess private memoryが直ちに同量下がるとは限らない。

## 6. 今後の実装方針として採用したい判断基準

新機能の設計段階で、以下を短く記録する運用がよい。

- **実行場所**：UI／Web Worker／Bun／Bun Worker／nativeのどこか。
- **負荷モデル**：履歴件数・文字数・画像pixels・同時session数に対してどう増えるか。追記ごとに全文再処理していないか。
- **境界の形式**：入力・結果のbytes、往復回数、コピー数。JS objectよりoffset／ID／compactな配列で表せるか。
- **メモリ所有権**：原本と再生成可能な派生物を分け、保持上限を決める。
- **UX契約**：入力、本文、選択、scroll、キャンセル、background完了通知を犠牲にしない。
- **配布契約**：OS／CPU別artifact、views://、同梱runtime、異常終了時も確認する。

言語選定の判定は、概念的には次の合計で行う：

```text
利用者が待つ時間 = queue待ち + 初期化 + 入力変換/転送 + 計算 + 出力変換/転送 + UI反映
```

計算kernelだけが速くても、他の項が増えれば採用しない。逆に、総計算時間が同じでも入力停止をなくせるWorker化は有効。処理全体の一部しかRustへ移さない場合、その一部の高速化率をアプリ全体の改善率と取り違えない。

## 7. 次に試すなら、この小さな比較から

一度にアーキテクチャを変えず、候補を別fixtureで比較する。

1. **既存技術だけの比較**：同じsyntax WorkerでShiki JS vs Oniguruma Wasm。cold／warm、言語別、追記・途中編集を測る。Wasmの一般的優位を仮定しない。
2. **Rust Wasmの小さなPoC**：将来必要なdiff／検索等、一つの純粋kernelを対象にする。同じ入出力契約でJS Workerと比較し、文字位置・出力一致も検査する。
3. **ホスト側の比較**：ファイル索引が必要になった時点で、Bun＋SQLiteを基準に、Node-API／Rust sidecarの必要性を判定する。

測るもの：

- 実入力から反映までのp50／p95とlong task。処理完了までのwall timeとは分ける。
- cold初期化、warm処理、queue待ち、入力／結果bytes、React commit／layout。
- Bun、renderer、WebView browser／GPU／utility、sidecar別のprivate memoryと推移。JS heap／DOM／Wasm memory／展開画像も可能な範囲で分ける。
- 新規起動、複数sessionの継続使用、大きいデータを閉じた後の回復。合成データだけでなく同意のある代表workload。
- 配布buildの`views://`と同梱Bunで確認する。dev modeの数字をそのまま採用しない。

WebView2自体がbrowser、renderer、GPU等の複数processを持つ。[19] 全体RAMはBunだけでもrendererのJS heapだけでも判断しない。working setの単純合算はshared pageを重複計上し得るので、private memoryとworking setは別の指標として記録する。

目標値はbaselineを採ってから合意する。メモリの固定目標を先に置いて、履歴の欠落、入力待ち、頻繁な再初期化を正当化しない。

## 8. 参照した一次資料

公式サイト／main branchの資料は調査時点の内容。pigに対するversion固有の根拠は第1節のローカルdevkit・lockfile・実装と分けて扱う。他環境向けの公式benchmark値は、pigの性能見込みには転用していない。

1. [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
2. [Electrobun: Hello World (Rust)](https://docs.electrobun.dev/electrobun/guides/hello-world-rust/)
3. [Electrobun: Main Process Runtimes](https://docs.electrobun.dev/electrobun/guides/native-main-process/)
4. [Electrobun: Main Process API / Runtime coverage](https://docs.electrobun.dev/electrobun/apis/main/)
5. [wasm-bindgen: Deployment targets](https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html)
6. [MDN: WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory)
7. [Vite 6: WebAssembly / Web Workers](https://v6.vite.dev/guide/features.html#webassembly)
8. [MDN: SharedArrayBuffer / Security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
9. [Bun: Workers](https://bun.com/docs/runtime/workers)
10. [Bun: Node-API](https://bun.com/docs/runtime/node-api)
11. [napi-rs: AsyncTask](https://napi.rs/docs/concepts/async-task)
12. [Bun: FFI](https://bun.com/docs/runtime/ffi)
13. [Shiki: RegExp Engines](https://shiki.style/guide/regex-engines)
14. [Shiki: Grammar State](https://shiki.style/guide/grammar-state)
15. [web-tree-sitter official README](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
16. [Bun: SQLite](https://bun.com/docs/runtime/sqlite)
17. [pulldown-cmark official README](https://github.com/pulldown-cmark/pulldown-cmark)
18. [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
19. [Microsoft: Process model for WebView2 apps](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)

追加候補として[Cottontail](https://docs.electrobun.dev/electrobun/guides/cottontail/)も確認した。ElectrobunのexperimentalなJSC runtimeで、モジュール化された標準機能等の設計はあるが、小さい配布物と少ない実行時RAMは同義ではない。SDK／native addon／Bun固有APIの互換検証が必要で、renderer負荷も解決しないため、今は標準候補にしない。
