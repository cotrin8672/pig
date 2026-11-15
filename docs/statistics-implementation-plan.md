# Statistics：Usage可視化とハーネス改善の実装計画

状態：収集基盤の初版に着手済み。現在の実装範囲・有効化・制約は
[statistics.md](statistics.md)を参照。以下は当初計画と残作業を含む。

基礎資料：ユーザー提供の `report-v2.md`。研究の数値や公開実装の記述は再検証せず、
設計原則を採用した。以下の現状確認は、この作業時のpig作業ツリーとインストール済みSDK 1.5.2による。

## 1. 目的と境界

統計の目的を二つに分け、収集基盤を共用する。

1. **Usage Statistics：人間が使い方を見直す**
   - いつ、どのプロジェクト・モデルに、何トークン使ったか。
   - cache、reasoning、再試行、圧縮などにどれくらい使ったか。
   - 推定費用や待ち時間がどう変化したか。
2. **Harness Statistics：ハーネスの改善点を見つける**
   - どの構成・指示・記憶を渡し、何を実行し、どの結果になったか。
   - 反復失敗、情報の欠落、人間の訂正・復旧を減らせるか。
   - 変更によって品質を維持したまま費用・時間・負担が改善したか。

前者には成功判定がなくても価値がある。後者はUsageだけでは評価できない。
単一の「良さスコア」には統合しない。

### 収集は広く先に、可視化・解釈は段階的に

**実行時に決定論的に観測できる情報は初期から収集する。Usage画面の実装順に収集範囲を絞らない。**
ツールの失敗、終了コード、retry、Contextの変更などは、後から必要になっても復元できないことがある。
分析方法や専用画面がまだなくても、対応する観測点の構造化eventを保存する。

- **観測事実**：SDKの`isError`、終了コード、timeout、token数、設定変更、source版など。
  初期から取り、観測元・時刻・IDとともに残す。
- **規則による導出**：失敗率、同じ操作の反復、再読回数など。
  元eventを残し、後から集計・判定規則を更新できるようにする。
- **意味判断・因果推定**：その失敗が不要だったか、taskが成功したか、どの指示が役立ったか。
  観測事実と別にし、評価機能を後から追加する。

収集対象を限定する理由は、未実装の画面ではなく、秘密情報・取得負荷・観測境界の制約とする。
全tokenのdeltaや本文を丸ごと保存するのではなく、実行の節目・確定値を全件保存する。
未対応の観測点はcoverageに記録し、「後で分析するから今は取らない」とはしない。

### 既存のUsage表示との区別

| 表示 | 意味 | Statisticsでの扱い |
| --- | --- | --- |
| Provider Usage | Providerが返す契約枠の消費率・残高・reset | 既存表示を維持。token消費の原簿にしない |
| Context Usage | 現在のbranch・compactionを反映したContext占有量 | 瞬間値。期間内の消費量として足し合わせない |
| Usage Statistics | 実行した各モデル呼び出しのtoken消費の積算 | 今回追加する原簿と集計 |

契約枠は他アプリの利用も含み得る。枠の減少率からpigのtoken数を逆算しない。
通常の統計はローカル保存のみ。クラウドtelemetryや既存SDKの送信設定を勝手に有効化しない。

## 2. 現状確認と再利用できる境界

| ファイル・契約 | 確認した内容 | 実装への利用 |
| --- | --- | --- |
| `apps/desktop/src/bun/session-host.ts` | `session.subscribe()`、再bind、retry、`agent_settled`を扱う | セッションとrunの収集接点 |
| `apps/desktop/src/bun/sdk-projector.ts` | 表示用projection。`message_end`と永続化の順序差を扱う | 設計上の参考。集計の正本にはしない |
| `apps/desktop/src/shared/transcript.ts` | 応答区間のtoken数・時間を算出 | フォーマット等は共用可能。全履歴Usageには流用しない |
| `apps/desktop/src/bun/context-usage.ts` | SDKの現在Contextをprojection | lifetime spendと明確に分離済み |
| `apps/desktop/src/bun/resources.ts` | 独自のcontext file loader | 指示の出所・版・ロード状態の観測点 |
| `apps/desktop/src/bun/model-runtime.ts` | runtime単位のProvider構築、アカウント選択、wrapper | モデル呼び出しの観測候補。拡張Providerも別途確認が必要 |
| `apps/desktop/src/bun/usage/observation.ts` | 通常応答headerから契約枠を補完 | 既存callbackを壊さない参考。token収集器とは分ける |
| `apps/desktop/src/bun/session-diagnostics.ts` | `bun:sqlite`、WAL、復旧用metadata | SQLiteの利用実績。統計は復旧DBに混ぜない |
| `apps/desktop/src/bun/search-index.ts` | JSONLを増分走査 | 将来の履歴importで読み出し方式を参考にする |
| `apps/desktop/src/bun/desktop-config.ts` | `~/.config/pig` | pig独自の統計保存場所 |
| `apps/desktop/src/bun/runtime-profile.ts` | Pi標準profile・session保存を尊重 | 認証・sessionの保存先は変更しない |

