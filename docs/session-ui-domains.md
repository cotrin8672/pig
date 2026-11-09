# Extension向けセッションUI基盤

## 目的と境界

pigは **表示に必要な意味構造と操作の接続契約** を持つ。実際のTODO、実行、停止、予定の発火、権限、Goal評価の正本はPi Extensionに残す。

```
Pi SDK / Extension → sources → ユーザーTS Adapter → 表示モデル → React
Pi SDK / Extension ← 正式なコマンド / EventBus ← Adapter ← 操作ID
```

公開契約は `packages/config/src`。Hostは設定・購読・世代・操作中状態を管理し、WebViewに関数やSDKオブジェクトを渡さない。既存のwidget/TUI経路は残す。Adapterが失敗しても通常のチャット・既存UIを失わせない。

## 機能選定

| 採用 | 理由 / 境界 |
| --- | --- |
| TODO / WorkList | 順序付きチェックリスト、所有者、依存関係。実行キューではない |
| Agent / Run | Agent個体・profile・会話・一回の実行を区別。単なる親子ツリーに限定しない |
| Background / Run | 論理タスクID、プロセス識別子、出力、終了結果、寿命を区別 |
| Schedule | 定義、有効状態、観測した次回予定、実行履歴。発火計算・再試行はExtension側 |
| Mode | 複数の独立した軸。workflow / permission / agent profileを一つのenumにしない |
| Goal | 達成条件・理由・計測値。ModeやTODOから達成を推測しない |
| Annotation / Review thread | 対象の版と範囲、引用、議論の解決状態。単純な活動一覧では表現できない |
| Document | 計画・成果物の本文と版、draft/final。チェックリストと別のもの |
| Status | 適切な専用モデルのない状態をテキストで安全に残す |

次のものは別の実行ドメインとして新設しない。

- **承認・質問待ち**: 既存のUIRequestBroker / ExtensionUIを正本にする。文字列や履歴から権限要求を新造しない。注釈を解決してもツールを承認したことにはならない。
- **成果物・ログ・会話への参照**: 共通のResourceRef。任意のURIを自動fetch/openせず、正式なAdapter操作へ接続する。
- **メトリクス・予算**: 単位付き計測や表示用facts。異なる集計範囲のtoken/costをGUIで足し合わせない。
- **MCP・skills・モデル・接続設定**: 今回のセッション活動モデルへ混在させない。
- 独自Marketplace、スケジューラ、プロセス監督、subagent実行エンジン、権限DBは作らない。

## 調査方法・一次資料

4系統に分け、コード・公式型・公式文書を調査した。以下は比較対象の固定revision。ライブ文書はバージョン固定できず、実行互換性を保証しない。

| 対象 | 根拠 |
| --- | --- |
| Pi 1.5.0 | インストール済みSDK。npm provenanceのcommit `f9a26365568127461c47a07a37dcb42c140a3ac5`。subagent sampleはnpm tarball/upstream/installedのSHA256が一致 |
| Codex | `8703d32bd0ea5cf26768859a3dd476df906ba053` |
| OpenCode current | `71f3696424593fb7292df307a9966f19a2b05adf` |
| OpenCode v1.2.27 | `4ee426ba549131c4903a71dfb6259200467aca81`。currentと混同しない |
| OpenClaw | `70e2761fccfc451c6170a197ed00bb02ea54a0f9` |
| Claude Code / SDK | 公式の現行文書。Task/Agent名、run_id、Cronの復元などはバージョン依存 |

### TODO、Mode、Goal

