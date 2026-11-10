# Piクライアントの起動待ち・チャット切り替え比較

公開ソースを固定commitで確認した調査。アプリを起動した速度比較ではない。今回はこの文書のみ追加し、製品コードは変更していない。

## 結論

pigの「選択と起動を分離し、別チャットへ移動しても起動を継続する」方向は、pi-gna / pi-guiと一致する。一方、公開pi-clientにはruntime待ちや共通キューが残っており、全実装を高速化の正解としてコピーすべきではない。

今回、新しく優先度が上がった改善候補は次の2つ。

1. **pi-gnaの転送bytes予算と長い単一turnの分割。** pigの50 entry目安は応答の先頭まで広げるため、1応答が長いとページが大きくなる。
2. **pi-guiのruntime層での同一セッション起動のsingle-flight。** pigの再利用は現在renderer内のPromiseが中心。別のopenIdが同じ起動中セッションへ到達すると、backendは共有せず拒否する。

## 対象

| クライアント | 固定commit | 特に参考になる点 |
|---|---|---|
| Hu-Wentao/pi-client | `ba2796568b86a3f224858f09e57bda75d4411cc6` | 選択generation、50メッセージのページ取得、安全なidle退避 |
| manuelcecchetto/pi-gna | `5557d28251d4e0f0b6016d8d74d13694ec649cbc` | 即時activate、履歴と起動の並行化、bytes予算、inline確認UI |
| minghinmatthewlam/pi-gui | `faf8edd6d7a7e3bf3c508d6f600a22d3821ac108` | 選択先行、selectionEpoch、runtime起動single-flight、下書き保護 |
| gustavonline/pi-desktop | `5d698433864fbebafa24e141da0ea56297766cfe` | タブごとのruntimeとgeneration。ただし共通タスクキューに注意 |

Hu-Wentao版はarchive済みの公開版。非公開後継Frely Clientの内部実装を確認したものではない。

## 1. Hu-Wentao/pi-client

### UIは別セッションを選べる

- `workspace.v.dart`はsession選択callbackを`conversationLoading`で無効化していない。
- `session_browser.v.dart`の行は`onTap`から選択を通知する。一覧読み込み中でも、すでにある行を一律無効にはしていない。
- `workspace.vm.dart`の`_onSessionSelected`は`_sessionLoadGeneration`を増やし、`_isCurrentSessionLoad`で遅い応答を破棄する。
- `test/workspace_view_model_test.dart:1026`には、後から選択したセッションが先に読み込まれても、遅れて完了した最初の結果で巻き戻らないテストがある。

### ただし履歴表示はruntime待ち

```text
選択
  → 最新50メッセージ / tree / statsをFuture.waitで要求
  → protocol側のgetSessionHistory
      → loadSessionSnapshot
          → SDK runtime作成
      → getLoadedSessionHistory
  → 3要求がすべて完了してから本文表示
```

`PiNodeDomainService.loadSessionSnapshot`は共通`SerialExecutor`でruntime作成まで待つ。別セッションのロードも同じexecutorを通る。したがって、UIでBを選べても、Bのデータ取得がAのロード待ちになる経路がある。履歴APIがページ化されていることと、初回runtime待ちがないことは別。

ロード済みruntimeはsession IDで再利用する。上限は既定8件で、実行中・監視中・command処理中のものは追い出さず、条件を満たす最古のセッションを閉じる。新規作成には`_creatingSession`による重複防止があるが、pigのような「プロジェクト別に同じ起動Promiseを再選択」は今回読んだfrontend経路には見当たらなかった。

Trustは`showDialog`、`barrierDismissible: false`で確認する。pigが目指す非ブロッキングなstartup UIとは異なる。

根拠：

