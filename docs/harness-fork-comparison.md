# 会話分岐と元セッションの停止：ハーネス比較

2026-11-13に公開リポジトリのHEADを解決し、固定commitの実装と関連テストを確認した。アプリを起動しての挙動比較ではない。製品コードは変更していない。

## 結論

**会話の分岐自体に元セッションの停止は必須ではない。** 公開実装には次の2方式がある。

1. **置き換え式**：現在の実行環境を終了し、分岐先に置き換える。Pi標準TUI/RPC、pi-clientが使う方式。
2. **独立作成式**：選択した地点までの履歴から別セッション・別実行環境を作る。pi-gui、OpenCode、Codex app-serverが使う方式。

pigの「完了した応答から別会話を作る」操作には、同じPi SDKを使う**pi-guiの独立作成式**が最も直接的な参考になる。停止待ちの期限を延ばすことと、分岐を停止から独立させることは別の修正。

## 対象と版

| 対象 | 固定commit | commit日時（UTC） |
|---|---|---|
| Pi | `275dde410065080d291de45fbe2110272d10de23` | 2026-11-13 04:53 |
| Hu-Wentao/pi-client | `ba2796568b86a3f224858f09e57bda75d4411cc6` | 2026-09-06 11:00 |
| minghinmatthewlam/pi-gui | `faf8edd6d7a7e3bf3c508d6f600a22d3821ac108` | 2026-10-28 15:49 |
| anomalyco/opencode | `fb1142944671765854e7d4b29672c15008b12892` | 2026-11-13 05:02 |
| openai/codex | `16280e19b1f7ff05aae75177072cd3e2c8b65efd` | 2026-11-13 05:16 |
| manuelcecchetto/pi-gna（補足） | `5557d28251d4e0f0b6016d8d74d13694ec649cbc` | 2026-10-31 06:03 |

pi-clientはarchive済みの公開版。依存Pi SDKは0.84.3で、pigの1.5.2とは版が異なる。非公開後継版の挙動は判断していない。PiについてはローカルのSDK 1.5.2の実装・公式SDKドキュメントも照合した。

## 比較の要点

| 対象 | 元が実行中の場合 | 分岐の作り方 |
|---|---|---|
| Pi標準TUI/RPC | fork内部で停止・終了を待つ | `AgentSessionRuntime.fork()`で現在のセッションを置き換える |
| pi-client | UI・domain service・SDK adapterで拒否し、idleを要求 | idleになってから`runtime.fork()`、registryのIDを分岐先へ変更 |
| pi-gui | 読んだ分岐経路には元のabort/idle要求がない | 別の`SessionManager`で履歴を切り出し、新runtimeを追加 |
| OpenCode | 元をinterruptせず、未完了の履歴をコピー対象から外す | durableなfork eventをprojectして別sessionを作る |
| Codex app-server | 元のturnをinterruptせず、永続履歴からsnapshot | 別threadを起動。完了turnの指定と途中snapshotを区別 |

「元の実行を止めない」は「ディスクI/O・ロック・初期化を一切待たない」ではない。

## 1. Pi標準TUI/RPC：1つの実行環境を切り替える

- TUIの`/fork`はユーザーメッセージを選び、`runtimeHost.fork(entryId)`を呼ぶ。`/clone`も同じfork APIを使う。
- RPCの`fork`/`clone`も同じruntime APIに到達する。
- runtimeの`fork()`は分岐用managerを用意し、`teardownCurrent("fork", ...)`の後に新セッションを適用する。
- `teardownCurrent()`は`session.abort()`をawaitし、`session_shutdown`を通知し、旧sessionをdisposeする。

このAPIの目的は「現在のセッションの置き換え」。元の実行を残したまま別セッションを追加するAPIではない。pigの固定2秒の`stopBudget`は、このSDKのfork仕様そのものではなくアプリ側の制限。

根拠：

