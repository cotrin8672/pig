> **SUPERSEDED / 失効（2026-11-09）**: ユーザー承認により実行基盤を Pi Coding Agent SDK 1.5.0 へ一本化し、通常アプリの pi-durable 依存をすべて撤去する方針に置き換えた。現行の実装指示・Gate・共有契約は [Pi SDK return implementation plan](../plan/pi-sdk-return-implementation.md) を参照。本書の以下の内容は歴史的記録として保持するものであり、旧 Acceptance criteria を新規作業へ適用しない。

# Goal

`apps/desktop`のAgent実行基盤を`@earendil-works/pi-coding-agent` SDKから`@earendil-works/pi-durable@1.5.0`へ置き換える。既存のチャットUI（新規チャット・送信・ストリーミング表示・停止・会話一覧・履歴表示・Fork・モデル選択・ログイン）は、Durableを使って動作するようにする。Runtimeの切替機構や旧SDKとの二重運用は残さない。

調査と実装はサブエージェント（`openai/gpt-6.1-sol`）に委託する。シェルコマンドはすべて`rtk`経由で実行する（例：`rtk mise exec -- pnpm test`）。

# Acceptance criteria

1. `apps/desktop/package.json`の`dependencies`に`@earendil-works/pi-durable`が`1.5.0`固定で含まれる。また、`@earendil-works/pi-coding-agent`と`@earendil-works/pi-tui`が含まれない。
2. `apps/desktop/src`配下で`@earendil-works/pi-coding-agent`と`@earendil-works/pi-tui`を参照するimportが0件である（grepで確認）。
3. 次の3コマンドがすべて成功する。
   - `rtk mise exec -- pnpm typecheck`
   - `rtk mise exec -- pnpm lint`
   - `rtk mise exec -- pnpm test`
4. フロントエンドのビルドが成功する：`apps/desktop`で`rtk mise exec -- pnpm exec vite build`を実行する。
5. Durableを使うBun側サービスの自動テストがあり、実APIキーを使わないモックまたはテスト用Providerで次を検証して成功する。
   - Conversationを作成し、送信したアシスタント応答をWatch経由で受け取れる。
   - 実行中の応答をAbortできる。
   - Conversationを一覧取得できる。
   - Harnessを閉じて同じStorageで再起動した後も、会話と履歴が復元される。
   - 同じ`requestId`で再送しても、入力が二重に登録されない。
   - 受理前に失敗した送信がエラーとして返り、成功として扱われない。
   - 指定したEntryからForkでき、元の会話の履歴が変わらない。
6. 既存のチャット用RPCハンドラー（`apps/desktop/src/bun/index.ts`と`shared/rpc-schema.ts`）がDurableサービスへ接続されている。RPC型に`AgentSession`などpi-coding-agentの型が残っていない。
7. Durable Storageの保存先がPiris専用のディレクトリ（`~/.config/pig/durable/`配下）である。テストでは一時HOMEを使い、`~/.pi/agent`配下へ書き込みがないことを確認する。
8. pi-coding-agent専用で、Durableに相当機能がないものは撤去されている。
   - 旧Marketplace / Package検索・インストール
   - `ctx.ui.custom()` / TUI Host
   - Pi `ExtensionUIContext`
   これらの撤去に伴い、UI上の入口（Marketplaceタブなど）も削除または無効表示にしており、押しても旧機能を呼ばない。

# Boundaries

- `~/.pi/agent`、旧Session JSONL、`auth.json`などの既存ユーザーデータを削除・上書き・移動しない。
- 旧SDKを残すフラグ、互換Adapter、Runtime切替を作らない。
- 範囲外とする機能：旧会話のDurableへのインポート、SSH/Remote実行、npm/Gitによる外部Extension配布、新Marketplace、MCP、Subagent、Schedule、RTK Extension、永続Permission/Askの新設。
- 現行コードに存在しない承認機能を新たに約束しない。ただし、現在より危険な既定動作（無確認で新しい権限を与えるなど）にもしない。
- 実Providerの認証情報を使ったE2E送信は自動検証の対象外とする。実施できない場合は、未検証として報告する。
- git commit / pushは行わない。変更は作業ツリーに残す。
- `pnpm build`（electrobunによるネイティブパッケージング）が環境要因で失敗した場合は、ゴール未達ではなく報告事項として扱う。