SDK `Usage`には `input / output / cacheRead / cacheWrite / totalTokens`、
任意の `reasoning / cacheWrite1h` と費用内訳がある。
`reasoning`はoutputの内数、`cacheWrite1h`はcacheWriteの内数。
`cost.totalFromProvider`でProvider報告額とカタログ推定を区別できる。

SDKには `message_end / entry_appended / agent_settled / compaction_* / auto_retry_*`
があり、pi-aiには明示的なtelemetryと `onPayload / onResponse` がある。
ただし、**存在するAPIから全呼び出しが自動で観測できるとは限らない**。
特に補助呼び出し、拡張独自HTTP、最終payload、usageのゼロ初期値はP0で確認する。

## 3. 収集する情報

### 3.1 共通の識別・構成

| 単位 | 保存項目 |
| --- | --- |
| session | profile ID、session ID、project/worktree ID、開始時刻、生成元 |
| run | run ID、session、開始・終了、中断・失敗・settled、構成snapshot参照 |
| user send | 既存の送信識別子、受付・開始時刻、runとの関連。本文は保存しない |
| model request | logical request ID、必要ならattempt ID、run・親toolとの関連、実行目的 |
| tool call | call ID、parent call ID、run、ツール名・版 |
| task | 明示的な目的のID、関連run、結果評価。最初は未割当を許可 |
| configuration | pig/SDK/拡張の版、モデル設定、tool構成、resource版、repo commit・dirty状態 |

ユーザーのsend IDとProvider request IDは別の名前空間にする。
1 sendは複数モデルrequestになり、steering/follow-upもあるため1対1としない。
1 sessionを1 task、1回のpromptを1 taskとは自動確定しない。
taskとの対応は後から付けられ、Usageの記録を妨げない。

構成は変化時にsnapshot化する。毎token・毎requestにgitコマンドや全ファイル走査をしない。
repo commitとdirtyフラグだけでは再現用snapshotにならないことも明記する。

### 3.2 Usage：初期収集・最初の可視化対象

| 群 | 保存項目 | 主な用途 |
| --- | --- | --- |
| 時間 | UTC開始・終了、単調時計による所要時間 | 日別集計、latency |
| 帰属 | project/session/run、Provider、要求model・応答model、reasoning設定 | モデル・用途別の使い方 |
| アカウント | 要求開始時のローカルopaque ID、auth種別 | アカウント別集計。メール・tokenは保存しない |
| 消費 | uncached input、output、cache read/write、total、reasoning、cache write 1h | token内訳 |
| 費用 | 費目別推定額、total、通貨、Provider報告／推定／不明、価格の出典・版 | 実額と参考額の区別 |
| 実行目的 | conversation / compaction / branch-summary / cache-warm / subagent / extension / evaluation / other / unknown | 会話以外の消費も見える化 |
| 結果 | stop reason、error分類、中断、retry関係 | やり直しの量・費用 |
| 取得品質 | live/import、計測元、normalizer版、usageの既知／部分／不明 | 不完全な合計を明示 |

画像・音声などtoken以外の課金は、報告された単位・数量・金額が取得できる場合だけ別項目にする。
取得できない利用を無料・0 tokenと表示しない。初期UIはtext系tokenを中心にする。

#### 足し算の規則

- SDK正規化のinputはuncached。対応Providerで確認後、
  `input + cacheRead + cacheWrite` を入力合計として表示する。
- reasoningをoutputへ、cacheWrite1hをcacheWriteへ再加算しない。
- `totalTokens`はSDK報告値として保存。内訳からの導出値とは出典を分け、
  不一致は黙って書き換えず計測品質として残す。
