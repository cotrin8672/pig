# Provider使用量の実装

調査資料: [取得経路と制約](provider-usage-implementation-study.md)。
この文書は現在の初期実装について記載する。APIの権限・契約・地域差は実接続で検証が必要で、サンプルの成功を全アカウント対応とみなさない。

## 境界

```text
SDK / account store ── usage/host.ts（アカウント固定の列挙・認証解決）
                         │
                  authenticated.ts（所有権検査・401の1回だけの更新）
                         │
       adapters/*（Providerごとの取得・正規化） ── http.ts（上限・timeout・redirect禁止）
       cli.ts（固定の読取コマンド・parse）      ── process.ts（隔離cwd・終了・出力上限）
                         │
                  service.ts（single-flight・TTL・backoff・cache）
                         │ safe DTO only
               RPC ── store ── ProviderUsageView
```

- `shared/provider-usage.ts`: 秘密を含まないIPC型、容量と時間のprojection、短い日時形式。
- `usage/host.ts` 以外の取得基盤はSDKやElectrobunをimportしない。
- CLIのアカウントはpigの選択アカウントと同一と仮定しない。Meta/Qwenは独立行とし、Anthropicはpigのアカウントだけを表示する（Claude CLIは列挙・起動しない）。
- `observation.ts`: 通常応答のヘッダー補完。会話のリクエストを監視のために待たせず、callback失敗も伝播させない。
- HTTPとCLIのadapterはwindow / balance / detailsだけを返す。カード・通知・設定やpollingを操作しない。
- unsupportedなProviderは列挙しない。対応済みProviderの取得失敗は安全な固定コードで表示し、生body/stderrをUIへ渡さない。

## HTTPの初期対象

- Codex OAuth（WHAM）、Claude OAuth、Mistral Vibe Billing。
- DeepSeek、Moonshot国際/CN、Vercel Gateway、OpenRouterのキー予算。
- MiniMax国際/CN（契約枠またはAPI残高）、Z.ai/中国版。
- OpenCode Go（同一origin内の新旧経路）、Kimi Coding hosted endpoint。
- Copilot public GitHub（GitHub OAuth tokenを使い、推論tokenと区別。Enterpriseは初期対象外）。
- Radius（contextでorgを取得し、その利用可能残高を読む。予算window表示は今後追加）。

ユーザー指定で保留したxAI/Grok、Google/Vertex/AWS/Azure、MiMo、OpenCode Zen残高、Hugging Face wallet、OpenAI API、NVIDIA/Ant Ling/Cerebras/TypeSafeは含めない。

注意:

- HTTP adapterの存在は実キーでの疎通済みを意味しない。既存のキーで有効なaccountだけを対象に実接続確認する。
- Mistralに期間長が返らない場合、時間の外周はunknownのまま。resetだけから「30日」を作らない。
- MiniMaxは公式CLIのcount解釈に従うが、追加schemaは実fixtureで増やす。
- Kimi hosted経路やGoの移行は互換性保守が必要。
- Codex/Claudeの直接HTTPは公式クライアント等で使われる経路だが、汎用公開RESTの保証とは別。Claude認証ポリシーの未解決点は調査資料に残す。

## CLIの初期実装

PATHに `muse` / `bl` があれば自動で別sourceを列挙する。

- Claude CLIの自動取得は行わない。AnthropicのHTTP取得と通常応答ヘッダーの補完だけを使う。
- Meta: `muse usage --json`。
- Qwen: `bl usage token-plan --output json`。CLIのactive profileを使うので、4種類のpig Providerへ同じ値を複製しない。
- `windows` の明示的な使用率やMuseの `subs_usage` 等、認識できるschemaだけparse。未知形式は0でなくerror。
- ClaudeのPTY/ConPTY fallbackは**未実装**。対話TUIしか出さないCLI版は非対応として扱う。
- 実際のインストール済みCLIを起動した統合検証はまだ行っていない。JSON出力のschema差・認証なし・旧版のflagsは次の検証点。
- 15秒timeout、256KiBの合計出力上限、stdinなし、専用一時cwd、所有process treeの終了、後始末を共通化する。
- Windows `.cmd`/`.bat` は検証済みの固定argvだけを引用して起動。JSON settingsは一時ファイルにしてshellへ埋め込まない。危険な特殊文字を含むshimパスは実行しない。

## 更新と表示

- アプリ単位で1つの `UsageService`。表示中は30秒ごとに対象を再確認。
- 通常HTTPは2分、CLIは5分の取得TTL。最大3並列、手動更新にも最小間隔を適用。
- 429ではRetry-Afterと最低cooldownを守る。手動更新やpause/resumeでbackoffを無効にしない。
- 認証/権限エラーは資格情報の変更か明示更新まで再照会しない。
- ログアウト・削除・再ログインで該当sourceを無効化。実行中の取得が別accountの値を復活させないよう、取得前後に所有revisionを確認する。
- OAuth更新は既存SDKのロック付き保存に委ね、独自refresh tokenの保存を増やさない。
- 既知のHTTP origin以外の資格情報を公式課金APIへ転送しない。拡張ProviderとEnterprise Copilotは黙ってpublic endpointへ流さない。
- cacheはメモリ内のみ。トークンやraw応答を新たに永続化しない。
- 一覧は表示名順。見出しは使用量と更新ボタンだけで、表示モード名や更新経過タイマー・折り畳み時の要約は表示しない。更新中と更新後10秒間はボタンを無効にする。
- 18px二重リングは内周=容量、外周=リセットまでの残り時間。unknownの外周はtrackのみ。
- 表示設定 `usageDisplay` は `remaining` が既定で、`used` への変更をsettings.jsonへ保存。
- 金額しかないProviderは金額を表示。%の分母を作らない。最終観測の時刻を保持し、失敗／古い値は行とtooltipで区別。

## adapter追加時

1. `UsageData` に既存単位で正規化するparserを追加。
2. `adapters/index.ts` にorigin・認証種別・endpointを登録。会話モデルの選択や認証を書き換えない。
3. fixtureで0/null/超過/複数window/秒とms/契約差/不正schemaをテスト。
4. 実accountで確認する場合は対象を限定し、課金・推論・券消費を行わない。
5. 追加のCLIは `usageCommands` に固定argvとparserを登録。shell文字列や任意ユーザーコマンドは受け付けない。

テスト:

```text
mise exec -- bun test apps/desktop/src/bun/usage apps/desktop/src/shared/provider-usage.test.ts
mise exec -- pnpm typecheck
mise exec -- pnpm lint:ui
mise exec -- pnpm test:ui
```

Storybook: `Providers / Usage Meter / Implemented / 18px sidebar dock` は本番と同じviewでプレビューする。