- [選択・generation・Future.wait](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.vm.dart#L575)
- [行の選択](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/components/session_browser/session_browser.v.dart#L294)
- [履歴取得の前段にruntimeロード](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/protocol/pi-node-protocol-domain-port.ts#L165)
- [共通executorでのロード](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-node-domain-service.ts#L289)
- [Trustダイアログ](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.v.dart#L442)

## 2. pi-gna

### 選択は同期、ロードは裏側

`openSession`は既存の同じファイルがあれば即座に`activate`する。なければ`start`が先にhandleと画面状態を登録・選択し、`void load(...)`でhostへの要求を開始する。全体のopeningフラグで別チャットへの移動を止めない。

host側もpi processを起動した後、`readActiveBranch`で履歴を読む。`get_state`の完了は別の非同期処理で通知する。履歴を読めれば、piの準備完了を待たずにopen結果を返す。

ロード中のイベントはhandle別にbufferへ保持し、Snapshotの`seq`より新しいものだけ後から適用する。初期履歴とliveイベントの競合を、画面ロックではなく順序制御で解決している。

### 履歴は件数だけでなく容量でも制限

Desktopの既定値は**40 turn / 2,000,000 bytes目安**。古いturnはoutlineだけを残し、必要時に本文を追加取得する。

最新の1 turnが大きい場合も、item途中の位置を`turns.offset`で持ってページを分ける。ただし最後の1 itemは単独で予算を超えても残すため、2MBが厳密な上限という意味ではない。画像URLやpayloadの退避・復元も別途扱う。

### 確認UIと予熱

- select / confirm / input / editorはcomposer上の通常のカード。アプリ全体を覆うmodalではない。
- idle停止は実行・compaction・未読・確認待ち・閲覧中を除外して判断する。
- 次の新規チャット用にspareを最大1つ予熱する。cwd / trust / features / 入力設定が一致するときだけ使い、負荷や期限で破棄する。既存チャットの履歴表示を速くする仕組みとは別。

pigへの示唆：先行表示・状態の所有者分離は今回の方向でよい。次は**単一の長い応答でも初期転送量を抑えること**。その際は、tool call/resultの関連や応答全体の統計を別途保ち、単純な配列sliceだけで切らない。

根拠：

- [即時activateと非同期load](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/renderer/src/state/app.ts#L255)
- [起動と履歴読み込みの並行化](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L313)
- [bytes予算・turn内cursor](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L568)
- [ページの既定値](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/shared/chat-page.ts#L6)
- [inline確認カード](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/renderer/src/components/Dialogs.tsx#L1)

## 3. pi-gui

### 選択とhydrationを明示的に分離

- rendererは切り替え前にdebounce中の下書きをflushし、スクロール位置を保存する。
- `selectSessionFast`は`applyFastSessionSelection`で選択先・下書き・添付を先に反映し、状態をemitする。
- キャッシュ済み履歴はこの時点でpublishする。その後、runtimeや添付等をhydrateする。
- 完了時は`selectionEpoch`とworkspace/session両方が一致するか確認する。背景で完了した処理は現在の選択を上書きしない。

ただし初めて読む履歴の表示経路には`ensureSessionReady`完了後のpublishもあり、「未キャッシュの履歴も必ずruntimeより先に表示する」とは断定しない。

### backendに同一起動のsingle-flightがある

`SessionSupervisor.ensureRecord`は`workspaceId + sessionId`のkeyで、進行中のPromiseを`singleFlight`で再利用する。frontendの連打対策だけでなく、runtimeを作る層で二重作成とリークを防ぐ。

`getTranscript`は、runtimeがなくてもJSONLから履歴を読める。モデル環境はセッションごとに分離し、他workspaceの拡張provider・endpoint・credentialが混ざらないようにする。高速化のために実行環境そのものを共用してはいない。

### 確認UIの方針はpigと異なる

選択中セッションの確認UIを表示し、threadを離れる前に旧セッションのpending dialogをキャンセルする経路がある。キャンセルを省略するhost側policyもあるため、無条件に必ず破棄されるとはしない。

pigでは切り替えだけで承認要求を勝手に破棄せず、保留して戻れる方針を維持するのがよい。single-flightだけを取り入れる場合も、一つのviewのキャンセルで他のownerの起動まで中止しないようにする必要がある。

根拠：

- [下書きflushとスクロール保存](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/src/app/App.tsx#L827)
- [選択先行](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/electron/application/app-store.ts#L982)
- [即時emitとselectionEpoch](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/electron/application/app-store.ts#L4353)
- [runtimeなしの履歴取得](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/packages/pi-sdk-driver/src/session-supervisor.ts#L647)
- [runtime起動single-flight](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/packages/pi-sdk-driver/src/session-supervisor.ts#L1715)
- [旧dialogのキャンセル方針](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/electron/workspace/app-store-workspace.ts#L272)

## 4. gustavonline/pi-desktop

タブ選択を先に反映し、タブ別のruntimeを保持する。`taskVersion` / runtime generationで古い完了の反映を防ぐ。

ただしruntime起動やsession切り替えは`queueProjectTask`の共通Promiseチェーンへ入る。version更新は古い処理の反映を止めるが、すでにawaitしている起動処理を即時に完了させるわけではない。Bのタブが見えても、Bのデータ取得はAの処理終了を待つことがある。

またsession browserでは`switchSession`をawaitしてからダイアログを閉じる。pigの「閲覧・選択を起動待ちに従属させない」用途では、そのまま採るべき方式ではない。

根拠：

- [共通Promiseキューとversion判定](https://github.com/gustavonline/pi-desktop/blob/5d698433864fbebafa24e141da0ea56297766cfe/src/main.ts#L1503)
- [タブ先行選択後にキューへ投入](https://github.com/gustavonline/pi-desktop/blob/5d698433864fbebafa24e141da0ea56297766cfe/src/main.ts#L3999)
- [runtimeごとの準備](https://github.com/gustavonline/pi-desktop/blob/5d698433864fbebafa24e141da0ea56297766cfe/src/main.ts#L2666)
- [switchSession完了後にbrowserを閉じる](https://github.com/gustavonline/pi-desktop/blob/5d698433864fbebafa24e141da0ea56297766cfe/src/components/session-browser.ts#L140)

## pigへの適用判断

- **維持**：選択の即時反映、履歴の先行表示、起動の継続、renderer内Promise再利用、openId / navigation revision / epochによる所有者確認。
- **次の候補**：転送bytes予算、長い1 turnの分割と概要・統計の保持、runtime層の同一セッション起動の共有。
- **負荷を測ってから**：安全なidle runtime退避。実行・確認待ち・未送信操作・利用中のownerを除外すること。まず無制限の全セッション予熱はしない。
- **採らない**：UI全体のロック、本文表示とtree/stats完了の結合、閲覧を共通runtimeキューの後ろに置くこと、切り替えを理由にした承認要求の無条件破棄。
- SDKにprocess-global状態がある処理の直列化まで雑に削除しない。**直列化の有無より、履歴とnavigationをその待ちに巻き込まないこと**が重要。

未実施：他アプリのビルド・実機操作・速度計測、非公開Frely後継版の確認、今回の追加候補の実装。公開ソースとそこに含まれるテストを読んだ調査であり、他アプリのテストを実行したとはしない。
