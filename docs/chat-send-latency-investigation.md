# チャット初期化・送信待ちの追加調査

## 対象と結論

2026-11-10の作業ツリー（既存の未コミット変更を含む）を調査。製品コード・既存の変更は触っていない。調査中にも別途編集が進んでいるため、行番号より関数名を参照する。

**単に描画が遅いだけではない。受付処理・通信復旧・UIの操作ロックが一緒になっており、遅い処理や応答喪失が「次のメッセージを送れない」に直結する。**

一方、通常の送信がLLMの回答完了まで待つ実装ではない。`SendReceipts.send`はSDKの`preflightResult`で応答し、回答完了前に次の送信を通す。この点は既存テストでも確認した。

以前の `docs/chat-open-performance-study.md` にある指摘の一部は、現在の作業ツリーですでに改善済み：

- `SessionHost.open`はruntime作成前に履歴previewを通知する。
- `resolveSessionFile`はSDKの`findById`とheader所属検証を使う。通常openで`SessionManager.list`を使う旧経路ではない。
- 履歴は末尾50entryを目安にページングする。
- `projectEntries`から不要な`getTree` / `getEntries`呼び出しがなくなっている。

以下はそれでも残る問題。

## 1. P0：RPC応答が途絶えると、最大10分間は受付照会すらしない

対象：

- `apps/desktop/src/mainview/rpc.ts`: `Electroview.defineRPC`（`maxRequestTime: 600_000`）
- `apps/desktop/src/mainview/send-controller.ts`: `send` / `lookup`
- `apps/desktop/node_modules/electrobun/dist/api/shared/rpc.ts`: `requestFn`

```text
送信中にする
  → 下書き同期RPCをawait
  → prompt RPCをawait
  → prompt RPCが失敗して初めてgetPromptReceipt
```

`prompt`が未解決の間に受付照会を開始するタイマーはない。SDKから受付が確定していても、そのRPC応答だけが失われると、ユーザーはタイムアウトまで送信中のまま。下書き同期の応答が失われた場合は、promptを送る前から待つ。

最初の照会以降も、照会RPC自体に同じ10分タイムアウトが適用される。`1500ms`は照会完了後の再照会間隔であり、通信不通時に1.5秒ごとに復旧できるという意味ではない。

**再現**：hostではacceptedを返せる設定にし、prompt応答Promiseだけ未解決に保持。100ms後も`state=sending`、`getPromptReceipt`呼び出し0回、2回目の送信も抑止された。10分を実際に待った計測ではなく、上記タイムアウト設定と照合した結果。

改善：長いRPCとは別に短い受付確認期限を持ち、同じrequestIdの**読み取り専用照会**を始める。遅い応答との競合をrequestIdで保護する。タイムアウトだけで未実行と判断したり、新しいrequestIdで自動再送したりしてはいけない。

## 2. P1：拡張・前処理の待ち時間が、操作不能の「送信中」になる

対象：

- `apps/desktop/src/bun/session-host.ts`: `prompt`
- `apps/desktop/src/bun/sdk-send-receipts.ts`: `send`
- SDK `dist/core/agent-session.js`: `prompt` / `_prepareRun` / `_startRun` / `_emitAgentSettled`
- `apps/desktop/src/mainview/Composer.tsx`, `ComposerSubmit.tsx`

受付確定前に待つ処理：

1. 前の実行の`agent_settled`フック（SDKは拡張フック完了後にpublicイベントを通知し、pigはそれを待つ）。
2. 拡張の`input`ハンドラー。実行中へのfollow-upもこれを通る。
3. idle送信時の認証確認、必要なら自動compaction、`before_agent_start`、画像正規化。
4. 拡張slash commandの場合は`command.handler`の完了。UIでの回答を待つコマンドも含む。

`preflightResult("started")`はこれらの後に呼ばれる。SDKの汎用hook実行はhandlerをawaitし、pig側に各段階の受付期限はない。通常のモデル回答待ちとは別だが、compactionではモデル通信が発生し得る。

frontendはこの間ずっと`submitting=true`。`ComposerSubmit`は送信ボタンをdisabledにし、Stopへの切り替えも禁止する。backendには`abort`があり、既存テストでも受付前キャンセルを扱うが、**送信ボタンからは中断できない**。

改善：受付・準備・実行・受付不明を分ける。準備中も下書きを編集でき、明示的な中断手段を残す。hostの受信通知を追加する場合もSDK受付とは区別し、SDK受付前に下書きを無条件で消さない。単に受付フックを前倒しすると、認証失敗・拡張処理失敗を受理済みと誤認する。

## 3. P1：送信直前の下書き同期が、入力を続けると終わらない

対象：

- `apps/desktop/src/mainview/draft-store.ts`: `flush`
- `apps/desktop/src/mainview/send-controller.ts`: `send`
- `apps/desktop/src/mainview/Composer.tsx`: background mirror / editor

`flush`は「送信クリック時の版」ではなく「dirtyがなくなるまで」をwhileループで同期する。ACK待ち中に編集すると、その新しい版も同期してから送信する。送信中もeditorは編集可能なので、遅い通信で次の文章を入力し続けるとpromptの発行が延び続ける。

**再現**：各ACKに20msの遅延を入れ、その間に3回編集した。約86ms後に初めてpromptを発行し、payloadにはクリック後の編集も混ざった。編集が続けば同期ループにも固定の終了条件はない。送信受付後に下書きが変わった場合の保護とは別の問題。

改善：クリック時の送信内容を固定し、その版の同期と以後の下書きを分ける。拡張がeditorを変更した場合のCAS競合検出は維持する。単に同期を省略する修正はしない。