- ストリーム途中のusageは累積snapshotになり得る。deltaのように足し込まない。
- 同じ呼び出しのsession event・telemetry・永続entryは一行を補完する。
  それぞれを別の消費として計上しない。
- retryで実際に消費した分は含める。失敗requestにusageがなければnull。
  SDKの初期値0とProviderが報告した0を識別できなければ「報告有無不明」とする。
- deferred/pollは同じ結果の累積usageを重複計上しない。独立課金分だけ別requestとし、
  判別不能なadapterは初期対応外と明示する。
- 時間別集計はrequest開始時刻に帰属。日跨ぎの消費を推定分配しない。
- 日境界はUIで選ぶtimezoneを使い、UTC保存値を維持する。

#### 費用の扱い

- Provider報告額、APIカタログによる推定額、契約料金は別概念。
- OAuth定額契約のSDK costを「請求額」として表示しない。
- Provider報告totalとカタログ由来の費目別内訳は一致を保証しない。
- 金額不明・価格未設定の0は「無料」と確定しない。
- 異なる通貨を合算しない。為替換算は初期対象外。
- 推定とProvider報告を混ぜた合計を出す場合は必ず「混合参考額」と表示する。
  初期UIは分けて表示する。
- 当時の金額と価格出典を残し、将来の価格更新で過去を自動再計算しない。

### 3.3 実行・ツール・回復

| 群 | 保存項目 |
| --- | --- |
| run lifecycle | 受付、queue、実行開始、settled、中断、再開、停止未確認 |
| 体感時間 | 初回可視text event、任意でUI描画ACK、成果までの時間 |
| tool | 名前・版、開始終了、ok/error/blocked/invalid/unknown、親子、引数のサイズ・schema結果 |
| 失敗の根拠 | SDKの`isError`、検証結果、構造化error code、終了コード、signal、timeout、取消元 |
| 出力 | サイズ、切り詰めの有無。標準では本文を保存しない |
| retry | 原因分類、回数、backoff時間、元requestとの関係 |
| recovery | resume/fork/rewind、復旧成否、二重実行の確定証拠、失われた処理 |
| 状態変更 | model/effort/account、tool有効化・無効化、resource reload、branch・構成の変更 |
| 権限・待機 | 構造化された承認要求、許可・拒否・取消、待ち時間。入力内容は保存しない |
| 計測基盤 | queue長、flush時間・件数、DBエラー分類、欠損、観測adapterの版 |

#### ツール実行は初期から全件記録

`tool_execution_start/end`をcall IDで結び、以下を保存する。

- session/run/request/call/parent callのID、tool名・実装版、開始終了・所要時間。
- SDK報告の成否、実行前の引数検証・権限拒否、実行開始の有無。
- shellなら取得可能なexit code・signal・timeout・中断理由。
- 入出力のサイズ・切り詰め、構造化された結果件数・変更件数など、tool別の安全なmetadata。
- 元session entryへの参照。診断時は許可された原ログをたどり、統計DBへ本文を重複保存しない。

**観測事実と分類結果は別項目にする。** 例えば`isError=false`と`exitCode=1`が
同時に観測されたら、片方に丸めず両方を残す。exit code 1の意味はコマンドにより異なる。
error codeや検証理由は定義済みの構造化値を優先し、自由文のエラーを根拠なく確定分類しない。
文字列から規則で抽出する場合はparser版・抽出元・判定不能を残す。
ツールの正常終了を「ユーザーの目的達成」、失敗を「無駄だった操作」と読み替えない。

ツールごとにmetadata extractorを用意し、shell・ファイル操作などの既知toolから対応する。
未対応toolも共通のstart/end・`isError`・時間は必ず収集する。
test runnerが構造化結果を公開する場合はpassed/failed/skipped件数と検査範囲を取る。
公開しない場合でもcommandの終了状態は保存し、テスト成功件数を捏造しない。

SDK first chunkは最初の正規化eventであり、初回可視出力ではない。
UI描画ACKを取らない段階は「最初のtext eventまで」と正確に名付ける。
並列toolの所要時間合計はrunの経過時間とは別。
同じ引数の繰り返しは重複候補にすぎず、不要操作や二重副作用と断定しない。

### 3.4 Context Manifest

requestごとに次を記録する。本文の複製ではなく、版と経路の記録。
ロード・構成変更・実際に観測できるpayload段階は初期収集に含める。
最終payloadのsource対応が未実装でも、手前の既知の状態を捨てない。

