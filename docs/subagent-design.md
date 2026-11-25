# Pig / Pi 共通サブエージェント設計案

**実装:** [`pi-subagent`](https://github.com/cotrin8672/pi-subagent)。以下は設計時の比較・判断記録。実装ではPiの `Agent` と `SessionManager` を組み合わせ、`ctx.modelRegistry.streamSimple` と `ctx.executeTool` で親の認証・権限を通す。PigのドックもPiと同じ読み取り専用 `/agents` を開く。履歴閲覧用に二つ目のランタイムは作らない。

## 決定と範囲

自前の **Pi extension を1個**配布する。Pi CLIでもPigでも、モデルが呼ぶツール、子の実行、親に届く完了メッセージ、保存形式は同じ。Pig専用なのは既存のツール表示・セッションドック・将来の履歴プレビューへの接続だけ。Pigを起動しないと動かないサービスは作らない。

親セッションが生きている間だけ子を動かす。別タブを表示することと親のランタイムを破棄することは区別する。前者では継続し、後者では停止する。Piのセッション切替・reloadで元の拡張が破棄される場合も後者。終了後の**閲覧**に、子のプロセスやモデル接続の維持は必要ない。親終了後の自律実行・別ホストからの引き取り・書き込み可能な別タブは対象外。

## 既存実装から採るもの・採らないもの

| 調査対象 | 採るもの | そのまま移植しない理由 |
|---|---|---|
| [Codex tool spec](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)、[ツールの選択](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs)、[v2 spawn](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs) | 名前付きの子に依頼し、親は独立の作業を続け、必要な時だけ待つ。結果は親へ返る | Codexにも複数世代・機能フラグがある。v1の `close_agent` とv2の `interrupt_agent` を混ぜて「完全互換」とはしない。v2の履歴継承も初版では採らない |
| Pi同梱 `examples/extensions/subagent/` | プロンプト・ツール・モデルを限定して委任する考え方。project-local 定義の信頼境界 | 別Piプロセスで single / parallel / chain を1ツールにまとめる例。欲しいのは独立した子の識別・追送・完了通知であってワークフローDSLではない |
| `@ogulcancelik/pi-codex-subagents` の `core.ts` / `index.ts` / `peek.ts` | 名前での操作、非同期通知、待機との重複回避、実行後に読める履歴 | Windowsで同一PID内の管理インスタンスを増やすだけで、生きている別の子を孤児扱いし終了させる事象を再現。起動時の全実行走査・PID照合・`taskkill` は持ち込まない |
| [nicobailon/pi-subagents の公開API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)、Pigの `connectNicoSubagents` / `connectCodexSubagents` | 接続時に状態を取得し、イベントで更新する方式。ドック再接続前の活動も表示できる | Codex版用の現行Pig adapterには、接続後に見たツールイベントから状態を推測する箇所がある。自作版では正本から取得できるため推測しない |
| Pi SDK `docs/sdk.md`, `docs/extensions.md`、Pigの `session-host.ts`, `model-runtime.ts` | `AgentSession`、セッションごとのリソース制御、標準履歴と通知、休止抑止、親ごとのモデル・アカウント設定 | 裸のSDK初期値では標準ツールや拡張の自動探索が入る。Pigの選択アカウント・独自providerを無視して子だけ既定認証で実行することも避ける |

## 実行方式

第一案は同一プロセス内の**独立したPi SDKセッション**。親の会話に子の道具実行を混ぜず、子ごとに `AgentSession` と永続 `SessionManager` を作る。親の拡張インスタンスが所有する `Map` に、自分が作った子のハンドルだけを保存する。プロセスグローバルな子一覧を操作権限の根拠にしない。SDKの `abort` / `dispose` を使い、別の親が開いた履歴を理由に実行を止めない。子の異常終了をOSレベルで隔離する方式ではないので、初版の子には任意拡張コードをロードしない。

- **継承するもの**：親のcwd、選択モデル・thinking、実際に選択されたprovider/account、信頼・ツール制限の範囲。会話は空で開始し、依頼に必要なパス・前提は `message` に書く。同じcwdなので、将来書き込みを許す場合は同一worktreeへの競合が生じる。
- **既定で渡さないもの**：親の全履歴、MCP、skills、自動探索のextensions、サブエージェントツール、任意のシェル・書き込み。初版は親にも許可されている読み取り系ツールだけ。親の許可フックやファイル制限を再現できない環境は、素のreadに置き換えず拒否する。読み取り専用はOSサンドボックスの意味ではない。
- **並列数**：初期値は親あたり4実行・深さ1の案。4は実測限界ではない。初版にキューは置かず上限時は `capacity` を返す。スロットと名前は最初の `await` より前に予約し、初期化失敗・中断でも必ず解放。複数親合計の負荷は別に測る。
- **ライフサイクル**：`starting → running → completed | failed | interrupted`。completedは1ターンの完了であり履歴削除ではない。`message_end` で最終本文を取り、`agent_settled` とエラー状態で確定する。`agent_end` 単独では自動retryや後続入力が残り得る。親破棄時は新規受付を閉じ、所有中の子だけを中断、待機を解除し、SDKを破棄する。遅着イベントを次の親に送らない。

**実装に入る前の検証点**：Piの公開 `ctx.modelRegistry` とSDK生成に必要な `modelRuntime` は同じ契約ではない。Pigは `createModelRuntime(accounts)` でセッション別の登録・資格情報を構成している。Pi CLIの標準provider、拡張登録provider、Pigの非既定アカウントで、子が意図したproviderに到達すること、子の破棄が親の登録を変更しないことを検証する。必要なら子生成時にホストからモデル解決を渡す小さい接点を作る。資格情報を履歴・ツール引数・IPCに書く方式に逃げない。公開APIで保証できない構成は明示的にunsupportedとする。

## モデル向けツール

| ツール案 | 初版の意味 |
|---|---|
| `spawn_agent({task_name, message})` | 親内で一意な名前を予約。子が依頼を受理したら `agent_id`, `task_name`, `run_id` を返す。完了は待たない |
| `send_message({target, message})` | 実行中なら次の安全なタイミングにsteer。完了済みなら同じ子履歴に次のターンを作り、新しい `run_id` を返す。失敗・中断からの暗黙のリトライはしない |
| `wait_agent({targets?, timeout_ms?})` | 指定した子（省略時はこの親の子）の次の未受領結果を1件返す。待つ対象がなければ即返却。待機の中断・タイムアウトは子を止めない |
| `interrupt_agent({target})` | 指定した子の現行実行だけを中断。完了と競合しても終端結果は1個。終了済みなら現在状態を返す |
| `list_agents({})` | この親の名前・ID・状態・現行/直近run・結果要約を返す。他の親は列挙しない |

`target` はこの親の `agent_id` または名前に限る。`agent_id` は子の寿命に、`run_id` は依頼1回に対応する。`list_agents` は観測であって受領ではない。`wait_all_agents`、role定義ファイル、ネスト、履歴fork、結果全文を何度も注入する専用ツールは、利用例が出るまで追加しない。Codexの全schemaや旧プラグインの引数互換を装わない。

完了イベントは短い最終本文・状態・識別子を持ち、ツールの詳細ログは子に残す。生存中の親では `run_id` ごとに、待機者がいればツール結果へ、いなければ `pi.sendMessage` によるcustom completionへ**片方だけ**渡す。送達済み結果を `wait_agent` が永久に待つことはないよう、対象が全て終端・受領済みならその状態を即返す。親のidle時は完了で再開、実行中は現在のツール実行を破壊しないタイミングに配信。これはライブ配送の契約で、クラッシュをまたぐexactly-onceは主張しない。

## 履歴とpeek

初版から **子1個＝Piの標準セッション履歴1本**。推論のために必要なJSONLをそのまま使い、UI専用の全文ログは作らない。親の永続カスタムエントリに `version, parentSessionId, agentId, childSessionId, taskName, runId, status` を記録し、結果通知やドックにも同じ参照を載せる。親子の関係はPiの会話分岐とは別。モデルから渡された絶対パスは閲覧APIにしない。子履歴はprofile内の専用領域に置き、通常のチャット一覧を汚さない。親が永続化されないモードは子も一時扱い。再起動時に所有者不在の過去実行を「実行中」と表示し続けない。履歴を開いただけでモデル実行・再送・他プロセスの停止は行わない。

- **Pi**：ツール結果・完了通知だけで作業が完結する。後で読み取り専用の `/agents` 一覧から子履歴を閲覧できるようにする。親を子セッションへ切り替える方式は取らない。
- **Pig**：セッション単位のread-only `snapshot` と変更通知をextensionから公開し、`AgentRun.session` に型付き参照を載せる。親のlive workとして `starting` から休止を抑止する。peekは専用参照を所有関係・profile・cwdで検証したうえで `historyOnly` / `SDKProjector` の表示経路を再利用する。現行 `historyOnly` は任意の子ファイルを開けるAPIではない。実行中の追従は後段とし、書きかけのJSONLを破損と判断したり、peekで二つ目のSDK runtimeを起動したりしない。
- **配布**：新パッケージはPiに単独インストール可能にし、Pigでは同じpackageに対するadapterを登録する。現行 `@ogulcancelik/pi-codex-subagents` とはツール名が衝突するので同時有効化をサポートしない。Pigは競合を案内し、無断アンインストールしない。過去ログの既存rendererは残す。

## 実装順・合格条件

1. **縦に1本通す**。Pi CLIとPigで同じextensionをロードし、固定応答providerで `spawn → child read → completion → 親だけに1回通知 → 終了後の履歴読み取り`。非既定アカウント・権限制限もここで確認する。この段階でSDK方式の可否を判定する。
2. **所有と競合を壊しに行く**。同一PIDの親A/B、Aの実行中にBを作成/破棄、同名タスク、上限+1の同時spawn、`wait` と完了の順序反転、中断と完了の競合、親reload、provider失敗をテストする。Aの子と結果がBから操作・受領できないこと。実モデルではWindowsのPig/BunとPi CLIで単独・複数同時実行を比較し、起動待ち・モデル応答・ツール失敗を区別して記録する。
3. **Pigの活動表示と終了後peek**。タブ切替・ドック再接続で一覧が復元され、実行中にidle suspendされないこと。終了後の閲覧が履歴を変更せず、子を通常のチャット・runtimeとして開かず、別親の参照を拒否すること。ライブ追従・子への編集はこの段階の前提にしない。

主なローカル確認先（`apps/desktop/src/` 以下）：`bun/session-host.ts`（生成・休止・historyOnly）、`bun/model-runtime.ts`（アカウント）、`bun/supported-adapters.ts`（両既存拡張）、`bun/session-files.ts`（履歴検証）、`bun/sdk-projector.ts`（表示投影）、`mainview/AgentToolRenderers.tsx`（既存ツール表示）、`shared/supported-extensions.ts`（配布カタログ）。参照型は `packages/config/src/models.ts` の `AgentRun.session`。上記は設計であり、共通extensionや子用history resolverは未実装。
