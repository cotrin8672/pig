# Windows版PiGのメモリ調査と修正方針

対象: `dev` (`1083b1c` + 調査時点の作業差分)、Windows、同梱Bun 1.4.4。
実ユーザーの履歴・拡張設定は開かず、稼働中アプリの再起動もしていない。

## 結論

1. **先に、履歴専用モードの初回・再選択で重複する読込／検証を減らす。**
   「休止にしたら履歴が遅くなる」経路を再現できた。既存の整合性保護は残す。
2. **次に、非表示・休止済みのチャットに残る、再取得可能な古いページに容量上限を設ける。**
   Rendererの保持源として実測で分離できた。SDK休止やDOM削減だけでは解放されない。
3. **Bun全体の長時間増加は、上の2件とは別に測る。**
   空のモデル環境や8個の合成セッションでは、稼働中0.11.0の約2.1 GiBの
   Bun Private Commitは再現していない。WebView2の換装や休止条件の一律緩和はしない。

## 今回の実測

先行した稼働中プロセスの採取では、0.11.0のBunが568 MiB、
WebView2全体が381 MiB（renderer 307 MiB）、当時の開発版では186 / 163 MiB
（renderer 82 MiB）。Private Working Setであり、機能や負荷をそろえた比較ではない。
別時点ではpi-lens由来のOpenGrep / ast-grepだけで356 MiB。これらは別の子プロセスで、
WebView2やBun内ヒープには含まれない。

### 1. 休止中のページングは、ページサイズではなくファイル全体のコストを支払う

同じ50レコード・約0.78 MiBの回答本文を返すページを各7回、実`SessionHost`で読んだ。
コールドは履歴専用状態、ライブは同じ履歴のSDKを起動済み。計測にRPC・DOMは含まない。

| 合成JSONL | 初回の履歴専用open（3実行） | コールド履歴1ページ（3実行の全サンプル） | ライブ履歴1ページ |
| --- | ---: | ---: | ---: |
| 2.04 MiB、64ターン | 31–66 ms | 10–46 ms | 0.1 ms以下 |
| 16.34 MiB、512ターン | 189–235 ms | 89–220 ms | 0.2 ms以下 |

16.34 MiBの内訳を別に測ると、探索・検証付き読込・パース・manager構築で61–111 ms、
全履歴を再シリアライズするダイジェストで29–53 ms（各3サンプル）。この内訳は別々に
測っており、上表の個々の値に足し戻すものではない。

