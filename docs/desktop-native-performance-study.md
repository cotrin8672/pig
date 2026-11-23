# Windows版PiG：履歴高速化・Rust/GPUI・WMIの切り分け

対象: `dev` (`1083b1c` + 作業差分、履歴の重複読込除去済み)、
Ryzen 7 5700X、Windows、同梱Bun 1.4.4。製品コード・OS設定・稼働中PiGは変更していない。

## 結論

- **最初に試すのは、現行Bunの休止中履歴リーダー。** 1 MiB単位でバイトを切って
  JSONLを読む試作で、16 MiB/64 MiBのホスト処理の中央値を約4割削れた。
  Rustの全件パース試作は、このBun対照を上回らなかった。
- **GPUIは描画ホストの専有メモリを減らせる候補。** 普通のストリーミングの
  フレーム時間を大幅に縮める証拠はない。全面移行より、同じデータ・機能で
  1画面だけ比較するのが妥当。Pi SDK・拡張を維持する設計ではBunは残る。
- **WMIのCPUスパイクは実測したが、Electrobun起因の証拠は未取得。**
  PiG側にはアプリ更新時にWMIでプロセスを列挙する経路がある。
  通常利用時のスパイクの呼び出し元は未確定。

## 1. Rustで履歴読み込みを書き直す前に、Bunの読込経路を変える

