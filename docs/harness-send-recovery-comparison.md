# 他ハーネスの送信・接続復旧フォールバック比較

## 結論

pigに取り入れる優先順位は、**OpenCodeの「送信内容を固定し、応答以外の証拠でも受付を確定する」**、次に**pi-gnaの「同一操作の識別とホスト再起動の区別」**。

ただし、どの実装も「タイムアウトしたら新規送信として再実行すれば安全」とはしていない。さらに、**再接続watchdogと送信の受付期限は別物**。他製品の35秒・45秒のwatchdogをコピーしても、pigの未解決prompt RPC待ちは解消しない。

pi-clientは受付不明の扱いが参考になる一方、公開版は送信受付の時間上限や完全な再接続を実現した完成例ではなかった。

## 調査範囲・版

2026-11-10にGitHub APIでHEADを解決し、固定commitの生ソースとテストを読んだ。Issueだけから現行実装を推測していない。

| 対象 | commit | commit日時（UTC） |
|---|---|---|
| Hu-Wentao/pi-client | `ba2796568b86a3f224858f09e57bda75d4411cc6` | 2026-09-06 |
| manuelcecchetto/pi-gna | `5557d28251d4e0f0b6016d8d74d13694ec649cbc` | 2026-10-31 |
| anomalyco/opencode | `8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c` | 2026-11-10 |

pi-clientは前回調査と同じ公開archive版。非公開後継Frely Clientの挙動は未確認。OpenCodeは現行のsession/inbox方式を対象とし、古いV1の`prompt_async`とは分ける。

製品コード・既存の未コミット変更は変更していない。他製品を起動しての障害注入・速度比較、取得した他製品のテスト実行は行っていない。

## まず区別する4種類のフォールバック

1. **送信応答だけ失った**：実行済みかもしれない。receipt、同じ受付ID、権威あるイベントで照合する。
2. **イベント接続を失った**：最後のseqからreplayし、できなければSnapshotを取得する。prompt再送とは別。
3. **runtimeや拡張が遅い**：履歴・下書きのUIを残し、待機中の状態と中断操作を示す。再接続だけでは直らない。
4. **ホストが再起動した**：メモリ内の受付台帳が失われる。旧操作を新ホストへ自動再送しない。

## 1. pi-client：accepted / rejected / uncertainを明示する

### 実装