- source ID、revision、種類：system / AGENTS / skill / memory / history / tool definition。
- scope、出所・trust区分、protectedな制約か。
- 対象候補、ロード、組立後の採用・除外、除外理由。
- transform/compaction、含まれた範囲・切り詰め。
- サイズ、推定token量、推定方法。
- 最終payloadの観測段階・source対応の確度、送信試行・応答の有無。

`loaded`と`assembled`と`final_payload_observed`を区別する。
最終payloadの観測はサーバー受理の証明でもない。
既存 `onPayload` の戻り値・非同期処理・他wrapperの順序を維持し、
後段変換を観測できない場合は「最終送信確認済み」と表示しない。

source別token数は通常推定であり、Providerのinput usageへ正確に配賦できるとは限らない。
skill一覧の説明とskill本文の読み込みも分ける。
本文を保存しないため、過去のsourceが削除・更新された場合に完全再現できない限界を表示する。

### 3.5 成果・人間負担

- outcome：success / partial / failure / cancelled / blocked / unknown。
- 判定状態：provisional / verified / disputed / reopened。
- 根拠：ユーザーの明示評価、テストの実行結果、検査artifactへの参照。
- evaluator・基準の版、対象範囲、評価日時、後日の訂正revision。
- 明示された訂正・再説明・差し戻し・手動復旧・承認待ち。

テスト成功はそのテスト範囲の結果であり、task全体の成功ではない。
例外なく終了、会話が終わった、返事がない、commitされた、を自動で成功としない。
追加依頼を自動で「訂正」にしない。分類器を使う場合は推定ラベル・版・confidenceを分離。
人間の実作業時間は、無操作時間や承認待ちから推定しない。
自動で測れる待ち時間と、任意の自己申告負担を分ける。

### 3.6 Memory・compactionの観測と、後続の改善比較

| 対象 | 記録 |
| --- | --- |
| Memory item | ID・版・型、根拠参照、scope、出来事／記録／有効時点、事実／仮説、派生元 |
| Memory operation | 保存・候補取得・選択・注入・訂正・失効・削除、policy版、snapshot |
| compaction | reason、方式・版、前後量、保持source参照、時間、関連モデルrequest |
| 改善候補 | 仮説、根拠、対象用途、変更diff参照、予測利得・回帰、反証条件 |
| 比較実験 | task/環境/Memory snapshot、baseline/candidate、評価版、全試行費用、結果 |
| 採用 | 人間の承認、採否理由、適用範囲、rollback先 |

Memory拡張の操作はSDKイベントだけで分からない場合がある。
既知の連携先だけ明示的なadapterで対応し、未対応はcoverageに表示する。
この機能のために新しいMemoryエンジンは作らない。
compactionの開始・終了・理由・成否・前後量、および既に構造化eventを公開する
Memory連携先の操作は初期から保存する。
後続段階に回すのは、未対応連携先のadapter追加、有用性の評価、改善案と比較実験。

## 4. 収集の構造

```text
SessionHost events ─────── run / tool / retry / recovery
pi-ai request observation ─ usage / duration / purpose
resource + payload hooks ─ context manifest
明示評価・検査結果 ─────── outcome
対応Memory adapter ────── memory operations
              │
        許可項目だけのDTO化
              │
        bounded queue（本文なし）
              │
    Statistics writer/query worker
              │
 ~/.config/pig/statistics.sqlite
              │
     型付きRPC → Statistics画面 / export
```

### 4.1 観測の正本

- pigのbackendで集める。React/storeやウィンドウの表示状態から消費量を記録しない。
- ホスト単位のcollector/storeを一つ設け、複数windowで二重購読しない。
- session生成・切替・reload・forkに追従して購読を付け直し、旧epochを切り離す。
- `agent_start`をretryごとに別のユーザーrunとして数えず、
  継続中のrunのattemptにする。run終端は`agent_settled`等で確定する。
- 閉じる・クラッシュ・停止未確認で終端がなければinterrupted/unknownを残す。

初期の会話Usageは `message_end` の完成済みAssistantMessageを正本にする。
`entry_appended`は永続entryとの照合・復旧用で、別の加算ではない。
観測したrequest IDと永続entry IDの対応を保持する。timestampだけで同定しない。