- [Pi todo](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/examples/extensions/todo.ts): `{id:number,text,done}`、clearでIDを再利用。toggleは非冪等。`getBranch()`の最後のtoolResult.detailsから復元。`/todos`は閲覧用。
- [Pi plan-mode](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/examples/extensions/plan-mode/index.ts): `{enabled,todos,executing,toolsBeforePlanMode}`をcustom entryへ保存。`/plan`はtoggleでTODOも消去。復元は**全entry**で、standalone TODOと異なる。
- [Codex plan schema](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/protocol/src/plan_tool.rs)、[handler](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/core/src/tools/handlers/plan.rs): IDなしの全配列置換、pending/in_progress/completed。Plan modeではupdate_plan自体が禁止。proposed planの文書とは別イベント。app-server表記はinProgress。
- [OpenCode todo](https://github.com/anomalyco/opencode/blob/71f3696424593fb7292df307a9966f19a2b05adf/packages/core/src/tool/plugin/todo.ts)、[UI復元](https://github.com/anomalyco/opencode/blob/71f3696424593fb7292df307a9966f19a2b05adf/packages/app/src/session/composer/todos.ts): このrevisionにはID/priorityなし。cancelledあり。revert境界より前の最後の成功した呼び出しを表示。tool入力の途中段階を確定状態としない。
- [Claude SDK types](https://code.claude.com/docs/en/agent-sdk/typescript.md)、[task list](https://code.claude.com/docs/en/interactive-mode.md#task-list)、[teams](https://code.claude.com/docs/en/agent-teams.md): legacy TodoWrite全置換と、TaskCreate/Get/Update/Listを区別。Taskは文字列ID、owner、blocks/blockedBy。blockedは依存に由来する着手可否。CLAUDE_CODE_TASK_LIST_IDでセッションをまたいで共有できる。TaskUpdateの依存追加はsetではない。
- [Claude Goal](https://code.claude.com/docs/en/goal.md): Goalはpermission modeを変更しない。resume時に計測の基準がリセットされ得る。Goal継続ループはGUIの責務ではない。
- [Codex Goal](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/state/src/model/thread_goal.rs)、[Goal API](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/ext/goal/src/api.rs): active/paused/blocked/usage_limited/budget_limited/complete。内部goal_idは公開APIで常に取得できるとは限らない。

**設計への反映:** bool doneだけに潰さない、安定IDを捏造しない、native/snapshot identityを区別、依存と表示順序を分離、共有scopeを許容、modeとgoalとdocumentを分離。公開されていない操作は表示しない。

### Subagent

- [Pi sample](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/examples/extensions/subagent/index.ts): subprocessは`--no-session`。single/parallel/chainで一つのtool callが複数結果を持つ。chainは前結果を受ける逐次実行で、親子Agentではない。parallel全体が成功扱いでも子は失敗し得る。exitCode=-1には未起動の待機slotも含まれる。
- [Codex agent types](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/core/src/agent/types.rs)、[agent API](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/core/src/agent/api.rs): thread identityとturn/submission/tool invocationを区別。completedでもAgentは開いている。unloadedはcompletedではない。message acceptedはreadとは違う。v1 waitは終端状態、v2 waitはmailbox活動を待つ。
- [Claude subagents](https://code.claude.com/docs/en/sub-agents.md)、[SDK](https://code.claude.com/docs/en/agent-sdk/subagents.md): 現行SDKではtask_id維持でresume時にrun_id更新。Agentツールを新たに呼ばずSendMessageで再開する場合もある。human stopとmodel stopの再開方針が異なる。Teamsの共有作業はAgent実行状態とは別。
- [OpenCode v1 task](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/tool/task.ts)、[current subagent](https://github.com/anomalyco/opencode/blob/71f3696424593fb7292df307a9966f19a2b05adf/packages/core/src/tool/plugin/subagent.ts)、[session schema](https://github.com/anomalyco/opencode/blob/71f3696424593fb7292df307a9966f19a2b05adf/packages/schema/src/session.ts): task_idという名前が子session IDを指す版がある。currentではsessionを維持しprofile変更可能。現在busyと前回execution outcomeは別々に保持する。

**設計への反映:** run ID、agentId、profile、session参照を分離。parentとdependsOn/relationsを分離。phaseとoutcomeを分離。native labelとpartial outputを残し、履歴から現在の稼働を断定しない。

### BackgroundとSchedule

- Pi builtin bashはforegroundで、timeout単位は秒。永続job registryではない。
- [pi-background-jobs](https://github.com/onlyjq04/pi-background-jobs/tree/5358cfe6758d07232cd258f174c5d5bc39f91e4d): taskId/pid/pgid/logPathが別。timeoutはミリ秒で自動background化あり。stoppedはkill完了前に設定される。
- [pi-background-task](https://github.com/ZKiteLM/pi-background-task/tree/c67ac177edc6bef82ee2d73e9392279c2bdae15d): tmux、POSIX/WSL向け。taskId/ownerInstanceId/piSessionId、byte cursor、log/screenを区別。wait timeoutや現在EOFはプロセス終了ではない。
- [Codex unified exec](https://github.com/openai/codex/blob/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/core/src/unified_exec/process_manager.rs): terminal session_idは会話IDでもPIDでもない。pollは出力をdrainしchunk IDはcursorではない。yield timeoutと実行timeoutは違う。restart復旧は前提にしない。
- [Claude background](https://code.claude.com/docs/en/interactive-mode.md)、[tools](https://code.claude.com/docs/en/tools-reference.md): TODOとbackground taskは別。現行版ではTaskOutput削除・Read出力ファイルの経路あり。所有Agentやattended/unattended実行によって寿命が異なる。
- [pi-schedule-prompt](https://github.com/tintinweb/pi-schedule-prompt/tree/5556775276202c26654ff9323541fe6983f6ee38): 保存定義とsession timer。inline successは**prompt dispatch**成功でAgent実行完了ではない。6-field cron、intervalの次回値が必ず取れるわけではない。無効化は進行中runの停止ではない。
- [Claude CLI schedule](https://code.claude.com/docs/en/scheduled-tasks.md): local timezone、5-field cron、between-turn dispatch、jitter、busy時coalesce、現行版ではresume復元あり。ただし古いBashプロセスは復元しない。
- [Claude Desktop schedule](https://code.claude.com/docs/en/desktop-scheduled-tasks.md): Host起動が必要、runごとに新session、wake時に直近のmissed fireを回収。CLIのoffline skipとは違う。
- [Claude cloud tasks](https://code.claude.com/docs/en/routines.md): 複数trigger、scheduleなしも有効、UTC/CRON_TZ。成功runをarchiveするとCancelled表示になる場合があり、killの証拠にしてはいけない。
- [OpenClaw cron schema](https://github.com/openclaw/openclaw/blob/70e2761fccfc451c6170a197ed00bb02ea54a0f9/packages/gateway-protocol/src/schema/cron.ts)、[実行と復元](https://github.com/openclaw/openclaw/blob/70e2761fccfc451c6170a197ed00bb02ea54a0f9/docs/automation/cron-jobs/how-it-works.md): SQLite定義・状態・履歴。at/every/cronに加えon-exit/stream/event。occurrence、fallback attempt、admission retry、deliveryは異なる。cancel応答後もsettlingがあり、definition削除は物理停止の証拠にならない。

**設計への反映:** schedule enabledとrun stateを分離。次回時刻は観測値だけ。未知のtrigger/policyはopaque表現を許す。出力はbounded snapshotとして転送し、cursor/replay保証を捏造しない。詳細なログ取得・操作はAdapter capability。成功の対象がdispatch/実行/履歴で異なる場合はラベル・factsへ明記する。

### Annotation、承認、Resource

- [W3C Web Annotation](https://www.w3.org/TR/annotation-model/): stable resource/state、TextQuoteSelectorのexact/prefix/suffix、TextPositionSelectorの0-based half-open Unicode code points。DOM座標は永続anchorにしない。標準は再anchorの正しさや議論の解決状態までは提供しない。
- [Codex protocol](https://github.com/openai/codex/tree/8703d32bd0ea5cf26768859a3dd476df906ba053/codex-rs/app-server-protocol): review findings/approval要求は別系統。UIにコメント機能があっても公開の永続annotation-thread APIがある証拠にはならない。
- [OpenCode v1 permission](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/permission/next.ts): この版のalwaysを永続許可とみなさない。currentの永続rule/formsと混同しない。
- [Claude SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md)、[user input](https://code.claude.com/docs/en/agent-sdk/user-input.md): callbackが実行を待機させるが、既に認可された処理はcallbackを通らない場合がある。GUIで第二の認可判定をしない。
- [MCP resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources): resource identityと取得capability。resourceの存在、会話への添付、版、生成runは同一概念ではない。

**設計への反映:** Annotationのthread stateとanchor resolutionを分離。exactには版が必要。範囲は明示した単位・end-exclusiveで保存し、元の引用を保持。別版の先頭一致へ勝手に移さない。ResourceRefはAdapter/source scope内で解決し、別プロジェクトの同名ファイルへ自動リンクしない。

## 初期公開契約

- `defineConfig({apiVersion:2, runtime, commands, sessionAdapters, keymaps})`。明示ユーザー単位 `~/.config/pig/config.ts` のみ。v1は移行診断付きで拒否し、SDK互換・プロジェクトTS自動実行はしない。
- runtimeはnative Durable `Extension[]`、pi-ai `Provider[]`、明示extensions/tools/modelToolsのprofile。installedとselectedは別で、WorkspaceごとのRegistry/ModelsとHarnessSettingsのselectionをHostが所有する。read-onlyはnested-callを含む実効toolsのallowlistで検査し、指示/modelToolsだけで保証しない。
- `sources.conversation()` はbefore付きwindowとbuiltin docsのみ、`taskGraph()` はWorkspaceのlive graph。custom TODO/Mode/Delegation/Documentはnative tokenの `snapshot/watchDocument` で読む。不在はundefined、retirementを通知し、Task消失を成功と推測しない。終端outcomeはentry/domain docに永続化する。
- `views.set/remove`。既存9 domain/DTOとvalidationを維持。IDはAdapter内tupleで名前空間化し、表示revisionは削除後も再利用しない。
- Adapterのlocal `commands.register` と、namespace付きglobal/conversation Host commandは別契約。`controller.configure/commit` は対象会話・cancellation・Host policyに束縛し、明示操作中だけ利用する。commit内はtxだけで読む。ctx.pi、EventBus、SDK branch/all、slash fallback、Tool.execute直呼びはない。
- Host commandはbounded JSONと明示validator（省略時はinputなし）、enabled理由、scope/streaming/busy/generation、必要なconfirmationを検査する。confirmationは権限承認ではない。`config.reload` とbuiltin IDは予約。
- `scope.signal/onDispose/interval` は購読・表示・操作・timerを解放し、遅いnative watch取得後もcleanupする。runtime Taskのabortではない。WebViewのgeneration+adapterId+viewId+revision+actionId、固定input/fields、consumed revision、二重要求拒否を維持する。状態は観測更新だけで変え、自動再送しない。
- TS再読込はprepare/validateとacceptを分離し、相対import再bundle、source 1MiB/bundle 4MiB、cache cleanup成功後の受理を維持する。構造/native Registry/core peer・version・realpath不整合はlast-goodを保持。Runtime変更はTask/Doc互換性・全live/保留/子/background Task・承認を確認するHost gateがなければ候補全体をpendingにする。JSON比較や存在しないextension.versionは互換証明ではない。
- managed package moduleRoot/resolve hookは明示portで、install成功をload/selectと混同しない。外部package内部のcore重複は入口aliasで解消したことにしない。自動install/discoveryはない。
- 既存AdapterKeymap DTOとHost-command bindingは分離。chat/composer/panel、GUI override > TS > default、IME/既存対話保護を維持する。空Dockからのglobal reload到達性とHost shortcut配線は別途承認対象で、この契約更新に新UIは含めない。

## 初期版の限界

- これは**表示投影モデル**であり、各Harnessの実行DBの完全複製ではない。nativeの追加情報はfacts・description・ResourceRef・能力別操作・Statusに残せる。未知状態を成功やpendingへ勝手に正規化しない。
- Pi以外のHarnessをpigへ直接接続する実装ではない。比較は抽象化を検証するため。native Durable接続例は `examples/session-ui/durable-adapters.ts` にあり、他Extensionとの互換性は個別Adapterで検証する。
- Annotation初期版は版・範囲・引用・thread表示と登録操作。DOM上の自動再anchor、全ファイル/diffへの行内editor、汎用リソースresolverは提供しない。
- ログは上限付きテキストsnapshot。PTY操作、耐久spool、汎用cursor APIは対象Extensionとの契約が必要。
- 信頼されたTS設定は任意のHostコード。sandboxではなく、API外で作ったprocess/timerまで強制回収できない。
- 複数Harnessの実機実行・取消し保証・全バージョン互換性は未検証。一次資料の契約比較とpigの試験を区別する。
