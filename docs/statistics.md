# ローカル統計の収集基盤

実装計画：[statistics-implementation-plan.md](statistics-implementation-plan.md)。
この文書は実装した範囲と制約を記載する。統計画面・集計RPCは実装済み。自動改善はまだない。

## 統計画面

- サイドバー下部、拡張の右にあるグラフアイコンから開く。検索パレットの「統計」でも開ける。
- 今日／7日／30日／全期間はローカル暦の日付境界で集計する。全期間は保持中の最大365日。
- 上段の内訳、日別モデルグラフ、モデル別token/s、ツールの使用率・成功率、2つの円グラフを同時表示する。
- 長い期間のグラフは最大14区間に合算し、間引かず全件を含める。区間の日付範囲はホバー・キーボードfocusで確認できる。
- 画面表示中は30秒ごと・ウィンドウfocus時に再取得。更新ボタンもあり、古い期間の応答は破棄する。
- SQL集計はSQLite worker内で実行する。実ホストはStorybookのサンプルを参照しない。
  Storybookも本番の`StatisticsView`を直接使い、データだけをfixtureに差し替える。
- 平均token/sは、時間が取得できた正常な会話requestごとの`output × 1000 / durationMs`の算術平均。
  最初の出力までの待ち時間を含み、純粋なデコード速度ではない。エラー・中断・補助処理の集約行は除く。
- ツールの分母は成否が報告された終了event。未終了の実行は成功扱いしない。
  「使用率」は全tool終了event中の比率。「成功」は`isError=false`であり、有用性の評価ではない。
- 日別グラフの下に「シェルコマンド」をシェル×分類キーで表示する。失敗数→失敗時の出力バイト数の順。
  成否は構造化終了コードで判定し、`0`は成功、Bashの`rg`の`1`（一致なし）は成功、
  PowerShellの`rg`の`1`と終了コードなしは判定不能、それ以外の非`0`は失敗。
  成功率の分母から判定不能を除く。`isError`は「ツールエラー」として別に数える。
  失敗時の出力は切り詰め後の結果テキストのbyte数で、token数ではない。
  未分類・分類キー導入前（未計測）は見出し右に件数だけ示す。
- 欠損Usageは既知分のみ集計し、画面上段に「一部未計測」を表示する。詳細は同じ場所の補足に残す。
  SDKのゼロ初期値はProviderから報告された0と識別できない場合がある。
- モデル不明の補助Usageも別行で含める。その行の1件は複数呼び出しの集約の場合があるため、
  種類の平均は厳密には保存されたUsage記録あたりの値。
- `PIG_STATISTICS=0`でも保存済みの統計は閲覧できる。収集停止中と表示し、新規収集はしない。

## 有効化と保存

- pigの標準SessionHostで、新規に観測した実行情報をローカル収集する。
- 起動前に環境変数`PIG_STATISTICS=0`を設定すると収集を無効化できる。
  再有効化しても過去のsessionファイルを自動importしない。
- 保存先は`~/.config/pig/statistics.sqlite`。Pi標準のauth/session保存は変えない。
- SQLite WALとFULL synchronousを使い、確定eventを専用Bun workerからbatch保存する。
  通常は最大1秒または100件でflush。画面・window数には依存しない。
- 365日を超えるevent・request・runはDBを開く際に削除する。
  session削除時は関連する統計も削除し、tombstoneで遅延書込による復活を防ぐ。
- DBは平文。hash化したpathも匿名化を保証するものではない。

## 収集対象

| 対象 | 記録内容 |
| --- | --- |
| 実行 | binding/host/epoch/sequence、run開始・settled・中断、所要時間 |
| モデル | 完成応答ごとのSDK token内訳・reasoning・費用出典・model/effort・選択accountのローカルID・stop reason・時間 |
| 初回出力 | 最初の空でないtext deltaまでの時間。UI描画時間ではない |
| ツール | 全toolの開始・終了、call/parent call ID、`isError`、SDK実行時間、観測時間 |
| ツール結果 | text byte数・画像数、構造化されているshell終了コード・時間、切り詰めmetadata |
| シェルコマンド | Bash / PowerShell の終了eventに、要求された単一コマンドの固定分類キー（`shellCommandKey`） |
| 検証 | モデルのtool引数JSON不正件数、引数field数、実行時間の報告有無。意味的妥当性は推定しない |
| 回復・待機 | auto retry・summary retryの回数・遅延・成否、queue件数、再bind |
| 圧縮 | 開始・終了・理由・中断・エラー有無、前後token量（取得できる分） |
| 補助Usage | 新規`usage`・`compaction`・`branch_summary` entry、およびtool resultが報告するUsage |
| Context | 有効system promptのhash・byte数、AGENTSのsource hash・版・byte数、skill一覧・tool一覧・拡張source |
| 初期Context | 新規sessionの最初の正規化requestに含まれるsystem区分・tool定義の推定token数。本文は保存しない |
| 構成変更 | model/effort変更、context edit対象・省略状態、session entry ID・親・種類 |
| 計測状態 | bindingごとのcoverage、app/SDK/collector版、過負荷で捨てた件数 |