補助呼び出しはSDKのnative telemetryまたは共通request境界で取得する。
どちらを使えるかP0で実呼び出し経路を確認して決める。
native telemetryにないreasoning・費用出典などは完成messageで補完する。
SDKの全spanをそのまま保存せず、allowlistでmetadataだけ取り出す。
任意のerror messageには秘密が含まれ得るため、安全な分類コードに変える。
分類だけへ情報を潰さず、利用可能な構造化error code・exit code・観測元も別に保存する。

共通event envelopeは `event_id / schema_version / source / source_version /
occurred_at / observed_at / host_epoch / sequence / session_id / run_id /
request_id / call_id / parent_id` を基本とする。該当しないIDはnull。
wall clockと単調時計のdurationを分け、event順序を時刻だけに依存させない。
開始・終端の対応を残すことで、終端欠損や同一event再送も検査できる。
失敗だけでなく正常実行も記録し、正しい母数と成功対照を確保する。

### 4.2 coverageを必須情報にする

最初から、会話、compaction、branch-summary、cache warm、subagent、
拡張内呼び出し、外部CLIそれぞれに `observed / partial / unobserved` を持つ。
観測できた拡張呼び出しでもrunへの帰属が不明なら、host全体の未割当として記録する。

pig外で実行されたPi CLIや第三者サービスの利用は初期対象外。
対応request境界を通らない外部通信まで「全使用量」に含まれると宣伝しない。
SDKが公開するrequestは論理単位の場合があるため、HTTP内部retry数は
別の証拠がない限り分からない。未観測の費用を推定加算しない。

### 4.3 チャットを妨げない

- callbackでは小さなDTOを作ってenqueueするだけ。DB/network待機を挟まない。
- `bun:sqlite`は同期APIなので、書込・重い集計は専用workerで行う。
- stream delta全文は保存せず、初回text時刻と確定値だけを採取する。
- 小さなbatchでtransaction。初期flush上限は1秒または100件を仮値とし負荷試験で調整。
- queueは有界。通常運用では確定eventをsamplingせず全件保存する。
  過負荷時は高頻度progressから制限し、usage・tool成否・retry・run終端を優先。
  それでも落ちた場合はlost countとcoverage低下を表示し、完全な統計としない。
- 書込失敗、worker停止、DBロック、容量不足でpromptを失敗させない。
  既存通知UIとStatisticsの計測状態で知らせ、エラー通知を連発しない。
- 終了時に期限付きflush。強制終了直前の未flush分は失われ得る。
  sessionに保存済みの会話Usageだけ再照合し、復元できない補助利用は不明のまま。

## 5. 保存設計

### 5.1 SQLiteを一つ追加

保存先案：`join(desktopConfigDir, "statistics.sqlite")`

現在のWindows環境では `%USERPROFILE%/.config/pig/statistics.sqlite`。
Pi標準のauth/session保存先は変更しない。
検索cacheや送信復旧DBから分離し、統計の破損・削除が会話復旧へ波及しないようにする。
既存の`bun:sqlite`を使い、初期段階でDBサーバー、ORM、外部集計サービスは追加しない。

WAL、transaction、schema version、限定的なbusy timeoutを使用。
unknownな新schemaは上書きせず収集を停止し、元DBを保持する。
pigのsingle-instance制御だけを重複排除の保証にせず、
別プロセス・dev/release同時起動でもSQLiteの一意制約で整合を保つ。
WALのdurability設定と電源断時の損失範囲はP0で試験して文書化する。

### 5.2 テーブル案

**初期収集基盤に必要なもの（Usage画面より広く収集）**

| テーブル | 役割 |
| --- | --- |
| `sessions` | profile/project/sessionの対応とローカル表示用metadata |
| `runs` | 実行単位、状態、構成参照 |
| `model_requests` | 一回の利用のtoken・費用・時間・目的・取得品質 |
| `request_sources` | native request/span/response/entryと消費行の対応。一意制約 |
| `config_snapshots` | 小さな構成snapshot。内容の重複保存を避ける |
| `collection_state` | schema/normalizer版、収集開始、coverage、checkpoint、欠損 |
| `deletion_tombstones` | 再照合/importによる削除データの復活防止 |
| `events` | tool/retry/recovery等。本文のない型別event |
| `context_manifests` / `context_sources` | requestごとのsource版と露出段階 |
| `memory_operations` | 対応済み連携先が公開する外部Memory itemの参照と操作履歴 |

**成果評価・比較機能を追加する段階**

| テーブル | 役割 |
| --- | --- |
| `tasks` / `task_runs` | 目的とrunの対応。sessionと別管理 |
| `evaluations` | 根拠付き成果・制約・訂正。revisionを持つ |
| `experiments` / `candidates` | 比較条件・結果・採用判断 |