- [TUIのfork/clone](https://github.com/earendil-works/pi/blob/275dde410065080d291de45fbe2110272d10de23/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L5692-L5752)
- [RPCのfork/clone](https://github.com/earendil-works/pi/blob/275dde410065080d291de45fbe2110272d10de23/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L632-L650)
- [runtimeのteardown](https://github.com/earendil-works/pi/blob/275dde410065080d291de45fbe2110272d10de23/packages/coding-agent/src/core/agent-session-runtime.ts#L167-L179)
- [runtimeのfork](https://github.com/earendil-works/pi/blob/275dde410065080d291de45fbe2110272d10de23/packages/coding-agent/src/core/agent-session-runtime.ts#L262-L349)

## 2. pi-client：自動停止ではなく「idleになるまで分岐不可」

- frontendのtree操作は`selected.isRunning || state.sending || state.stopping`なら「idleを待つ」エラーで終了。
- domain serviceもactive command/runningを検査して拒否。
- SDK adapterの共通mutation処理も`isRunning`を検査して拒否する。
- 通過後に`runtime.fork()`を呼び、以前のsession IDが新しいIDに置き換わったことを検証する。serviceはregistry entryを新IDに付け替える。

**実行中の元会話を残して分岐する参考例ではない。** pigと異なるのは、実行中に強制停止を試みる前に分岐を拒否すること。

根拠：

- [frontendのbusy判定](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/lib/app/workspace/workspace.vm.dart#L1209-L1219)
- [fork/cloneと共通mutation guard](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-sdk-domain-session.ts#L749-L881)
- [domain serviceのguardとregistry付け替え](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/src/pi-node-domain-service.ts#L750-L852)
- [依存SDKの版](https://github.com/Hu-Wentao/pi-client/blob/ba2796568b86a3f224858f09e57bda75d4411cc6/node/package.json#L50-L65)

## 3. pi-gui：Pi SDKのstorage APIで独立セッションを作る

UIの分岐経路は`runtime.fork()`を使わない。

```text
元セッションの選択entry・分岐地点を解決
  → SessionManager.open(sourceFile)で別managerを作る
  → createBranchedSession(targetLeafId)で分岐ファイルを作る
  → createAgentSessionRuntimeImpl(...)で新runtimeを作る
  → recordsに新セッションを追加
  → 表示先を新セッションへ変更
```

- 元のrecord/runtimeを停止・dispose・置き換えしていない。
- assistant応答の後から分岐するときは、直後のtool resultも含め、次のassistant/userメッセージの直前までを対象にする。
- 新セッションの設定を切り出した履歴から導出する。別workspaceへの分岐もあるが、pigの修正に必須の機能ではない。
- E2Eには「2番目のassistant応答から分岐」「新ID・新sidebar行」「入力欄は空」「3番目の質問は含まない」の検査がある。ただしこのテストは、元で実際に長時間ツールを実行する試験ではない。
- 拡張に公開するruntime操作には別途`runtime.fork()`を呼ぶ経路もある。**UIの分岐と拡張のセッション置き換えを混同しない。**

根拠：

- [履歴の切り出し・新runtime作成](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/packages/pi-sdk-driver/src/session-supervisor.ts#L804-L971)
- [アプリからの呼び出しと選択切り替え](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/electron/workspace/app-store-worktree.ts#L222-L307)
- [応答から分岐するE2E](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/apps/desktop/tests/core/fork-from-message.spec.ts#L14-L84)
- [拡張用のruntime置き換え経路](https://github.com/minghinmatthewlam/pi-gui/blob/faf8edd6d7a7e3bf3c508d6f600a22d3821ac108/packages/pi-sdk-driver/src/session-supervisor.ts#L2157-L2164)

## 4. OpenCode：完了済み履歴だけをコピーする

- `Session.fork`は選択messageの境界を決め、新session IDで`SessionEvent.Forked`をpublishする。元へのinterrupt/awaitIdleは呼ばない。
- projectorが新session行を作り、境界までの履歴をコピーする。未完了assistant、running shell、running compactionを除外する。
- テストでは、元にrunning tool/shellが残ったまま、分岐先にはそれらの途中状態がないことを検査する。
- frontendもfork API→分岐先へnavigateで、元会話の停止要求は挟まない。
- frontendには分岐要求の30秒timeoutがあるが、これはHTTP要求とUI待ちの管理。元のモデル・ツールの停止期限ではない。
- Web UIの操作はユーザープロンプトの「前」で切り、入力欄にそのプロンプトを復元する。pigの「assistant応答を含めて切る」と境界の意味は異なる。

根拠：

- [Session.fork](https://github.com/anomalyco/opencode/blob/fb1142944671765854e7d4b29672c15008b12892/packages/core/src/session.ts#L341-L394)
- [完了済み履歴に限定するprojector](https://github.com/anomalyco/opencode/blob/fb1142944671765854e7d4b29672c15008b12892/packages/core/src/session/projector.ts#L121-L216)
- [running assistant/shellをコピーしないテスト](https://github.com/anomalyco/opencode/blob/fb1142944671765854e7d4b29672c15008b12892/packages/core/test/session-create.test.ts#L807-L897)
- [frontendのforkとnavigate](https://github.com/anomalyco/opencode/blob/fb1142944671765854e7d4b29672c15008b12892/packages/app/src/session/fork.ts#L65-L105)
- [要求timeout](https://github.com/anomalyco/opencode/blob/fb1142944671765854e7d4b29672c15008b12892/packages/app/src/session/fork-machine.ts#L4)

## 5. Codex app-server：永続snapshotから別threadを起動

- `thread/fork`はsourceの永続履歴を読み、`fork_thread_from_history`または`fork_prepared_thread`で別threadを起動する。読んだ通常fork経路に元のturnへのinterruptはない。
- `lastTurnId`で指定した完了turnまでを含められる。実行中turnを`lastTurnId`に指定すると拒否する。
- paginated storageはsourceの永続化、writer/lifecycleのロック、参照する履歴の位置固定を行う。元の推論・ツールの完了を待つこととは別。
- 最新履歴が途中なら、`ForkSnapshot::Interrupted`で**分岐先の履歴に**中断の印を補う。この名前は「元threadにinterruptを送る」という意味ではない。
- テストでは、分岐後にsourceへ追記した内容が分岐先へ流入しないことを検査する。実行中のモデルを使った負荷試験を今回行ったわけではない。

根拠：

- [app-serverの履歴準備](https://github.com/openai/codex/blob/16280e19b1f7ff05aae75177072cd3e2c8b65efd/codex-rs/app-server/src/request_processors/thread_processor.rs#L5300-L5545)
- [別threadの起動](https://github.com/openai/codex/blob/16280e19b1f7ff05aae75177072cd3e2c8b65efd/codex-rs/app-server/src/request_processors/thread_processor.rs#L5675-L5790)
- [snapshotからのspawn](https://github.com/openai/codex/blob/16280e19b1f7ff05aae75177072cd3e2c8b65efd/codex-rs/core/src/thread_manager.rs#L1843-L1947)
- [永続化・位置固定と完了turnの検査](https://github.com/openai/codex/blob/16280e19b1f7ff05aae75177072cd3e2c8b65efd/codex-rs/thread-store/src/local/paginated_fork.rs#L18-L165)
- [途中snapshotの固定とsourceへの後続追記を扱うテスト](https://github.com/openai/codex/blob/16280e19b1f7ff05aae75177072cd3e2c8b65efd/codex-rs/app-server/tests/suite/v2/thread_fork.rs#L1929-L2124)

## 補足：pi-gna

読んだ`SessionHost.command`はRPC commandをPi subprocessへ転送する。`/new`・`/resume`・forkで同じprocessが別session fileへ切り替わることを前提とした管理もある。ただし今回確認した経路からは、pi-guiのような独立forkを実装したUI操作は確認できなかった。「チャットごとにprocessがある」だけで、分岐も元を停止しないとは判断しない。

- [commandの転送](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L455-L474)
- [fork等によるsession file変更の扱い](https://github.com/manuelcecchetto/pi-gna/blob/5557d28251d4e0f0b6016d8d74d13694ec649cbc/src/main/session-host.ts#L554)

## pigに適用するなら

最小の方向は、**UIの分岐だけを独立作成式にする**こと。通常のStopや拡張のruntime置き換えまで変更する必要はない。

- UIの`forkChat`から元へのabortを外すだけでは不十分。backendの`runtime.fork()`も別sessionの作成へ変更する。
- `createBranchedSession()`は呼び出したmanagerのsession ID/fileも変更する。**実行中の元managerに直接呼ばず、別途openしたmanagerで行う。**
- 完了した選択entryを固定し、必要なtool call/resultの対応を壊さず切り出す。新規追記や新しい画面選択で境界を変えない。
- 分岐先を既存のsession起動経路に載せ、モデル・アカウント選択、trust、拡張初期化、下書き、失敗時の後始末を維持する。
- SDK高レベルforkの`session_before_fork`等は低レベルstorage APIだけでは発火しない。既存拡張への通知・拒否契約をどう維持するかは実装時に確認が必要。
- 元の実行と承認待ちは元のsession IDに残す。分岐先へイベントやキューを移さない。
- 会話履歴の分岐はファイルシステムのsnapshotではない。同じcwdで元と分岐先を走らせればファイル変更は共有される。worktree作成は別機能として扱う。

必要な回帰テスト：元で停止に応じないツールを実行中でも過去の完了応答から分岐できる／元のabort呼び出しは0回／元の後続イベントは元にのみ届く／分岐先の起動失敗で元が壊れない／選択後の履歴が混入しない／拡張の分岐契約を維持する。

未実施：各他製品のビルド・テスト実行・実機操作、非公開クライアントの確認、pigへの実装。公開コードとテストの読解による比較であり、無停止forkの速度や全競合ケースの安全性を実測したものではない。