## 4. P1：各ストリーム更新が、履歴再送・二重配送・ディスク保存を引き起こす

対象：

- `apps/desktop/src/bun/session-host.ts`: `subscribe` → `publish` → `snapshot`
- `apps/desktop/src/bun/index.ts`: `configureSessionHost`のruntime sink
- `apps/desktop/src/bun/desktop-state.ts`: `clearCompletion` / `update`
- `apps/desktop/src/bun/sdk-projector.ts`: `snapshot` / `historyPage` / `commitLive`
- `apps/desktop/src/mainview/runtime-events.ts`, `App.tsx`

全SDKイベントでSnapshotを作り、`runtimeEvent`で送る。`index.ts`は同じtranscriptを`sessionEvent`でも送る。frontendでseqによる重複適用は避けても、シリアライズ・配送・parseの重複は残る。

さらに`transcript.running`がtrueの**各Snapshot**で`desktopState.clearCompletion`を呼ぶ。completionがすでにない場合も、全状態JSONの一時ファイル書込・rename・desktopState通知を行う。非同期処理なのでpromptを直接awaitさせるわけではないが、実行中の共通ホストとWebViewに余計な仕事を積む。

ページングにも留意：`historyPage`は50entryの地点からuserまで戻り、応答単位を分割しない。したがって長い1回のツール作業は数百entryでも1ページになる。`commitLive`の照合もページ外を含むbranchを投影し、Snapshotはmodel/context usage等も更新する。frontendは受信した状態でstoreを更新し、`App`はstore全体を購読する。

改善順：

1. completion消去を状態遷移時のみ／実際に消すものがある場合のみにする。
2. 同じtranscriptの配送経路を一本化。復旧照会とseqの単調性は維持。
3. text delta等の表示用Snapshotをまとめ、最新状態を送る。raw SDKイベントの意味的な順序は落とさない。
4. それでも支配的なら差分配送・巨大tool結果の遅延取得を検討する。50entryを機械的に切ってtool call/resultの対応を壊さない。

## 5. 初回open：履歴先出し後もruntime準備は重い

`SessionHost.open`はpreview後にTrust、session専用model runtime、`loadExclusive`でのresource reload、拡張のロード、`bindExtensions`での`session_start` / `resources_discover`、adapter準備を待つ。

previewは読めても`ready:false`なので送信できない。`OpeningComposer`では既存チャットのeditorもreadOnlyになる。新規チャットは入力可能だが送信はdisabled。`openSnapshot`の前段には未接続なら`connectRuntime`の待ちもある。

現在は少なくとも履歴とruntimeを分ける基礎がある。次はこの経路の段階別時間を取り、どのhook・resource reloadが遅いかを絞るべき。安全性の根拠を調べずに`loadExclusive`を削除したり、全拡張runtimeを共有したりするのは避ける。

## 実行した検証

### 関連テスト

```text
mise exec -- bun test apps/desktop/src/mainview/send-controller.test.ts apps/desktop/src/bun/sdk-send-receipts.test.ts apps/desktop/src/bun/session-host.test.ts
19 pass / 0 fail（約5.74秒）
```

既存テストは受付前の遅延・中断、settled待ち、回答完了前のfollow-upを扱う。未解決RPC中の早期照会や、入力し続けた場合の送信待ち時間の上限を保証してはいない。

### 隔離したSDK実験

一時HOME/USERPROFILE、faux provider、PI_OFFLINE=1、試験用拡張だけを使用。実ユーザーのセッションや認証設定を変更せず、LLMサービスに送信していない。Bun 1.4.2。各hookの遅延は人為的に150ms。

| 条件 | 結果 |
|---|---:|
| 初回openのpreview通知 | 13.4ms |
| 同openのruntime ready | 989.1ms |
| 通常送信のSDK受付 | 7.7ms |
| inputに150ms待ち | 154.9ms |
| before_agent_startに150ms待ち | 153.1ms |
| 前のagent_settledに150ms待ち | 155.1ms |

これらは「hook待ちがそのまま受付待ちになる」ことの再現。実ユーザーの拡張が何秒使うかの実測ではない。readyの約989msも内訳を計測していないため、150msのhookだけに帰属させない。

### 負荷経路の小規模再現

- completionのない状態で`clearCompletion`を100回：**100回の保存・通知**、約140.1ms。実際の一時ファイルを使用し、後で削除。
- syntheticな301entryの単一応答（8KiB tool結果×300）：50entry目安でも301entryが返り、transcriptは約5.01MB。投影と二重JSON.stringifyを100回で約560.1ms、累計約1.00GBをシリアライズ。実会話ではなく投影・シリアライズだけの試験で、実転送・WebView parse・描画時間は含まない。
- source=lspの診断は3ファイルとも時間内に完了せず。診断0件をcleanの証拠にはしていない。

再現用スクリプトは `%TEMP%/pig-chat-latency-probe.ts` と `%TEMP%/pig-chat-hook-probe.ts` に保存。ローカル絶対パスを使う調査用であり、製品への追加ではない。

## 次に直す順序

1. 受付確認の10分待ちをなくす。ただし自動再送はしない。
2. 準備中の中断手段と状態表示、クリック時の送信内容固定。
3. 各更新の不要な状態保存とtranscript二重配送を止める。
4. openId / requestIdにひもづく段階別計測で、実環境のhook・初期化・描画の寄与を測る。

## 限界

実アプリのクリック→描画のトレース、実ユーザー拡張のhook別プロファイル、実際に遅くなった操作の再現は未実施。開発ログには段階別時間がなく、ホスト再起動・SDK staging失敗・port競合の記録もあったが、今回の症状と同じ操作・時刻かは未確定。したがって特定の拡張やLLMサービスを主因と断定しない。