集計軸のtimestamp/provider/model/project/session/purposeは通常の列にし、
範囲検索・group byに必要なindexを付ける。
event固有の小さな詳細だけversion付きJSONにする。
本文を何でも入れられる汎用ログ置場にはしない。
初期はSQL集計で十分。日次rollupや別の時系列DBは計測してから検討する。

### 5.3 重複・branch・過去履歴

- 使用量は「実行したrequest」に付く。rewindで消費済みtokenを減らさない。
- fork先へ継承した過去messageを新規利用として計上しない。
- fork時にorigin/request対応を引き継ぎ、fork後の新規requestだけ増分とする。
- session再open、UI再接続、複数window、event再送で値が増えないようにする。
- liveと永続entryの後追い照合は一意keyを使ったupsertで冪等にする。
- Provider response IDは補助key。全Providerで存在・一意を保証しない。
- sourceを識別できない過去messageを、timestampや本文hashだけで同一視しない。

初期は**有効化後のpig利用**を対象にする。勝手に全JSONLを走査しない。
過去履歴importは別段階の明示操作にする。

import時は現branchだけでなくsession treeの各entryを調べるが、
fork・コピーされたsession間のoriginを確実に復元できないものは、
「履歴参考集計」として分離してlive累積へ無条件に混ぜない。
再importは冪等にし、削除tombstoneと取込checkpointを守る。
古いログから初回text時刻、失われたattempt、補助呼び出し、正確な構成版は捏造しない。

### 5.4 保存期間・削除・export

初期値の提案（設定画面で明示し、実装時に最終決定）：

- Usageのrequest単位metadata：365日。
- 構造化したrun/tool詳細event・Context Manifest・Memory操作：Usageと同じ365日。
  後から分析する前に詳細を30日で消す設計にはしない。実測容量に応じて見直す。
- 根拠付き評価・実験記録：ユーザーが削除するまで。根拠消失は表示。
- prompt/tool出力/Memory本文：統計DBには保存しない。
- 全期間表示は「現在保持している全期間」。365日を超えた完全な生涯累計と呼ばない。

統計の収集ON/OFF、保持期間、全削除、project/session単位の削除を用意する。
初回にローカル収集の範囲を説明し、有効化前の履歴は自動importしない。
OFFは今後の収集停止とし、既存データ削除は別の明示操作。
未flush queueも削除・OFFのgenerationを見て、後からデータを復活させない。

session削除時は紐付く詳細統計も削除する方針を既定案とし、確認UIで明示する。
元requestを参照する別branchの対応は保ち、実消費の行を二重化しない。
削除した元request分は集計からも除外されることを説明する。
将来rollupを作る場合も、project/session単位の削除を正確に反映できる設計を条件にする。

DB/WAL、backup、exportまで含めた物理的完全消去は通常DELETEだけでは保証しない。
DBは平文でありOSのユーザー権限に依存する。hashは匿名化ではない。

CSV/JSON exportは期間・用途を指定し、token・費用・coverageなど安全な項目を既定にする。
project名・path・session名・provider response IDは既定exportから外す。
CSVは数式注入を防ぐ。export後のファイルはアプリから回収できないことを示す。

## 6. 画面と集計

### 6.1 Usage Statistics（最初のリリース）

専用Statistics画面に、まず次を置く。

1. **概要**：合計token、入力・出力・cache内訳、request数、利用session数。
2. **推移**：日別token数。期間選択は今日／7日／30日／任意。
3. **内訳**：Provider・モデル・プロジェクト・session・実行目的別。
4. **費用**：Provider報告額／推定額／不明を区別。
5. **時間**：request所要時間の中央値・p95、run経過時間。
6. **取得状態**：収集開始時刻、対象範囲、unknown件数、失敗・欠損。

フィルタは期間、project、Provider/model、purpose。accountやreasoningは詳細側へ。
request数はHTTP通信回数ではなく観測した論理呼び出し数と定義する。
cache-read比率は既知の入力量を分母にし、対象件数・coverageを併記。
reasoning未提供のrequestを0として混ぜた「平均reasoning」を出さない。
中央値・p95には標本数を表示し、少数なら参考値とする。
token合計には「既知分」とunknown件数を表示し、見かけ上の完全性を作らない。