[`readSessionFile`](../apps/desktop/src/bun/session-files.ts#L113) →
[`sessionHistoryDigest`](../apps/desktop/src/bun/session-files.ts#L49) →
`SDKProjector.historyPage`が対象。休止中は古い1ページを得るために
全件を読み、パースし、枝を検証し、再シリアライズして保存済みprefixを検証する。
ライブ時にはmanagerを再利用するので、ここを変えてもライブ時の描画は速くならない。

### 同一ファイルで比較した実験

合成v3 JSONLを各ケース一度生成し、Windowsのファイルキャッシュが温まった状態で実施。
64 / 512 / 2,048ターン。回答は個別の32 KiB ASCII本文。全ケースは同じ50レコードを
切り出す。各比較は2回ウォームアップ、順序を回転させながら11回計測、下表は中央値。
対象はホストの読込・検証・投影であり、WebView、ディスクのコールドキャッシュ、
RPC、画面表示を含まない。全条件でentry数・digest・ページの両端ID・本文長が一致。

| 壁時計時間の中央値 | 2.0 MiB | 16.2 MiB | 64.7 MiB |
| --- | ---: | ---: | ---: |
| 現行 `readline` + SDK manager + digest + ページ投影 | 16.0 ms | 108.0 ms | 381.9 ms |
| 現行、パス探索だけ除外 | 14.6 ms | 104.1 ms | 406.7 ms |
| Bun・全ファイルをバイト列として読み、行ごとにパース | 8.3 ms | 58.1 ms | 223.2 ms |
| **Bun・1 MiBずつ読み、行ごとにパース** | **10.3 ms** | **61.3 ms** | **234.9 ms** |
| Rust・常駐child往復、`serde_json` + SHA-256 | 7.8 ms | 60.0 ms | 236.8 ms |
| 参考：バイト読込＋生バイトSHA-256だけ | 2.1 ms | 17.0 ms | 64.4 ms |

別実行でも16 MiBのBun全読込とRustは約55 / 52 msで差は小さく、
64 MiBでは約205 / 228 msだった。64 MiBの現行方式は試行間のばらつきが特に大きい。
最大値を製品p95として扱わない。

- 1 MiB版には検索索引の[`readIndexLines`](../apps/desktop/src/bun/search-jsonl.ts#L22)を
  試作で使用。行を見つけてからUTF-8文字列にする。全ファイルの生バイトとパース済み
  managerを同時に持つ全読込版より導入候補として安全だが、**ピークメモリは未計測**。
  検索用はLFで終わらない最終行をスキップするため、そのまま製品の履歴読込には使えない。
- Rustはrelease・`target-cpu=native`、Rust 1.95.0、`serde_json 1.0.154`の
  `preserve_order`、`sha2 0.10.9`。全件を汎用`Value`へパースし、親とIDを確認、
  再シリアライズしてSHA-256、ページを選んで検証用scalarだけをstdioで返した。
  SDKの履歴移行・完全な枝投影・ページ本文の転送・プロセス起動は含めていない。
  本文まで返す機能等価なsidecarが同じ往復時間になるとは言えない。
- Rust試作は「同じ仕事を概ね続ける移植」の対照であり、Rust一般の性能上限ではない。
  一方、生バイトの約17 msも製品の代替ではない。SHA-256だけではJSON/枝検証や
  現在の正規化済みentry digestを代替できない。別途メタデータ索引を持つ場合に、
  「毎回全バイトを読むが、全件の再パースはしない」方式の目安となる。

### 速度の上限と実装順

1. **まず1 MiB前後のバイトチャンク読込。** 16.2 MiBで約47 ms、
   64.7 MiBで約147 msのホスト時間を削れたのが同一条件での期待値。
   現行readerをoracleに、LFなし最終行、空行、CRLF、UTF-8境界、巨大1行、
   malformed JSON、旧形式の移行、他プロジェクト、枝、同サイズ・同mtime書換え、
   append中の読込、close/wakeとの競合を比較してから採る。先読み距離、
   ページ数、文書の保持、スクロールアンカーは変えない。ホストのイベントループ遅延と
   プロセスピークも測り、入力・ストリーム配信をブロックして達成しない。
2. **数十MiB以上でまだ待つなら、本文を持たない同一履歴のオフセット索引を検討。**
   例: 前の読込で確定した版に限り、同じファイルハンドルで生バイトを検証しながら
   必要ページだけ抽出する。append・差替え・同サイズ書換えは全検証へフォールバック。
   stat一致だけで使い回さない。枝メタデータ・バイト検証と既存の論理digestは
   別管理とし、ページの前後関係を検証する。Workerはメインループの停止が支配的な場合のみ。
3. **Rustは次点。** 軽い実装でホスト61 ms＋仮にRPC/描画50 msなら、現行108＋50 ms
   に対して全体は約1.4倍。仮にホストをゼロにしても約3.2倍、画面側は残る。
   50 msは説明用の仮定。実アプリの改善率は「先読み開始→応答到着→表示安定」と
   「ユーザーが先頭に到達して待った時間」を同じトレースで採って判断する。
   先読み内に収まっていたページでは体感待ちの削減はゼロになり得る。

## 2. GPUIは何を外せるか

[GPUI](https://gpui.rs/)はWindowsではWin32 / DirectWrite / Direct3D 11を使う
ネイティブ描画。[`List`/`ListState`](https://docs.rs/gpui/latest/gpui/struct.ListState.html)
で可変高さを扱える。等高の`uniform_list`を使った軽いデモでは、
折り返し、ストリーミング増分、アンカー再計算の負荷を比較できない。
現行のRust化には異なる選択肢がある。

| 選択肢 | 外せるもの | 残る主な費用 |
| --- | --- | --- |
| Rustの履歴関数／sidecar | 対象関数の計算・一部一時allocation | Bun、WebView2、IPC。sidecarでは追加プロセス・本文の受け渡し |
| [Electrobun Rust main](https://docs.electrobun.dev/electrobun/guides/hello-world-rust/) | アプリシェルのBun依存（Pi本体を別に設計した場合） | WebView2。Pi SDK/JS拡張をそのまま載せるならJSホストが別途必要 |
| GPUI会話画面 + 現行Bun | メイン画面のChrome系プロセスとReact/DOM描画経路 | SDK、本文、拡張子プロセス、Direct3D、IPC。HTML面を開くならWebViewも残る |
| GPUI + ハーネスもRustへ全面移植 | ブラウザとJSホストを除ける可能性 | SDK・JS拡張互換性、ツール・プロバイダ・セッション契約を再実装。もはや描画移植ではない |

### 現時点で数字にできる上限

- **メモリ:** [以前の実機採取](desktop-memory-investigation.md)ではWebView2全体が
  163 / 381 MiB、Bunが186 / 568 MiB（別々の作業状態）。Bun＋WebView2の
  専有RAMの約47% / 40%が、WebView2に帰属していた。これはその採取時点で
  「仮に描画の代替コストがゼロ、常駐WebViewなし」とした最大の削減枠。
  GPUバッファ・フォント・テキストレイアウト・本文の保持はネイティブ側にも必要。
  50 MiBの古いページを同様に保持する設計なら、WebView2を外してもそのデータは消えない。
  163 / 381 MiBは空WebViewの固定費でも、GPUIの削減予測でもない。
- **描画速度:** 現行`Chat`の隔離Edgeを再計測。200回答×80行の保存済みコード＋32回の
  短い配信更新で、同期commit p95は末尾追従 **8.9 ms**／先頭閲覧 **10.2 ms**。
  履歴なしは **1.6 ms**（別起動）。200回答でもrAF間隔p95は約16.8 ms、
  long task 0、既存コードのDOM mutation 0。60 Hzのこのケースでは、
  commit短縮はCPU余裕にはなるが、GPUIでフレームの体感が倍速になる根拠ではない。
  同期commitの数字を入力から実画素までの遅延と混同しない。
- **残るボトルネック:** 既存の合成payload probeで、保存80件の差分encodeは平均
  約0.65–1.95 ms、2,000件の包絡では約9.7 ms。差分は約0.9–1.1 KiBで、
  既に参照共有されている場合に大きなコピー省略を追加で得られるとは限らない。
  逆に古いページ初回や多数のtool出力は別。Windowsネイティブの外側RPC・初回
  DOM追加を測ってから、通信や描画の書換えを判断する。

GPUIのPoCに進むなら、**現行Bunを固定し、同じ50→200→1,000件の可変高さ会話だけ**を描く。
「空画面起動」「長文＋ツール」「末尾配信中に上を読む」「履歴prepend」
「横幅変更」「同じ内容の選択・コピー」を、配布Windows WebView2版と同じGPU・DPIで比較する。
Private Working Set / Commit、起動p95、入力から実画素・prepend・フレームのp95/p99を取る。
日本語IME・選択の連続性・注釈・[Windows UI Automation](https://github.com/zed-industries/zed/pull/56065)も
同等性の条件。AccessKitの経路があることとPiGの独自コントロールが読み上げ可能なことは別。
Xterm、KaTeX、Mermaid、任意のReactレンダラー、sandbox付きHTML Widget/MCP面の
互換性を別勘定にする。HTML面をWebViewで遅延表示するハイブリッドなら、
未使用時と一度開いて閉じた後の両方を計測し、常駐ブラウザが残っていないかを見る。
移行の検討基準は暫定で、機能等価な状態で**総専有RAM 25%減、または体感に効く
代表操作p95 30%減**。GPUIバイナリを実測したわけではない。

## 3. WMIスパイク：Electrobunが原因か

Windows PDHの`Get-Counter`（WMIを呼ばない）で1秒サンプルを採った。
2026-11-22 12:43には`WmiPrvSE.exe` PID 6552が1コア比75–108%、
12:46には別のPID 5712が最大128.5%を記録し、数秒後0%に戻った。
100%はマシン全体ではなく論理1コア相当。今回の調査中にもスパイクを観測した。

| 候補 | 確認できたこと |
| --- | --- |
| PiG | [`scripts/app-update.ps1:38–52`](../apps/desktop/scripts/app-update.ps1#L38)が`Win32_Process`を全件列挙。インストール配下のプロセスがまだいれば500 msおき、期限30秒。**更新準備・適用に関連する経路で、平常時のポーリングではない。** Windows smokeにも開発検査用の1回の照会がある。以前の調査でこちらが使った`Get-CimInstance`も発行元候補になる。 |
| Electrobun 2.0.6 | インストール済み`launcher.exe`と`libNativeWrapper.dll`の直接WMI DLL importは見つからなかった。[v2.0.6のWindows launcherの確認範囲](https://github.com/blackboardsh/electrobun/tree/v2.0.6/package/src/launcher)ではプロセス生存時刻取得に`GetProcessTimes`を使用。[更新診断スクリプト](https://github.com/blackboardsh/electrobun/blob/v2.0.6/package/scripts/updater-windows-diagnostics.ps1)にはWMI照会があるが、常用launcherの照会とは別。COMの動的利用・間接呼び出し・WebView2・他のプロセスまでは否定できない。 |
| WMIイベント | Operationalログの最近2時間に失敗イベント5858が29件。12:38–12:39付近には`Win32_Process`、他の時刻にはTPM・ディスク・物理メモリ等の照会が混在。該当Client PIDの実体を当時のプロセスと照合できず、12:43/12:46の高CPUをこれらに帰属できない。5858は失敗の記録で、成功クエリやCPU時間の一覧ではない。 |

決め手は[Microsoft Learnの手順](https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/troubleshoot-wmi-high-cpu-issues)に沿った短時間のETW採取。WMI-Activity **Traceの12番**で
高CPUの`WmiPrvSE.exe` PID（`HostID`）を特定し、同じ`GroupOperationId`の
**11番**から`ClientProcessId`・WQLを取得する。終了の早い`powershell.exe`などは
同時間帯のプロセス開始イベントも残さないと識別できない。
PiGの起動経路、普段の操作、更新時は区別する。Traceは無効のまま、調査は非昇格で、
サービス停止・ログ設定変更・プロセス終了は実施していない。
更新スクリプトが原因と確認できた場合は、全件CIM列挙をせずWin32で
候補プロセスの実行パスを検証する変更を独立に検討する。GPUI移行はWMIの修正にならない。

## 4. 追加検証：履歴リーダー採用条件とWMIの発行元候補

対象: `875bfd3`、同梱Bun 1.4.4。隔離した合成履歴での試作。製品コードは未変更。

### 速度だけでなく、読み込み中の応答性とピークを比較

パスを解決済みにして、同じSDK manager・論理digest・50件のページを使った対照。
OSファイルキャッシュが温まった状態で2回ウォームアップ、順序を回転し11回計測。
処理時間は中央値。「タイマー間隔」は処理中の5 ms周期タイマーの**試行ごとの
最大間隔**の中央値で、実端末の入力／paint p95ではない。RPC・描画は含まない。

| 方式 | 16 MiB 処理時間 | 64 MiB 処理時間 | 64 MiB タイマー間隔 |
| --- | ---: | ---: | ---: |
| 現行`readline` | 73 ms | 310 ms | 100 ms |
| `readline`の読込サイズだけ1 MiB | 42 ms | 172 ms | 101 ms |
| 1 MiBバイトチャンク、従来の同期ハッシュ | 40 ms | 175 ms | 96 ms |
| **1 MiBバイトチャンク＋ハッシュを約8 msごとにyield** | **40 ms** | **165 ms** | **19 ms** |

別実行でも64 MiBのバイトチャンク＋ハッシュ分割は約146 ms、
タイマー間隔約20 ms（現行307 ms／99 ms）。解析ループだけyieldしても、
後段の同期ハッシュが残るので64 MiBで約96–103 msのタイマー間隔だった。
計測上の差はハッシュ自体を高速化した結果ではなく、主に長い占有を分けた結果。
単一の巨大entryを`JSON.parse`／`JSON.stringify`する処理は途中でyieldできない。

64 MiBの同一ファイルを新しいBunプロセスで1件ずつ読み、順序を回転して各6回、
Windowsの`PeakWorkingSet64`を取得した。現行 **319 MiB**（309–335）、
バイトチャンク **293 MiB**（289–296）、`readline`の読込サイズだけ1 MiB
**351 MiB**（344–358）、いずれも中央値。ハッシュは同期で統一したため、
分割ハッシュ併用時のピークは未確認。この条件では`readline`のサイズだけを
増やす案は処理時間を縮めるが、ピークメモリの条件を満たさない。

互換試験は現行リーダーを対照に、1～7バイト境界、CRLF、**単独CR**、空行、
改行なしの最終行、UTF-8の分断・不正なUTF-8、大きい1行、不正JSON、重複ID／親、
不一致header等を50条件で比較。受理時のdigest・枝ID、拒否時のエラー型が一致した。
さらにEOF到達前に追記する合成ケースで両方式が同じ行を返すことを確認した。
**LFだけで切る試作は単独CRの履歴で現行と不一致**。旧SDK形式の移行や、
複数のウィンドウ・Close/Wakeを交えた競合、実パッケージでの画面p95は別途必要。

実装は2つの差分に分ける。

1. `readSessionFile`の行読み取りだけを、LF・CRLF・単独CRに対応したバイトチャンクへ
   差し替える。EOFまで読み、CRLFがチャンクをまたいでも1区切りにする。
   未終端行を捨てる検索索引用リーダー、SDK manager、所属／枝検証には手を入れない。
2. 応答性を改善するなら、**まず休止中の履歴ページのprefix検証だけ**を時間分割する。
   readonly managerを用い、現在と同じ順序・同じJSON・同じprefixを同じSHA-256で処理。
   yield前の所有者・revision・leaf・entryCount・digestを記録し、完了後に再確認する。
   Close/Wake/書換えをまたいだ結果は適用しない。変更が読み取り中の正常append／
   再選択由来なら、既存契約どおり最新の基準で検証し直す。ライブSDKの同期経路は対象外。
   同一ページのsingle-flightと、再取得での同サイズ・同mtime書換え検出も回帰させない。

最終ゲートは配布版で、先頭に到達してからページ表示までのp95、同時入力・配信のp95、
分割ハッシュ込みのピークを現行と比較。試作のホスト時間だけで採用を確定しない。

### WMI：pi-lensが同じクエリを発行することを確認

失敗イベント5858のWQLから取得列だけを比較した。前回12:38–12:39の
`Win32_Process` 17件は、`ProcessId,ParentProcessId`の全件取得16件と、
`ProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CreationDate`をPIDで絞る取得1件。
どちらも、この端末の**pi-lens 4.5.1**のWindowsリソース計測のWQL生成と一致した。
同拡張は計測対象の子孫を全件照会で探し、そのCPU・メモリを絞り込み照会する。
起動後のリソース計測は既定750 msで始まり、その後間隔を延ばす。
LSPが応答しないときのCPU判定にも同系統の処理がある。
PiGの更新スクリプトの`Get-CimInstance Win32_Process`にはこの取得列指定がない。

**クエリの発行元候補としてはpi-lensが具体的になったが、前回12:43/12:46の
高CPUサンプルの発行元が確定したわけではない。** 今回のPDHサンプル4秒では
WMI CPUは0%。Traceを有効化せず、稼働中アプリ・拡張の設定も変えていない。
次は隔離プロファイルでPiG本体・pi-lensなし／ありを比較し、必要なら短時間ETWで
高CPUのprovider PIDとクライアントPIDを照合する。更新スクリプトとElectrobunを先に修正しない。