- [SDK adapter: startPrompt](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-sdk-domain-session.ts#L605-L693)
  - SDKのpreflight通知とprompt完了を`Promise.race`する。
  - 受付確定後はcompletionを別Promiseとして扱う。
  - preflightを観測せずpromptが終了した場合は`uncertain`。ただしこれは**タイマーとのraceではない**。
  - SDK/APIの版差があるので、このarchiveのpreflight引数の扱いをpigのSDKへそのまま移植しない。
- [Dart client: _sendCommand](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/api/pi_node/pi_node_client.dart#L930-L973)
  - requestIdごとのpending completerを保持。フレーム送信失敗・切断で解決するが、この経路に受付timeoutはない。
  - [_PendingCommand.fail](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/api/pi_node/pi_node_client.dart#L1555-L1605)は通信失敗を`PiCommandUncertain`にする。未実行だとは決めつけない。
- [Workspace: prompt送信](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.vm.dart#L1687-L1817)
  - 送信したtextを先に会話へoptimistic表示し、`originCommandId`で対応づける。
  - acceptedならsendingを解除してrunningへ。rejectedならoptimistic entryを除去。
  - uncertainならsendingを解除するがrunning扱いを保ち、「再送前に会話をrefresh」と明示。自動再送はしない。
  - このUIはrunning中の通常送信を拒否する。pigのfollow-up要件と同じではない。
- [イベント復旧](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.vm.dart#L1925-L2045)
  - seq/revision gapを検出すると権威ある状態を再取得する。
  - 切断時はsending/stoppingを解除して接続し直す案内を出す。

### 重複排除の限界

[connection側のclaimRequest / claimCommand](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/protocol/pi-node-protobuf-connection.ts#L1761-L1798)は使用済みIDを`ALREADY_EXISTS`として拒否する。**同じIDで以前の受付結果を返すidempotency ledgerではなく、集合もconnectionローカル**。

[README](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/README.md#L200-L215)にも完全なreconnect/replayが未提供とある。生きているが返答しないSDK/transportの待ちを、短時間で解消する根拠は見つからなかった。

**採る点**：受付不明を失敗に潰さない、optimistic表示をcommand identityで照合する。
**採らない点**：この公開版を「送信ハング対策が完成している実装」とみなすこと。

## 2. pi-gna：キー付き再試行＋bootId＋イベントreplay

### 応答喪失からの復旧（remote/mobile経路）

- [HostClient.call / send](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/mobile/client/host-client.ts#L242-L285)
  - mutationは呼び出し単位でUUIDとJSON本文を固定し、再試行でも同じ`Idempotency-Key`を使う。
  - unavailable / rate_limited / internalで最大3回再試行。間隔は500 / 1500 / 4000ms、指定があればRetry-Afterを優先。
  - `host_restarted`は再試行しない。
- [IdempotencyCache](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/command-layer.ts#L16-L70)
  - device＋method＋keyで結果Promiseを共有し、処理中の同一要求も同じPromiseを待つ。
  - 本文が違う同じキーは拒否。完了結果は10分・deviceあたり最大1000件のメモリcache。
  - 既知の旧bootIdと現在のbootIdが違えば、実行前に`host_restarted`。
  - 大きすぎる結果は再実行せず`result_unavailable`を返して再取得へ誘導する。

重要：10分は**結果保持期間**であり、受付待ちのtimeoutではない。

### イベント接続の復旧

[HostClientのstream処理](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/mobile/client/host-client.ts#L364-L451)はbootId＋seqで再開位置を指定する。35秒のイベント無受信で接続を作り直し、online / pageshow / foreground復帰でも再接続する。

[EventHub](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/event-hub.ts#L40-L99)は最大2000event / 8MiBのringからreplay。boot変更・ringから消えたgapはresyncへ落とす。Snapshotのseq以下を再適用せず、取得中に来た新しいイベントを反映する。

[reconnect E2E](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/scripts/remote-e2e/reconnect.e2e.mjs#L13-L99)は、同一キーでのprompt再試行でturnが増えないこと、replay、ring overflow時のSnapshot復旧を検証する内容。今回そのE2Eは実行していない。

### 下書き・起動・負荷

- [MobileComposer](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/mobile/MobileComposer.tsx#L160-L181)は送信時のtext/attachmentsを捕捉し、受付後もtextが同じ場合だけ消す。待ち中の編集を消さない。
- ただし[desktop Composer](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/renderer/src/components/Composer.tsx#L250-L258)は先に入力を消し、失敗時に捕捉したtextを戻すだけ。この断片には「新しい下書きで上書きしない」比較がなく、mobileと同じ安全性とは扱わない。
- [SessionHost.open](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L314-L405)は履歴読取とpi起動を並行化。起動失敗でも履歴を表示できる。新規chatのspareも使う。
- [coalesce](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/coalesce.ts#L1-L40)はtext/thinking/toolcall deltaを16ms程度まとめる。他のイベントは先行deltaをflushして順序を保つ。

### そのままコピーできない点

- [PiProcess.send](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/pi-process.ts#L254-L263)にコマンドごとのtimeoutはない。process exitではpendingを解決するが、生きたまま無応答なら待ち続け得る。
- mobileのfetchにもこの送信経路自身が設定する受付期限はない。35秒watchdogはSSE用であり、未解決fetchを中断しない。
- cacheは期限切れ・上限による退去・再起動を越える永続台帳ではない。失敗結果は保持せず、次回は処理をやり直すので、副作用後の失敗まで一般にexactly-onceとはいえない。
- clientの`send`は各試行で現在のstoreのbootIdを読む。pigで同方式を採るなら、再接続中に元のhost identityが差し替わらないよう、操作時のhostIdを固定する必要がある。

**採る点**：同じ操作のidentity、boot変更時に止める、replay不能ならSnapshot、表示deltaのcoalesce。
**採らない点**：メモリcacheだけで永続的な重複防止ができるとみなすこと。

## 3. 現行OpenCode：永続inboxへの受付と実行を分離する

### サーバー：受付IDを永続状態と照合

[Session.prompt](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/core/src/session/session.ts#L155-L191)は次の順序：

```text
client指定のmessage IDを既存inbox / 会話レコードと照合
  → 既存ならその受付を返す
  → 新規ならprompt準備と永続inboxへのadmit
  → execution.wake
  → 受付結果を返す（モデル回答完了は待たない）
```

[SessionInbox.reconcile / admit](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/core/src/session/inbox.ts#L121-L224)はinbox tableを読み、すでに会話へpromote済みならmessage tableから復元する。受付の証拠が接続ローカルのMapだけではない。

ただし「同じIDなら本文相違をエラー」はこの実装の規則ではない。**同じsession/typeなら最初の受付が勝ち、後の本文は使わない**。別session/type等のライフサイクル競合は拒否する。保持された受付/会話レコードを使った重複排除であり、ツールの外部副作用のexactly-once保証ではない。

### クライアント：応答と権威あるイベントを独立に扱う

- [data.session.prompt](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/client/src/solid/data.ts#L1734-L1783)
  - client発行IDでoptimistic行を先に作り、durableな`session.inbox.enqueued`で同じ行をupsertする。
  - 正のpending読取も受付の証拠にする。新しい未確定行だけをrollbackし、サーバーがすでに認めた行は消さない。
- [composer.sendPrompt](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/submit.ts#L778-L831)
  - 失敗時は同じadmission ID・同じpayloadで1回再試行する。selectionのcommitも再利用する。
  - [failSubmission](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/submit.ts#L875-L889)は、HTTPが失敗しても`session.admitted(id)`なら失敗復元をしない。
- [retry fingerprint](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/retry.ts#L7-L63)
  - 復元した下書きを再送する場合も、実際のpayloadが同じときだけ前のIDを再利用する。
  - textだけでなくモデル・delivery・context・画像blob ID等を含めて比較。本文を編集した送信は新しい操作になる。

### 下書き・準備中のfallback

[submit machine](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/machine.ts#L200-L249)はagents/models待ちをheldとして区別する。まだ入力欄内のheldは編集で解除し、すでに会話へ表示したheldはEnter時の内容で進む。Stopやunmountでheldを取り消せる。

[clearComposer / restore](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/submit.ts#L383-L455)は送信用に捕捉した下書きと、次の入力を分ける。[テスト](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/app/src/composer/submit.test.ts#L997-L1049)にも「送信失敗で次の下書きを上書きしない」「応答を失ってもdurable inboxが受付済みなら復元しない」がある。

### 接続のfallbackと限界

[createClientConnection](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/client/src/solid/connection.ts#L13-L39)はイベント接続開始2秒、無通信45秒、再接続間隔1秒。keepaliveの受信もwatchdogを更新し、foreground復帰やonlineでresyncする。通知は既定10msでbatchする。

これは**session.promptの受付timeoutが2秒という意味ではない**。今回読んだcomposer/dataの送信経路には専用の短い受付deadlineは見当たらない。未解決Promiseが長引く場合の時間上限を、上記watchdogで保証してはいない。

また[SessionPrompt.prepare](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/core/src/session/prompt.ts#L34-L90)は永続admitより前にplugin activation・prompt hook・添付ファイル準備を待つ。**永続queueがあっても、すべての遅い前処理を受付後へ移したわけではない**。

[server側テスト](https://github.com/anomalyco/opencode/blob/8f0bf22d69a7f6f98ea1a7a9196b1d5a3e449c0c/packages/core/test/session-prompt.test.ts#L979-L1078)は同じIDで受付が増えないこと、promote後の照合、commit済みpromptのretryによるexecution再開を扱う。今回テストは実行していない。

**採る点**：捕捉した送信と次の下書きを分ける、受付イベントでも確定、失敗応答で受付済み行を消さない、payloadとIDを結び付ける。
**採らない点**：このためだけにpigを丸ごと永続inbox/DBへ移行すること。段階的に適用できる。

## 4. pigへの適用判断（未実装の提案）

### 小さい変更でまず採る

1. **prompt RPCが未解決の間にも、短い期限でreceiptの読み取り照会を開始する。** 照会自体にも短い待ち上限を持たせ、requestId/hostId/epochで遅い結果を保護する。照会を始めることと、元の操作を中断することを混同しない。
2. **クリック時の送信内容・版を固定する。** 新しい入力は次の下書きへ。失敗時は新しい下書きを上書きせず、受付が不明な内容も保持する。既存の拡張editor同期/CAS検証を迂回しない。
3. **準備中と受付不明を見える状態にし、中断手段を残す。** backend受信・SDK受付・実行中は別。単にスピナーを消して成功扱いにはしない。
4. **表示更新をcoalesceし、通常イベント配送を一本化する。** 復旧用Snapshotは残す。rawイベント順序・SDK状態を削らず、不要な毎更新ディスク保存も止める。

### すぐには採らない

- pigにはすでに同一requestIdのledgerと読み取り専用receiptがある。最初はそれを活かし、OpenCodeの自動再試行だけを切り出してコピーしない。
- ホスト再起動後まで安全に再送したい要件が出た場合に、永続受付＋実行再開の設計を別途検討する。in-memory ledgerへタイマーを追加するだけで同等にはならない。
- 任意の拡張hookにtimeoutを入れても、そのPromiseや副作用が止まるとは限らない。「失敗表示後に遅れてモデルが動く」事態を防ぐキャンセル境界が先。

### 必要な回帰テスト

- SDKは受付済み、prompt RPC応答だけ喪失：receipt照会で確定し、prompt呼び出しは1回。
- receipt照会も不通：画面を無期限に操作不能にせず、下書きを保持。未実行とは断言しない。
- 旧hostの送信中に新hostへ接続：古い操作を新hostへ自動移送しない。
- 遅い下書きACK中に入力：最初の送信内容は変わらず、新しい下書きも残る。
- 遅いinput/start/settled hook中にStop：解除後にモデルが遅れて起動しない。
- optimistic行の受付イベント後にRPC失敗：行の削除・二重送信・下書き復元をしない。

## 調査の限界

公開ソースとテストコードの比較であり、他製品の実機での障害復旧を実測したものではない。pi-client非公開後継版やClaude/Codex Desktopの非公開frontend実装は対象外。列挙したtimeoutは各接続/送信経路の範囲を明示しており、製品全体の復旧時間保証ではない。