「消費が多いモデル」「長い会話」を即座に悪い使い方と判定しない。
人間が見直すための事実表示に留める。

### 6.2 Harness Statistics（後続）

- run詳細：構成 → Context → model/tool → 検証・訂正をたどる。
- 反復失敗：エラー種別、ツール、構成版、再試行、回復時間。
- 成果：成功／部分成功／失敗／不明、母数、判定根拠。
- compaction/Memory：量ではなく後続の再調査・制約欠落・訂正。
- 実験：同条件のbaseline/candidate、品質・費用・時間、採否。

「成功1件当たり費用」は、比較範囲の失敗・retry・子処理を含む全費用÷検証済み成功数。
成功0なら未定義。未知費用があれば不完全な値と表示する。
モデル・課題構成の違う期間比較から改善効果を断定しない。

### 6.3 UI制約

既存のトークン・Card・Popover・表・スクロール部品を使う。
新画面のために共通ルールを増やさない。
Composer下には統計・エラー・ヒントを追加しない。
既存Provider Usageの表示・pollingは変更しない。
確定値のbatch更新を使い、tokenごとのグラフ再描画をしない。
重い集計はRPCで非同期取得し、期間変更時の古い応答を採用しない。

## 7. 実装フェーズ

### P0：計測契約を固定する

実装予定箇所：SDK境界のfixtureと `bun/statistics/*.test.ts`。

- main requestの開始・完成・永続化・settledの順序をfixture化。
- retry/abort/fork/reload/queued sendとID対応を確認。
- toolの正常・エラー・引数不正・権限拒否・timeout・中断をfixture化し、
  SDKの成否とexit codeの区別、nested tool、終端欠損を検証。
- Providerごとのusage 0/欠損、cache/reasoning/total/costの意味を確認。
- compaction/summary/cache warm/拡張の経路とnative telemetryのcoverageを確認。
- final payload callbackの順序・改変契約を確認。
- worker+SQLiteのshutdown/crash/lockと、無計測時との性能差を測る。

**完了条件**：取得可能・不可能・部分的を表にし、数え方と一意keyのfixtureが通る。
無料のfake Providerで可能なものは実APIを呼ばない。
実アカウントの課金呼び出しが必要な検証は別途承認を得る。

### P1：決定論的な実行情報を広く収集・保存する

新規ファイル案：

- `shared/statistics.ts`：保存・RPCの安全な型と指標の定義。
- `bun/statistics/collector.ts`：イベント正規化、ID照合、coverage。
- `bun/statistics/store.ts`：schema/migration、upsert、削除。
- `bun/statistics/worker.ts`：batch保存、集計query、flush。
- `bun/statistics/normalize.ts`：token・費用・nullの規則。
- `bun/statistics/tool-metadata.ts`：共通tool結果とtool別の安全な構造化metadata抽出。

接続箇所：

- `session-host.ts`：subscribe/rebind/lifecycle。
- `model-runtime.ts`と必要なSDK公開境界：補助requestの観測。
- `resources.ts`と公開payload境界：source版・ロード・変換・観測できる送信段階。
- tool実行境界と対応済みMemory adapter：構造化された結果・操作。
- `pi-service.ts` / `app.ts`：host単位の初期化・shutdown。
- `shared/settings.ts` / `bun/settings.ts`：収集設定・保持期間。

初期収集の必須対象：

- 会話Usageと観測可能な補助request。
- 全toolのstart/end、成否、引数検証、取得可能なexit code・timeout・出力サイズ。
- retry・queue・abort・resume/fork/rewindと構成変更。
- compactionの開始終了・成否・前後量と関連request。
- Contextのsource版・ロード・採否など観測できる各段階。
- 対応済みMemory連携先の構造化event。
- 収集自体の欠損・遅延・エラー。

分析画面がないことを未収集の理由にしない。
補助処理や拡張固有の情報に観測上の制約があれば、未対応範囲を個別に明示する。

**完了条件**：live/reopen/retry/forkで重複がなく、known/unknownが保存され、
成功・失敗双方のtool実行とライフサイクルをIDで追え、後から集計を作れる。
記録失敗でも会話を継続でき、既存session/auth保存は変わらない。

### P2：Usage画面・export・削除

- `bun/statistics/queries.ts`、`shared/rpc-schema.ts`、`app.ts`に期間集計RPC。
- `mainview/StatisticsView.tsx`と既存ナビゲーションに入口。
- `mainview/store.ts`に画面表示時だけのqueryと更新通知。
- `shared/i18n.ts`、Storybook、UI検査fixture。
- 収集設定、計測状態、保持期間、project/session削除、CSV/JSON export。