正常なtoolも失敗toolも記録する。`isError`とshell終了コードは独立した事実として保存し、
本文末尾の「exit code」等の文字列から終了状態を推測しない。
SDKの実行時間がない場合、実行前拒否などの可能性がある。失敗原因の確定分類ではない。
シェルの分類キーは `git status`、`git diff`、`pnpm test`、`rg`、`Get-ChildItem` の固定値のみ。
対象外・複合・開始eventがない場合は `unclassified`。分類キー追加前の記録には項目がなく、遡及収集しない。
開始時の要求に基づく分類であり、実際に起動された実行ファイルを識別するものではない。

prompt、応答本文、tool引数・出力本文、自由文のエラー、認証情報、HTTP header、
Memory本文は統計DBに保存しない。任意のtool detailsやextension dataも丸ごと保存しない。
識別子やtool/skill名などのmetadata自体もローカル情報として扱う。

## 保存構造

- `events`：version付き構造化event。時刻・owner・run・typeにindex。
- `model_requests`：会話requestまたは補助Usage集約ごとの数値。期間・model・projectにindex。
- `runs`：runの開始・終了と実行状態。task成功判定とは別。
- `collection_state`：DBへ報告済みの欠損件数。
- `deleted`：削除ownerのtombstone。

ownerはprofile/cwd/sessionの組をhash化したもの。projectはcwdのhash。
mainモデルのrequest ID、ユーザー送信ID、SDK entry ID、tool call IDを混同しない。
event IDで再送を排除し、補助Usageはowner/entryで二重加算を防ぐ。
forkの継承履歴は取り込まない。rewindで既に消費したtokenを減算しない。
モデル集計の時刻は、取得できればSDKのrequest開始時刻を使う。

`reasoning`はoutputの内数、`cacheWrite1h`はcacheWriteの内数。
欠損はnullで保存する。SDKがゼロ初期値とProvider報告の0を区別しない場合は、
`reportingCoverage=provider-report-presence-unknown`を残す。
費用はProvider報告とcatalog推定を区別し、OAuth定額契約の実請求額とはみなさない。
統計の「API換算」は選択期間に記録された `cost_total` のUSD小計。金額未記録のリクエストが混ざる場合は「一部」、記録額が1件もない場合は「—」とする。

## 障害と未対応範囲

- queueは4096件・4MiBまで。通常は確定eventをsamplingしない。
  過負荷時はContext/entry補助eventより実行・Usageを優先し、欠損を記録する。
  単独で256KiBを超えるmetadataは保存しない。
- DB/worker障害は安全な固定コードでログへ通知し、チャットには例外を伝播させない。
  `StatisticsService.error`で状態を参照可能。通知UI・再試行・health RPCは未実装。
- 終了時flushは全体で最大2秒。強制終了・電源断・timeout時の未flush分は失われ得る。
  通常のbefore-quitでは最後のwindowが閉じた後もsession shutdownとflushを待つ。
  session entryとの再照合・クラッシュ後のUsage復元は未実装。
  クラッシュで終端がないrunは`running`の行が残るため、将来の表示で完了扱いしてはいけない。
- compaction/summary/cache warm等はSDKが保存した集約Usageのみ。
  失敗attemptやentryに残らない補助呼び出しを全件観測するnative telemetry連携は未実装。
  集約行を会話の1 requestと同じ粒度で数えない。
- 最終Provider payload、sourceごとの厳密な送信確認、Memory操作、
  拡張独自HTTP、pig外CLI、Provider契約枠の履歴は未対応。
- Contextはロード状態と有効promptのsnapshotであり、送信・遵守・有用性の証明ではない。
- 初期Contextはcontext hooksとSDKのhidden declaration変換後の`transformContext`境界で観測する。
  systemの`sections`と有効なtool定義だけを集計し、ユーザー入力・会話本文は含めない。
  全文置換のsystemは分解せず基本プロンプトとして扱う。合計・内訳とも文字数÷3.5の推定であり、
  Provider独自の変換・付加tokenは含まない。最初の入力Usageにはユーザー本文も含まれるため、
  それを初期Contextの正確な合計として転用・補正しない。
  円グラフと定義列は選択期間内の最新の初期snapshotを使う。古い会話・再開した会話は復元せず未計測にする。
- run開始はSDKの実行開始。受付・承認・UI描画までの全経路計測はまだない。
- 保持期間・収集ON/OFFの設定UI、全削除・project削除・exportは未実装。
  session削除は既存操作に連動する。統計DB単独の手動削除はアプリ停止中に行う。

## 検証

```powershell
mise exec -- bun test apps/desktop/src/bun/statistics
mise exec -- bun test apps/desktop/src/bun/statistics-host.test.ts
mise exec -- bun test apps/desktop/scripts/sdk-runtime-assets.test.ts
mise exec -- pnpm typecheck
mise exec -- pnpm test:ui
```

unitではtoken内数・null・冪等保存・削除・未来schema保護・worker障害・配布bundle移設を検査。
SDK integrationでは実際の失敗tool・引数不正・shell終了コード、fork非重複、削除、本文非保存を検査する。
実アカウントを使う推論・課金・GUI起動は検証に必要ない。