- [`session-files.ts`](../apps/desktop/src/bun/session-files.ts#L49):
  `readSessionFile`がファイルを全件パースし、readonly managerと枝検証を行う。
  `sessionHistoryDigest`は各entryを`JSON.stringify`してハッシュする。
- [`SessionHost.open`](../apps/desktop/src/bun/session-host.ts#L987)は先に所属を検証し、
  履歴専用の初回では`readSessionFile`が同じファイルを再探索する。
  同じ`prepared` managerで新しいhandleのdigestを作ったあと、
  [`historySnapshot`](../apps/desktop/src/bun/session-host.ts#L705)がそのprefixを検証し、
  さらに全件digestを作り直す。
- [`getSessionHistory`](../apps/desktop/src/bun/session-host.ts#L2115)のコールド分岐は
  毎ページ全ファイルを読み、保存済みprefixをハッシュし直した後で、
  [`SDKProjector.historyPage`](../apps/desktop/src/bun/sdk-projector.ts#L387)のページを切り出す。
  ライブ分岐は既存managerを使う。よって体感対策として、ページ当たりの行数を
  いじったりSDKを起こしたりして解決しない。

### 2. 休止でBunの参照は減るが、Rendererの本文は残る

2.04 MiBの別々の合成履歴を8件、拡張なしの`SessionHost`に順に開いた。
N=3の各チェックポイントを同期GC後に計測。値はBunの`process.memoryUsage().heapUsed`。

| 状態 | Bun heapUsed |
| --- | ---: |
| 8件を開く前 | 17.5–17.6 MiB |
| 履歴専用8件 | 17.7–17.8 MiB |
| SDK稼働・idle 8件 | 37.7–37.8 MiB |
| fake clockで8件を自動休止 | 21.4–21.5 MiB |

約16 MiBのJSヒープが休止で低下した。残差はこの計測だけではリークとは判定しない。
またこのprobeの最大規模は約16 MiBの入力で、実アプリの長時間Bun Commitを説明しない。

別の隔離Edgeでは、実際の`receiveSnapshot`・`prependHistory`・休止イベントで
50件の末尾と追加4ページを8セッションに入れた。DOMはマウントせず、
各ステップでCDPからGCして`Runtime.getHeapUsage`を取得した。
固有の32 KiB文字列を本文に使用したため、この条件では本文の大半が
`usedSize`ではなく`backingStorageSize`に現れた。

| 状態 | ストアのrecords | JS backing storage |
| --- | ---: | ---: |
| 空 | 0 | 0.03 MiB |
| SDK休止を反映した8件 | 2,000 | 62.53 MiB |
| ローカル追加4ページだけを診断用に取り除く | 400 | 12.53 MiB |
| 全snapshotを取り除く | 0 | 0.03 MiB |

**古いページだけで50 MiB、残しておく末尾は約12.5 MiB**。これはUIストアの所有を
切り分けた実験で、配布版のRenderer Private Working Setや、DOM込みの改善量ではない。
テスト中の直接代入を製品コードに移植してはいけない。

## 実装順と合格条件

実装済みはPR 1の重複除去と同一ページの進行中の合流まで。履歴の表示経路・
先読み・保持は変更していない。PR 2の削減は、一度読み込んだページの再訪で
I/O待ちを追加するため、既存の操作感を変えない条件では有効化していない。
Worker・索引・キャッシュ上限も入れていない。

### PR 1: コールド読込の重複をまず除く

対象は`session-files.ts`と`SessionHost`の履歴専用経路。SDK、RPC形式、DBには手を入れない。

- `readSessionFile`のファイル探索と、解決済みファイルを開いて**実際のハンドルから**
  header・cwd・id・枝を検証する処理を分ける。初回は同一操作で解決したパスを使い、
  そのreaderから一度作った`entryCount / digest / leaf`と初回snapshotを組み立てる。
  「今回同じreaderから新規作成したhandle」と「競合で既に存在するhandle」を区別し、
  後者のprefix検証は省かない。再選択の読込がappendなしでprefix一致したときは、
  その検証で得たdigestを使用し、もう一度同じ部分をシリアライズしない。
- `getSessionHistory`の同一`address + revision + before`の**進行中**読込だけを
  single-flightにする。完了した全ファイル、manager、本文をBunに常駐させない。
  連続する別カーソルはこの変更だけでは速くならない。続けて16 MiB fixtureの
  連続ページング・Bunイベントループ遅延を測り、支配的なら次を別PRにする。
- 連続ページングの次段階は、**readonly scanを1 workerに分離し、選択ページと
  検証済みメタデータだけを返す**小さいPoC。最初は現readerの読み出し・検証と同一契約。
  Workerは総読込量を減らすとは限らず、メインループp95とシステム全体のピークで判定する。
  それでも不足なら本文なしの枝索引・オフセットを検討する。
  stat一致だけの長寿命managerキャッシュは同サイズ・同mtimeの書換えを見逃すため不採用。

回帰は`session-files.test.ts`、`session-history.test.ts`、`session-suspension.test.ts`へ。
初回の探索・digest回数、同時readの合流と失敗後の再試行、同一サイズ・mtime書換え、
append・rewind・他プロジェクトのheader、読込中のClose/Wake、
旧epochの結果拒否、起動回数ゼロを確認する。
性能は同一条件で交互に最低7回。16 MiBのコールド初回openの中央値**25%減を暫定目標**にし、
ライブpagingの回帰なし。既存ファイルの意味や検証を弱めて数字を達成しない。

### PR 2: 非表示・休止済みのローカル履歴prefixを予算で解放

対象: [`chat-snapshot.ts`](../apps/desktop/src/mainview/chat-snapshot.ts#L41)、
[`runtime-events.ts`](../apps/desktop/src/mainview/runtime-events.ts#L282)と、ペイン切替時の
ストア更新。まず**追加取得した履歴だけ**を対象にし、snapshot全体は捨てない。

- RPCの正規末尾の`recordCount / toolIds / 元のbefore`を
  [`transcriptWireBase`](../apps/desktop/src/shared/transcript-wire.ts#L8)系の
  メタデータとして、ローカルのページングカーソルとは分けて保持する。
  予算で落とすときは正規末尾record・対応tool・元のcursorを一緒に復元する。
  `snapshotSeq`を変更せず、wire基底・history revision・表示キー・draftを引き継ぐ。
  現在の基底に`before`はない。`slice`だけでは古いcursorのままになり、
  次の読み込みで欠落・重複を作る。
- 節約対象は**そのRootの全ペインに存在せず、休止済みで、保留の送信・UI要求・下書き
  編集がなく、復元すべきスクロール位置が残す末尾に収まるチャットだけ**から始める。
  古いページ上で読んでいたチャットは初回PRでは除外する。現状の保存値はピクセル
  `top`で、消えた行にはそのまま復元できないため。表示中の他ペイン、DOM選択、IME、
  拡張出力、元ファイルは触らない。ペイン離脱・休止・再選択時だけ判定して常時タイマーは足さない。
- 予算は全Root共通ではなくrendererごとに、解放可能なprefixの推定bytesで管理する
  （暫定32 MiB、古く参照されたものから、再計測で調整）。本文・画像文字列・tool結果を
  二重に数えず、測定のための全件`JSON.stringify`も避ける。除外対象まで含む厳密な
  プロセス上限ではない。ひとつの巨大な末尾や表示中DOMはこのPRの範囲外。

`transcript-sharing.test.ts` / `snapshot-delta-rpc.test.ts`で削減→差分→再読込の一貫性、
`runtime-suspension-ui.test.ts` / `history-paging-ui.test.ts`で表示側を確認する。
具体的には、同一revisionの再取得で連続したrecordsとtool対応が戻る、旧revision・
遅延応答は戻さない、再選択がSDKを起動しない、非アクティブペイン・注釈・IME・
履歴の途中からの再表示は今のまま。通常範囲では強制GC後の追加ページ保有量が
予算以下、チャット切替p95の回帰なしを確認する。

### 並行: 実機Bunの大きなCommitを帰属させる

同一パッケージ・隔離プロファイルで空画面、合成履歴巡回、重いtool出力を伴う送信、
作業後休止を測る。本文を記録せず、PID別Private Commit / Private Working Set、
Bun `heapUsed / external / bun:jsc heapStats`、実行中／休止中の件数、
休止阻害理由別の件数と、保持している履歴・投影の推定bytesを同じ時系列で取る。
pi-lensあり／なしを分け、入力から次のpaintとチャット切替のp95も比較する。

SDKはセッション木を保持する。保存済みメッセージは多くが参照共有なので
「SDKとprojectorが常に本文を丸ごと二重に持つ」とは言えない。
`SDKProjector`の完了tool結果は一度コピーし、永続化側と一致したものをページ投影時に
共有へ切り替える。重いtool出力が続く条件で、コピーが残っている実体とサイズを検証してから、
旧結果の解放や休止の緩和を判断する。BunのGC後ヒープが減ってもCommitが戻らない場合は、
allocatorの保持やnative/workerを分ける。WebView2の固定費は同一配布版の空画面を
計測するまで分からない。Tauriへの移行でもWindowsのWebView2は残る。

## 再現

```powershell
mise exec -- bun apps/desktop/scripts/profile-history-retention.ts
mise exec -- bun apps/desktop/scripts/profile-renderer-retention.ts
```

いずれも合成データのみ。前者は実SDKの隔離プロセス、後者は一時プロファイルの
headless Edgeで、製品WebView2やJSヒープダンプは使用しない。
計測時は`mise exec`がNode 22.23.4のインストール先のアクセス拒否で停止したため、
既存の同梱Bun 1.4.4とローカルNode 24.22.1を直接使った。

両probe・Biome・`git diff --check`は成功。関連テストは6件成功、1件失敗。
履歴ページング、休止、差分RPCのテストは成功した。
失敗は`session-history.test.ts`のみで、既存の起動中previewへの`listSlashCommands`が
`STALE`を要求する一方、実装が`[]`を返す。該当実装と期待値はHEADにも存在する。
全体型検査は未変更の`session-host-model-error.test.ts`のfetchモック
（`preconnect`がない）で失敗。この調査時点では製品変更・稼働中アプリの再起動はしていない。

### 重複除去後の再計測

同じ16.34 MiBのprobeを3回再実行し、初回の履歴専用openは100・120・163 ms
（調査時は189・206・235 ms）。前後は別実行なので厳密な改善率ではない。
連続する別ページの全ファイル検証は維持。同じページの要求を並行させた場合だけ
ディスク読込を共有し、完了後・失敗後の再読込では書換えを再検証する。