**完了条件**：日付境界、token内数、金額出典、欠損を正しく表示。
再起動後も集計が一致し、削除データが再出現しない。

**ここまでを最初の利用可能なリリースとする。**

### P3：蓄積済みHarness情報の可視化と成果評価

- P1から蓄積したtool/retry/recovery・Contextの詳細表示と集計。
- task/run対応、根拠付き評価、明示的な訂正・差し戻し。
- run詳細と失敗候補の集計。
- 過去eventから規則ベースの反復・再読などを再集計する。

**完了条件**：「指示が渡らない」「渡ったが違反」「成功未確認」を混同せず、
対象run・構成・証拠へたどれる。
評価は既存通知・専用詳細画面を使い、毎回答に評価を強制しない。

### P4：Memory連携の拡充・有用性評価・比較実験

- 未対応のMemory連携先に限定したadapter追加。
- 初期から取った訂正・失効・削除・派生参照の可視化と、有用性の評価。
- 固定task/repo/Memory snapshotでbaselineと小変更を比較。
- 独立した検証課題、全費用、採否とrollbackを記録。

**完了条件**：改善案の有効範囲と回帰を説明でき、人間承認なしに本番を変えない。
自動学習router・自由なAGENTS自己改変はこの計画の対象外。

### 別枠：過去履歴import

P2以降、live Usageが安定してから。
forkのorigin・重複排除の保証がない履歴は参考値として分離する。
必要がなければ実装しない。過去に遡らなくても新規Usageの可視化は成立する。

## 8. 検証計画

| 分類 | 必須ケース |
| --- | --- |
| 数値 | input/cache内数、reasoning内数、0/null、不正値、total不一致、価格なし、Provider報告額 |
| lifecycle | retry後成功、retry枯渇、abort、agent_end後継続、settled、reload、停止未確認 |
| tool事実 | 正常・失敗双方、isError/exit code不一致、引数不正、拒否、timeout、nested call、終端欠損 |
| identity | 同timestampの別request、event再送、entry後追い、複数window、fork継承、rewind |
| 補助呼び出し | compaction/summary/cache warm、unknown purpose、会話eventとの二重収集 |
| 永続化 | migration、未来schema、worker停止、lock、disk full、crash直前、再照合 |
| privacy | prompt/引数/結果/token/header/error秘密文字列がDB・export・診断ログへ漏れない |
| 削除 | 保存中削除、OFF、全削除、session/project削除、importでの復活防止 |
| 集計 | timezone、夏時間、日跨ぎ、期間境界、partial usage、異なる通貨、少数p95 |
| UI | 空状態、収集中、unknown、DB障害、大量データ、狭い幅、キーボード、描画ルール |
| 性能 | 統計OFF/ON、複数session、長いtool出力、DB lock、集計中の初回text・入力応答 |

実装時はchanged pathsのLSP診断後、関連unit testに加えて次を実行する。

```powershell
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm test
mise exec -- pnpm test:ui
```

UIはStorybookの実描画で確認する。開発アプリが必要な場合は`mise run dev`を使い、
既存の開発ウィンドウがある状態で別の`pnpm dev`を起動しない。

## 9. 初期にやらないこと・残る確認

やらないこと：

- クラウドへの自動送信、全文ログの常時複製。
- Provider枠の履歴保存や請求照合の新規サービス。
- ユーザーの操作監視、無断の会話分類・全件LLM採点。
- 全面自己改変、bandit、graph DB、汎用observability framework。
- 観測できない呼び出しや消えたusageの推測補完。

実装前に詰めること：

1. P0で補助モデル呼び出し・拡張Providerの到達可能な観測点を確認する。
2. requestとentry、forkのoriginを安定して結ぶ方法をfixtureで確定する。
3. 初期有効化UI、構造化metadataの保持期間365日、session削除時の統計削除方針を最終確認する。
4. 専用Statistics画面の入口とレイアウトを既存UI上で確認する。

最初の到達点は、**人間には使い方を見直せるUsage、開発には根拠付きで失敗を追える記録**
を提供すること。観測可能な実行情報は最初から広く残し、Usageを先に可視化しながら、
同じrequest/run IDの上へHarnessの分析画面・品質評価を追加する。
