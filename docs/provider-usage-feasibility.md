# Provider横断の残量・レートリミット画面：実現性調査

調査日: **2026-11-11**  
対象: pigの現在のソースと、インストール済み `@earendil-works/pi-ai` / `pi-coding-agent` **1.5.2**。Web情報は調査時点の公式資料・公式ソースを優先した。

## 結論

**一覧画面は十分に現実的。ただし、全社共通の「あと何回使えるか」を正確に取得することはできない。**

- Codexには、残量率・リセット時刻・リセットチケットを取得する**文書化されたapp-serverインターフェース**がある。
- Mistralには、プランと残りのAPI/Vibe予算を読む**公式MCP**がある。Enterprise Admin APIだけが選択肢ではない。
- DeepSeek、Moonshot、Vercel AI Gatewayなどは、通常のAPIキーで取得できる**公式残高API**があり、最初の対象に向いている。
- OpenAI APIとGoogle AI Studioは、**使用額・クォータを取得できることと、正確なプリペイド残高を取得できることが別**。今回確認した公開仕様では、通常の推論キーだけで残高まで取れる経路を確認できなかった。
- Claudeサブスクは、技術的な取得経路よりも**公開仕様・認証利用ポリシー**が問題になる。
- Cookieスクレイピングを含めれば範囲は広がるが、Windowsを含む配布アプリの初期実装には勧めない。

**推奨は「取得できる事実をそのまま一覧にする画面」。取れない値は非対応／権限不足／未取得と表示し、推定値で埋めない。**

## 1. 調査範囲とアプリ側の現状

### 対象Provider

`pi-ai/providers/all` の `builtinProviders()` を認証情報にアクセスせず列挙し、**43 Provider ID**を確認した。

pigの `apps/desktop/src/bun/model-runtime.ts` は、これに `openai-api` を追加し、`openai` をOAuth専用に変更する。したがって標準構成は**44枠**。

`apps/desktop/src/bun/pi-service.ts` の表示名は次のとおり。

| Provider ID | 表示名／実際の経路 |
|---|---|
| `openai` | OpenAI ChatGPT。Sign in with ChatGPTによるpublic Responses API利用 |
| `openai-codex` | OpenAI Codex。CodexのChatGPTバックエンド利用 |
| `openai-api` | OpenAI API。通常のAPIキー課金 |

**この3つを同じ残高・同じクォータとして統合してはいけない。** 同一メールアドレスでも、認証スコープ・アプリ別上限・課金枠は別問題。

また、models.json・拡張機能で追加されたProviderは任意に増えるため、44枠は「この依存バージョンの標準Provider」の調査範囲であり、ユーザー環境の全カスタム接続を保証する数字ではない。

### 既存の足場

- `apps/desktop/src/mainview/Providers.tsx`: Provider管理UI。
- `apps/desktop/src/bun/pi-service.ts`: Provider一覧・認証状態の集約。
- `apps/desktop/src/bun/model-runtime.ts`: Provider登録とOpenAI認証経路の分離。
- `apps/desktop/src/shared/rpc-schema.ts`: `ProviderInfo` は認証状態を持つが、利用枠・残高の型はまだない。
- `apps/desktop/src/bun/context-usage.ts`: コンテキスト使用量。アカウントの契約枠とは別物。
- SDKの `ProviderRequestOptions.onResponse` / `StreamOptions.onProviderStreamEvent` が利用できる。
- SDKの拡張イベントに `after_provider_response` と `provider_stream_event` がある。

したがって**推論レスポンスのヘッダーを受動的に収集するために、最初から全Provider SDKをforkする必要はなさそう**。ただし、各アダプター・HTTP/WebSocket・成功/エラー経路の通知範囲は実装時に検証する必要がある。特にWebSocketでは通常のHTTPヘッダー収集だけに依存できない。

## 2. 「残り」を混同しない

| 種類 | 例 | 意味 |
|---|---|---|
| 瞬間的な処理能力 | RPM、TPM、同時実行数 | 今どれだけ送れるか。購入済み残高ではない |
| 期間内の契約枠 | 5時間、週、月の使用率 | サブスクの残り。生トークン数と一致するとは限らない |
| 通貨・プランCredits | USD残高、CNY残高、プランCredits | 同じ「Credit」でも現金相当・独自単位・用途制限が違う |
| リセットチケット | Codex earned resets | 利用枠を戻す権利。API残高や現金ではない |
| 使用額・請求額 | 今月$12使用 | 残高ではない。割引・失効・返金・共有利用・集計遅延の影響を受ける |
| 設定された予算 | APIキー月額上限 | 購入済み資金とは違う。予算が残っていても資金不足になり得る |
| インフラ割当 | Azureの未割当TPM | デプロイに割り当てられる能力。推論で消費した残トークンではない |

「残り30%」も、重いモデル・長いコンテキスト・推論量によって実際に送れる回数が変わる。**全社横断の残り会話回数への換算は原則しない。**

## 3. 主要Providerの詳細

### 3.1 OpenAI Codex (`openai-codex`)

**実現性: 高い。リセットチケットも対象にできる。**

#### 文書化された取得経路

Codex app-serverのJSON-RPC:

```json
{"id":1,"method":"account/rateLimits/read"}
```

取得対象:

- `rateLimits` と、提供される場合は `rateLimitsByLimitId`。
- 各windowの `usedPercent`、`windowDurationMins`、`resetsAt`。
- バケットに付く `credits`。
- `rateLimitResetCredits.availableCount`。
- 提供される場合は、チケット個別のID・期限など。

注意:

- `usedPercent` は**使用済み**。残量率は `100 - usedPercent`。
- `resetsAt` はUnix**秒**。
- primary=5時間、secondary=週と固定せず、返却された期間・limit IDを使う。
- リセットチケット数は `availableCount` が正。詳細一覧は件数制限される可能性がある。
- `rateLimitResetCredits: null` は未提供。0枚ではない。
- `rateLimitResetCredits.credits: null` はチケット詳細不明、空配列は取得済みだが詳細対象なし、という違いがある。
- Codexの追加CreditsはOpenAI APIのプリペイド残高ではない。

app-serverは公式CLIプロセスとの連携になる。**pig内のOAuthログインだけで、そのままCLI側も同じアカウントになるわけではない**。CLI導入・ログイン状態・アカウント照合が必要。

[公式app-server資料][codex-app-server] / [リセットの説明][codex-resets]

#### CLIを使わない経路

公式Codexソースには次のバックエンドへの利用量取得処理がある。

```text
GET https://chatgpt.com/backend-api/wham/usage
```

ChatGPT bearer tokenとアカウントIDを使用する。ただし**文書化された汎用HTTP APIではなく、公式クライアント実装から分かる内部経路**。pigの既存Codex認証を利用する直接アダプターは技術的には候補だが、互換性維持の責任が増える。

また公式クライアントは `x-codex-primary-used-percent`、`x-codex-credits-balance` などのヘッダーを処理する。通常の推論時に観測できた値を表示する方式なら、別の推論を実行する必要はない。ただしそれだけでチケット詳細まで揃うとは限らない。

[公式バックエンド処理][codex-backend] / [公式ヘッダーパーサー][codex-headers]

**最初は読み取りのみ。チケット消費は今回の一覧機能に不要で、勝手に実行しない。**

### 3.2 OpenAI ChatGPT (`openai`)

**Codexの残量表示を流用してはいけない。**

現在のSDKは `chatgpt.tokens.use.direct` スコープによるSign in with ChatGPTを使い、`api.openai.com/v1/responses` に直接送る。

公式資料では以下を確認できる。

- 既存のChatGPTプラン枠・該当Creditsを利用する。
- ChatGPT Settings → Usageでアプリの使用状況・上限を管理する。
- アプリ別上限などに達すると `subscription_sharing_usage_limit_exceeded` が返る。
- Open-source/local-client向けフローと、通常のAPIキー課金は別。

一方、**この認証の残りサブスク枠を読む公開APIは確認できなかった**。通常の `x-ratelimit-*` があっても、それをサブスク総残量と解釈しない。このトークンをCodexの非公開バックエンドに転用することも想定しない。

初期対応は「公式使用量画面へのリンク」「直近の制限エラー」「仕様上確認できるヘッダー」の範囲が妥当。

[公式サインイン仕様][siwc-signin] / [アカウント・上限][siwc-accounts] / [制限エラー][siwc-errors]

### 3.3 Anthropic Claudeサブスク (`anthropic`, OAuth)

**技術的には取得候補があるが、標準機能としての採用は慎重にするべき。**

#### 公式に文書化された出力

Claude Codeのstatus-line JSONは、提供される場合に次を含む。

- `rate_limits.five_hour.used_percentage` / `resets_at`。
- `rate_limits.seven_day.used_percentage` / `resets_at`。

これは**公式Claude Codeを使ったときの出力**であり、pigが単独で任意時刻に照会できるREST APIではない。最初のAPI応答前・対象外プラン・一部windowでは欠ける。

公式CLIの出力をユーザー同意で取り込む補助連携には向くが、既存status-line設定を勝手に上書きしてはいけない。

[公式status-line仕様][claude-statusline]

#### 非公開／観測ベースの候補

```text
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <Claude OAuth token>
anthropic-beta: oauth-2025-04-20
```

`five_hour` / `seven_day` などの使用率・リセット時刻を読む既存実装・報告があるが、公開APIスキーマではない。トークンの `user:profile` 権限や429の問題もある。

推論レスポンスでは以下も観測されている。

```text
anthropic-ratelimit-unified-5h-utilization
anthropic-ratelimit-unified-5h-reset
anthropic-ratelimit-unified-7d-utilization
anthropic-ratelimit-unified-7d-reset
```

utilizationは0–1の使用比率、resetはUnix秒。これらも公開保証された一般API仕様ではない。**残量確認だけのために推論を投げると、その確認自体で枠を消費する。**

[Anthropicリポジトリでの利用量API報告][claude-usage-issue] / [ヘッダーと権限の実装報告][claude-headers-issue]

#### 認証ポリシー

Anthropicの公式資料は、第三者アプリがClaude.aiログインを提供したり、ユーザーのサブスクOAuth資格情報をバックエンドとして利用したりすることを認めていない。公式の未改変Claude Codeをホストしてユーザー自身が認証する場合は別扱い。

個人の読み取り専用メーターにこの方針がどう適用されるかまで明示したendpoint固有の許諾は確認できない。**「動くので公認」とは扱えない。pigに既存OAuth接続があることも許諾の根拠にはならない。**

初期案は公式CLI連携または使用量ページへのリンク。独自OAuthポーリングを標準で有効にする前に方針確認が必要。

[公式認証利用ポリシー][claude-legal]

### 3.4 Anthropic API (`anthropic`, API key)

サブスク枠とは別に、公式レスポンスヘッダーから以下を取得できる。

- `anthropic-ratelimit-requests-remaining`。
- `anthropic-ratelimit-input-tokens-remaining` / `output-tokens-remaining`。
- 対応する `*-reset`、`retry-after`。

これらは処理能力で、残クレジットではない。トークン残量には丸めがある。

使用額・使用量はAdmin APIで取得できる。調査時点では新規実装向けにAnalytics APIが案内されている。

```text
GET /v1/organizations/analytics/usage
GET /v1/organizations/analytics/cost
```

Console組織のAdmin資格情報が必要。beta指定などの要件があり、集計は遅延する。従来の `/usage_report/messages` / `/cost_report` もあるが、いずれもリアルタイム残高ではない。

**プリペイド残高を返す公開APIは確認できず、Billing画面が確実な確認先。**

[レート制限][anthropic-rates] / [Usage and Cost Analytics][anthropic-analytics] / [支払・残高][anthropic-billing]

### 3.5 Mistral (`mistral`)

**有望。残りAPIサブスク枠を公式経路で取得する候補がある。**

#### 公式MCP: 一般ユーザー向けの第一候補

```text
https://api.mistral.ai/mcp
Transport: Streamable HTTP
Authorization: Bearer <MISTRAL_API_KEY>
```

公式ドキュメントのBilling能力:

- 組織のプラン。
- 含まれているAPI / Vibe Code予算の残り。
- Pay-as-you-goの使用額と上限。

**具体的なtool名・返却スキーマはドキュメントに固定列挙されておらず、認証後の `tools/list` で確認する設計**。キー権限による利用可否もあるため、実アカウントでの確認が必要。

これはEnterprise Admin APIとは別の取得経路。MCPを使うためにLLMへ判断を委ねる必要はなく、Hostから必要な読み取りtoolだけ呼べばよい。

[公式MCP][mistral-mcp]

#### Enterprise Admin API

Enterprise契約・Admin key・有効化が必要。

```text
GET /v1/admin/usage
GET /v1/admin/rate-limit
GET /v1/admin/spend-limit
```

usageは月次使用量・価格、rate-limitはモデルごとのTPMなど、spend-limitは課金制限状態。詳細usage queryもあるが、**その数値を残プリペイドクレジットと同一視しない**。

[Admin API概要][mistral-admin] / [Billing API][mistral-admin-billing]

#### プラン解釈

公式購読資料では、Studio・API・Vibe Codeの利用は含まれる月次枠を共有し、超過後にPay-as-you-goが利用される。MCPの返却フィールドが分かれていても、独立予算として足し合わせてよいとは限らない。

月次更新は次の請求期間に関連するが、**毎月1日リセットとは断定しない**。リセット日時が取得できなければ「請求期間更新」と表示する。

金銭としてのプリペイド残高はBilling → Creditsで確認できるが、今回その残高専用の公開REST APIは確認できなかった。

短期のAPI制限は、公式資料で案内される `X-RateLimit-Remaining` 応答ヘッダーも収集候補。ただし、これは月次の残予算や金銭残高と同じ値ではない。

[購読と共有枠][mistral-subscriptions] / [クレジット][mistral-billing] / [ヘッダーについて][mistral-limitations]

### 3.6 OpenAI API (`openai-api`)

**レート制限の表示は容易。正確な残プリペイドクレジットは別問題。**

通常の推論レスポンスから:

```text
x-ratelimit-limit-requests
x-ratelimit-remaining-requests
x-ratelimit-reset-requests
x-ratelimit-limit-tokens
x-ratelimit-remaining-tokens
x-ratelimit-reset-tokens
```

Admin keyを追加できる場合:

```text
GET /v1/organization/usage/completions
GET /v1/organization/costs
GET /v1/organization/projects/{project_id}/rate_limits
```

取得できるのは使用量・費用・設定上限で、残クレジットではない。**Admin keyは普段のAPI keyと別資格情報**。

公式資料が残プリペイド残高の確認先として案内するのはBilling overview。今回、現在の公開仕様として残高取得APIを確認できなかった。古い `/dashboard/billing/...` のサンプルを、通常APIキーで動く正規APIとして採用しない。

購入額から利用額を引く方式は、複数キー・他アプリ利用・有効期限・返金・集計遅延があるため、あくまで推計。初期実装では公式残高と誤認される計算を避ける。

[レート制限][openai-rates] / [Admin認証][openai-admin] / [Costs][openai-costs] / [プリペイド管理][openai-prepay]

### 3.7 Google AI Studio / Gemini API (`google`)

**API keyだけで完全な残量・残高を一覧化するのは難しい。**

- `usageMetadata` はそのリクエストの消費トークン数。
- レート上限は**プロジェクト単位**。APIキー単位ではない。
- RPM / 入力TPM / RPD等を区別する。
- RPDのリセットはPacific timeの深夜。固定UTC差にせず夏時間を考慮する。
- 標準的な `x-ratelimit-remaining-*` 相当の公式仕様は確認できなかった。
- 429に付く `QuotaFailure` / `RetryInfo` は制限原因・待機時間であって、成功時の残量取得APIではない。

追加のGoogle Cloud認証とIAM権限があれば:

- Service Usage / Cloud Quotas APIで設定クォータを調べる。
- Cloud Monitoringでサービスが公開している使用量を取得する。
- Cloud Billing exportから費用・適用済みCreditsを集計する。

ただし、**各Geminiクォータのメトリクス提供範囲・遅延を確認する必要があり、これで正確なリアルタイム残量が必ず得られるわけではない**。通常のGemini API keyだけでこれらの管理APIは呼べない。

現在はAI StudioのPrepay残高・取引履歴をBilling画面で確認する公式説明がある。Google Cloudプロモーションクレジットとも区別する。**いずれも残高を取得できる文書化された公開APIを今回確認できなかった**。Billing exportに含まれる「適用済みCredits」は「残Credits」ではない。

[Geminiレート制限][google-rates] / [Gemini課金][google-billing] / [Service Usage][google-quotas] / [Monitoring][google-monitoring] / [Billing export][google-export]

## 4. 標準44 Provider枠の全件対応表

### 証拠の区分

- **D**: 公式文書に記載されたAPI・ヘッダー・CLI・MCP。
- **S**: 公式プロジェクトの実装から経路を確認。汎用公開APIとしての保証は別。
- **R**: 外部OSSや利用報告に実装例。非公開／不安定な可能性。
- **U**: 今回、該当情報の取得経路を確認できず。存在しないと証明した意味ではない。

評価は取得対象ごとに行う。Dが付いていても、そのProviderの全残高が取れるという意味ではない。

### サブスク・プラン系

| Provider ID | 経路・取得できる情報 | 認証・制約／判断 |
|---|---|---|
| `openai-codex` | **D** app-server `account/rateLimits/read`。使用率、期間、reset、Credits、リセットチケット。**S** WHAM / レスポンスヘッダー | 主要対象。公式CLI連携または内部HTTPの互換性維持が必要。[資料][codex-app-server] |
| `openai` | **D** SIWCの制限エラーと使用量UI。**U** 残プラン枠照会API | Codexの数字を代入しない。[資料][siwc-accounts] |
| `anthropic` | OAuth: **D** Claude Code status-line。**R** `/api/oauth/usage` / unified headers。API key: **D** throughput headers、Admin usage/cost | サブスクOAuthの第三者利用ポリシーを先に確認。現金残高はU。[仕様][claude-statusline]・[方針][claude-legal] |
| `mistral` | **D** 公式MCPのBilling。残API/Vibe予算、プラン、PAYG上限。Enterprise Admin使用量APIもある | 既存キー権限とtools/listを実機確認。金銭残高とプラン予算は別。[資料][mistral-mcp] |
| `github-copilot` | **D** `GET /users/{username}/settings/billing/ai_credit/usage`（旧方式は `premium_request/usage`）。組織等には対応する別scopeのAPI。**R** `/copilot_internal/user` のquota snapshots | Billing APIは追加のPlan/billing read権限等が必要。使用量APIだけでは残枠が分からない。現行AI Creditsと旧premium requestsを見分ける。[公式][copilot-billing]・[実装][copilot-internal] |
| `kimi-coding` | **D** `kimi web` のローカル `/api/v1/oauth/usage`。**S/実験扱い** hosted `GET /coding/v1/usages` | ローカルCLI連携が公式。hosted endpointは公式フォーラムでlegacy/experimental扱い。新旧プランで5h/週/月の構成が違う。[CLI][kimi-server]・[hosted][kimi-hosted] |
| `meta` | **D** `muse usage` が期間内使用率・週・reset・tierを出力。API利用は **D** rate headers | `--json` の具体的schemaは外部連携例あり、CLI版確認が必要。サブスクcredentialと追加API key課金は別。[公式][meta-cli]・[購読][meta-subscriptions]・[JSON実装例][meta-json] |
| `minimax` | **D** `GET https://www.minimax.io/v1/token_plan/remains`。公式CLI `mmx quota` も候補 | Subscription keyが必要。PAYG keyと混同しない。quotaと現金残高は別。[資料][minimax-global]・[CLI][minimax-cli] |
| `minimax-cn` | **D** `GET https://www.minimaxi.com/v1/token_plan/remains` | 中国版キー・ホストを分ける。公式FAQは返却schemaを十分に固定していない。[資料][minimax-cn] |
| `opencode-go` | **S/R** Go usage endpoint。現行 `/inference/go/v1/usage`、旧 `/zen/go/v1/usage` に関する公式リポジトリ上の情報。5h/週/月window | APIキーで読む候補。移行中のURL・新API keyのUsage: Read権限・実際の応答を確認する。残現金残高が含まれるとは限らない。[公式文書][opencode-api]・[移行情報][opencode-usage]・[実装][opencode-oss] |
| `qwen-token-plan` | **D** `bl usage token-plan --output json`。使用率・reset・返却window | 公式CLIが候補。管理APIは推論キーではなくAccessKey署名。国際/チーム構成の対応は要照合。[資料][qwen-cli] |
| `qwen-token-plan-cn` | **D** 同CLI。Token Plan管理OpenAPIも公開 | 中国管理APIはModelStudio、AccessKey署名。正確なAction/応答は別途確認。[管理API][qwen-api] |
| `qwen-token-plan-individual` | **D** Token Plan CLIが候補。**R** 個人用console usage/subscription/quota-config | individual/地域ごとの認証互換性は未検証。Cookie経路を初期実装の前提にしない。[CLI][qwen-cli]・[OSS][qwen-oss] |
| `qwen-token-plan-individual-cn` | **D** Token Plan CLIが候補。**R** 中国個人用console経路 | データなし `hasQuotaData: false` を残量0にしない。[CLI][qwen-cli]・[OSS][qwen-oss] |
| `xai` | API課金: **D** Management APIのprepaid balance / usage。サブスク: **S** Grok公式CLIの `/billing?format=credits` | API残高はmanagement key + team ID。OAuthサブスクのproxy照会は403報告もあり、pigの認証との互換性は未確認。[Management][xai-billing]・[CLI source][xai-cli] |
| `xiaomi-token-plan-ams` | **R** MiMo consoleのプランdetail/usage。**U** 文書化されたキー認証の残枠API | Cookieベースの既存実装あり。AMS個別対応・資格情報の対応は未検証。[公式][mimo-platform]・[OSS][mimo-oss] |
| `xiaomi-token-plan-cn` | **R** 同上 | 中国リージョンとアカウントを照合。残Creditsは生token数ではない。[OSS][mimo-oss] |
| `xiaomi-token-plan-sgp` | **R** 同上 | SGP個別の管理経路は未検証。[OSS][mimo-oss] |
| `zai` | **S** `GET https://api.z.ai/api/monitor/usage/quota/limit`。公式usage pluginが利用 | Coding Plan key。公式plugin実装はAuthorizationにキーをそのまま渡す。API側がBearerを要するとは決め打ちしない。プラン・組織権限差あり。[公式plugin][zai-plugin]・[source][zai-source] |
| `zai-coding-cn` | **S** `https://open.bigmodel.cn` の同monitor経路 | 中国版キー、個人/チームの仕様差に注意。安定版REST schemaではなく公式実装根拠。[source][zai-source] |

### API残高・使用量・短期クォータ系

| Provider ID | 経路・取得できる情報 | 認証・制約／判断 |
|---|---|---|
| `openai-api` | **D** rate headers、Admin usage/cost/project rate_limits。**U** プリペイド残高API | 通常キーだけならヘッダー中心。Admin keyを任意追加。[資料][openai-rates]・[課金][openai-prepay] |
| `deepseek` | **D** `GET https://api.deepseek.com/user/balance`。is_available、通貨、total/granted/topped-up balance | 通常APIキーで取得可。返る金額は文字列。導入しやすい。[API][deepseek-balance] |
| `moonshotai` | **D** `GET https://api.moonshot.ai/v1/users/me/balance`。available/cash/voucher balance | 通常のMoonshotキー。Kimi Codingの枠とは別。[API][moonshot-balance] |
| `moonshotai-cn` | **D** `GET https://api.moonshot.cn/v1/users/me/balance`。CNYのavailable/cash/voucher balance | 中国ホスト・通貨・アカウントを分離して実機確認する。[中国資料][moonshot-cn-balance] |
| `openrouter` | **D** `GET /api/v1/key` のusage/limit_remaining、`GET /api/v1/credits` のtotal_credits/total_usage | key capとアカウント残高は別。現行credits資料は**management keyが必要**と記載。OAuth/通常推論キーのみではアカウント残高を保証しない。[Key][openrouter-key]・[Credits][openrouter-credits] |
| `vercel-ai-gateway` | **D** `GET https://ai-gateway.vercel.sh/v1/credits`。balance、total_used、token_passの残枠/reset | Gateway key。balanceはToken Pass分を除く。USD文字列を保つ。導入しやすい。[API][vercel-credits] |
| `cloudflare-ai-gateway` | **D** `GET /accounts/{account_id}/ai-gateway/billing/credit-balance` とusage-history。GraphQL analyticsもある | Cloudflare tokenのAI Gateway Read等 + account ID。analyticsは請求用残高ではない。[Balance][cloudflare-balance]・[Usage][cloudflare-usage] |
| `cloudflare-workers-ai` | **D** Neurons日次枠・limitsの仕様。Unified billing利用時はGateway残高APIへ接続可能 | Workers AIの日次Neurons残量を直接返す公開経路は未確認。モデルtokensを単純にNeurons扱いしない。[価格][workers-pricing]・[統合課金][workers-unified] |
| `groq` | **D** `x-ratelimit-*` とreset。requestsは**RPD**、tokensは**TPM** | 通常応答の受動収集に向く。現金残高APIは未確認。日次と分次を混ぜない。[仕様][groq-rates] |
| `baseten` | **D** Model APIsのeffective limits、remaining headers、`/v1/model_apis/usage`、billing cost APIs | workspace API key/権限。処理能力・消費・credits適用額は取れるが、正確な現在残高APIは未確認。[limits][baseten-limits]・[billing][baseten-billing] |
| `fireworks` | **D** `firectl quota list`、billingUsage、billing/summary、usageCosts query、token-limit headers | account ID等が必要。ヘッダーはlimit中心で必ずremainingが揃うわけではない。usage/費用は取れても残高APIは未確認。[quota][fireworks-quotas]・[billing][fireworks-usage] |
| `together` | **D** `GET /v1/billing/usage`（beta・サポート有効化）。費用付きusage | 時間単位の遅延あり。正確な残高API・remainingヘッダー仕様は未確認。[billing][together-billing]・[rate][together-rates] |
| `cerebras` | **D** quota/console analyticsと課金残高UI、推論usage。**U** 公開残高API・remaining header仕様 | 連続補充のtoken bucket。固定リセットとして表示しない。初期はダッシュボードリンク。[limits][cerebras-rates]・[billing][cerebras-billing] |
| `huggingface` | **D** Enterprise組織の `/api/organizations/{org}/billing/usage/inference`。**S/R** 個人 `/api/settings/billing/usage-v2` | Billing read権限。個人APIのschemaは不安定。wallet残高は認証済みBillingページ読取例あり。usageから共有compute creditsの残りを単純減算しない。[公式][hf-billing]・[実装][hf-oss] |
| `google` | **D** usageMetadata、Cloud管理API群、AI Studioのquota/billing UI | API keyだけで残枠・残金を読む経路は未確認。Cloud管理連携は別認証。[quota][google-rates]・[billing][google-billing] |
| `google-vertex` | **D** Cloud Quotas/Monitoring/Billing export。モデルによってDynamic Shared Quota | IAM/Cloud認証が必要。DSQは固定の「残りTPM」がそもそも存在しない。残プロモCreditsは別。[quota][vertex-quotas]・[billing export][google-export] |
| `amazon-bedrock` | **D** Service Quotas、CloudWatch、Cost Explorer、AWS Billing `GetCredits` | AWS IAMの追加read権限。GetCreditsは残額・推定額・期限・対象サービスを持つ。推論用Bedrockキーのみで呼べるとは限らず、AWS全体のCreditsをBedrock専用残高と誤記しない。[metrics][bedrock-metrics]・[credits][aws-credits] |
| `azure` | **D** rate headers、Cognitive Services Usages、Consumption credits balanceSummary / lots | ARM/Entra認証とbilling権限。クレジットAPIは契約種別依存。未割当TPMと実消費残量を区別。[quota][azure-quotas]・[credits][azure-credits] |
| `xiaomi` | **R** MiMo console balance APIの既存実装。**D** 推論usage。**U** 公開残高API | `api-platform_serviceToken` / userIdなどのCookie依存。初期はリンクまたは明示的な実験対応。[公式][mimo-platform]・[OSS][mimo-oss] |
| `nvidia` | **D** Build/API Catalogの制限・429説明。**U** 残trial credits/remaining API | 無料アクセスと昔のtrial credits説明が混在し、全アカウント共通の残クレジットを仮定しない。[公式][nvidia-troubleshooting] |
| `opencode` | **D** リクエストcost/usage/billing_source。**R** console billing status | Zen/現行Consoleのプリペイド残高はconsole session経路の実装あり。公開残高APIは未確認。Go使用量APIとは別。[公式][opencode-inference]・[OSS][opencode-oss] |
| `ant-ling` | **D** QPS、402 insufficient balance、consoleの残高・voucher説明。**U** 公開残高API | 課金方式移行後の月次voucherと古い日次free token説明が混在。数字をハードコードしない。[更新資料][ling-billing]・[API][ling-api] |
| `radius` | **D** 組織単位のCredits/budget。公式pi-radius packageがOpenAPI contract発見手段を提供 | 今回、公開Web資料から具体的な残高/usage operationを確認できず。**U**で保留し、実装前に公式contractを調べる。キーだけで権限が足りるかも未確認。[組織][radius-orgs]・[package][radius-package] |
| `typesafe` | **D** `/v1/systemone` のrequest usage。**U** 公開残高・契約枠API | token使用量をローカル記録することは可能だが、それはアカウント全体残量ではない。[公式API index][typesafe-index] |

## 5. 実装するなら、どの順が現実的か

### 第1段階: 公式の事実だけで価値が出る版

1. **共通画面**: 接続済みProvider、指標ごとの状態、更新日時、公式ダッシュボードへのリンク。
2. **通常応答のヘッダー収集**: OpenAI API、Anthropic API、Groq、Azure、Basetenなど。追加推論を行わない。
3. **通常キーで取得できる残高**: DeepSeek、Moonshot、Vercel AI Gateway。
4. **Mistral MCP**: 認証済みtools/listでBilling toolを確認し、読み取りだけ行う。
5. **Codex**: まず公式app-server連携のアカウント境界を確認。CLIを必須にしない方針なら、内部HTTP adapterを「公式公開APIではない」と明記して別判断する。
6. **OpenRouter**: 通常キーの残予算から開始し、management keyは任意の追加設定。

「管理者キーを登録しないとページ全体が使えない」設計にはしない。**取得できる指標だけ段階的に増やす**。

### 第2段階: プラン・公式CLI／公式ソース連携

- MiniMaxのSubscription API。
- Z.ai公式usage pluginと同等の読取。
- KimiのローカルCLI API／実験扱いhosted API。
- Metaの `muse usage`。
- Qwenの公式CLI JSON。
- OpenCode Goのusage endpoint。
- Copilotの現行Billing API＋必要に応じたbest-effort quota snapshot。

初回調査では返却schemaまで固定できないものが含まれる。**実アカウントのサンプル取得と欠落値・プラン差のテストが前提**。

### 第3段階: Cloud管理連携

- Google Cloud: Project ID、OAuth/ADC、IAM、Quotas、Monitoring、Billing export。
- AWS: IAM、Region、Service Quotas、CloudWatch、Billing GetCredits。
- Azure: Entra/ARM、subscription/region、billing account/profile。
- Cloudflare: account ID、権限付き管理token。
- OpenAI/Anthropic/xAIのAdmin/Management credentials。

ここは一枚の残量画面というより、**追加のクラウド管理統合**。設定・権限説明・課金範囲の扱いの方が重い。管理APIやMonitoring/BigQuery等の追加費用の有無も別途確認する。

### 初期版では見送るもの

- Chrome/EdgeのCookieを自動抽出する機能。
- ログインWeb画面のDOMスクレイピング。
- 残量照会のためのダミー推論。
- 正確な残高の代わりにローカル使用額を差し引いて表示すること。
- Codexリセットチケットの自動消費。
- 全社共通の「あと何回チャットできる」換算。

## 6. 画面とデータで守るべきこと

### 表示単位

Providerカードに、存在する指標だけ複数表示する。

```text
Codex
  5時間枠       残り62%       18:20更新
  週間枠        残り41%       金曜リセット
  リセット券    2枚           有効期限あり

OpenAI API
  リクエスト枠  直近の応答で取得
  今月費用      管理者連携未設定
  残クレジット  公開取得経路未確認 → Billingを開く
```

上はUIの例で、実アカウントの測定値ではない。

最低限のデータ項目:

- Provider IDと**account / organization / project / regionの適用範囲**。
- 指標の種類・名称・単位。
- limit / used / remaining / resetsAt（存在するときだけ）。
- 取得元（公式API、公式CLI、応答ヘッダー、非公開API、ローカル推定）。
- observedAt、freshness、取得状態。

0・不明・無制限・未提供・権限不足・古いキャッシュを分ける。リセット予定時刻を過ぎても、照会せずに「100%へ回復済み」と断定しない。

### 更新方式

- ヘッダーは推論のついでに観測し、最終観測時刻を表示。
- 残高API等はページ表示時の遅延取得＋キャッシュ＋手動更新。
- 必要ならフォアグラウンド時のみ低頻度polling。間隔はProvider別に検証し、共通の許容頻度を仮定しない。
- 429/Retry-Afterではbackoff。繰り返す401/403は停止して再認証・権限確認を案内。
- 監視APIの失敗でチャット送信を失敗させない。残量監視はbest-effort。
- 通貨のdecimal文字列、cents、nanoUSD、独自Creditsを混同しない。xAIの会計上の符号など、意味が曖昧なものを未検証のまま反転・合算しない。

### 認証・安全性

- 資格情報はHost側で既存の認証更新機構から解決し、WebView/RPCに秘密を流さない。
- Admin/Management keyは通常推論キーと分けて任意設定。可能な限りread-only権限。
- CLIとpigが異なるアカウントを表示していないか確認する。
- カスタムbase URLに、別ProviderのOAuth tokenや管理キーを送らない。
- レスポンスの全ヘッダーや生の認証エラーbodyをログへ丸ごと保存しない。
- Cookie経路を採用するなら明示的opt-in、保存・失効・規約・Windowsの暗号化Cookie対応まで別機能として扱う。

## 7. 実現性の最終判断

| 目標 | 判断 |
|---|---|
| 対応Providerを一覧し、取得可能な残量を表示 | **十分現実的** |
| Codexの残枠とリセットチケット | **現実的**。公式CLI連携／内部HTTPのどちらを採るか決める |
| MistralのAPIサブスク予算 | **有望**。公式MCPの実応答・キー権限を確認する |
| OpenAI APIとGoogleの正確な残クレジットを普通のキーだけで表示 | **現状の公開仕様だけでは約束できない** |
| Claudeサブスクを独自OAuthで常時監視 | **技術・規約・安定性に課題**。公式CLI出力の利用を優先 |
| 全44枠で同じ精度・同じリアルタイム性を保証 | **非現実的** |

最小で価値のある製品は、**「残量が分かるものは実数・使用率を表示し、分からないものは理由と確認先を表示するUsageページ」**。これなら非公開APIの継続保守を必須にせず始められる。

## 8. 調査上の未確認事項

- 実アカウントでのAPI/MCP/CLI照会は行っていない。料金・枠を消費するリクエストも行っていない。
- ローカルの保存資格情報・Cookie・残高は読んでいない。
- MistralのBilling tool名/schema、Qwen各プランの実応答、リージョン別管理経路、SDKの全transport通知範囲は未検証。
- Radiusの具体的な管理operationは未確定。公式生成contractでの追加調査が必要。
- 「公開API未確認」は不存在の断定ではない。配布アプリが安定利用できる根拠を確認できなかったという評価。
- 資料や現行mainのソースは変更される。実装時には対象CLI/SDK版とレスポンスfixtureを固定して再確認する。

## 参照資料

以下は本文・表のリンク定義。公式文書とOSS観測の区別は各項目に記載した。

[codex-app-server]: https://learn.chatgpt.com/docs/app-server
[codex-resets]: https://help.openai.com/en/articles/20001498-how-resets-work-in-codex
[codex-backend]: https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs
[codex-headers]: https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs
[siwc-signin]: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
[siwc-accounts]: https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
[siwc-errors]: https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
[claude-statusline]: https://code.claude.com/docs/en/statusline
[claude-legal]: https://code.claude.com/docs/en/legal-and-compliance
[claude-usage-issue]: https://github.com/anthropics/claude-code/issues/31637
[claude-headers-issue]: https://github.com/steipete/CodexBar/issues/1894
[anthropic-rates]: https://platform.claude.com/docs/en/api/rate-limits
[anthropic-analytics]: https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
[anthropic-billing]: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
[mistral-mcp]: https://docs.mistral.ai/resources/mcp
[mistral-admin]: https://docs.mistral.ai/admin/admin-api/overview
[mistral-admin-billing]: https://docs.mistral.ai/api/endpoint/beta/admin/billing
[mistral-subscriptions]: https://docs.mistral.ai/admin/billing-usage/subscriptions
[mistral-billing]: https://docs.mistral.ai/admin/billing-usage/billing
[mistral-limitations]: https://docs.mistral.ai/resources/known-limitations
[openai-rates]: https://developers.openai.com/api/docs/guides/rate-limits
[openai-admin]: https://developers.openai.com/api/docs/guides/admin-apis
[openai-costs]: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
[openai-prepay]: https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing
[google-rates]: https://ai.google.dev/gemini-api/docs/rate-limits
[google-billing]: https://ai.google.dev/gemini-api/docs/billing
[google-quotas]: https://docs.cloud.google.com/service-usage/docs/reference/rest/v1beta1/services.consumerQuotaMetrics/list
[google-monitoring]: https://docs.cloud.google.com/apis/docs/monitoring
[google-export]: https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage
[copilot-billing]: https://docs.github.com/en/rest/billing/usage
[copilot-internal]: https://github.com/CopilotC-Nvim/CopilotChat.nvim/blob/main/lua/CopilotChat/config/providers.lua
[kimi-server]: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html
[kimi-hosted]: https://forum.moonshot.ai/t/error-code-429-were-receiving-too-many-requests-at-the-moment/191/7
[meta-cli]: https://dev.meta.ai/docs/muse-code/changelog
[meta-subscriptions]: https://dev.meta.ai/docs/muse-code/subscriptions
[meta-json]: https://github.com/stablyai/orca/pull/38907
[minimax-global]: https://platform.minimax.io/subscribe/coding-plan
[minimax-cn]: https://platform.minimaxi.com/subscribe/coding-plan
[minimax-cli]: https://github.com/MiniMax-AI/cli
[opencode-api]: https://opencode.ai/docs/console/api
[opencode-usage]: https://github.com/anomalyco/opencode/issues/52227
[opencode-oss]: https://raw.githubusercontent.com/steipete/CodexBar/main/docs/opencode.md
[qwen-cli]: https://www.alibabacloud.com/help/en/model-studio/cli/usage-quota
[qwen-api]: https://docs.agent.bailian.aliyun.com/zh/api/token-plan/overview
[qwen-oss]: https://raw.githubusercontent.com/steipete/CodexBar/main/docs/qwen-cloud.md
[xai-billing]: https://docs.x.ai/developers/rest-api-reference/management/billing
[xai-cli]: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs
[mimo-platform]: https://platform.xiaomimimo.com/
[mimo-oss]: https://raw.githubusercontent.com/steipete/CodexBar/main/docs/mimo.md
[zai-plugin]: https://docs.z.ai/devpack/extension/usage-query-plugin
[zai-source]: https://raw.githubusercontent.com/zai-org/zai-coding-plugins/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs
[deepseek-balance]: https://api-docs.deepseek.com/api/get-user-balance/
[moonshot-balance]: https://platform.kimi.ai/docs/api/balance
[moonshot-cn-balance]: https://platform.kimi.com/docs/api/balance
[openrouter-key]: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
[openrouter-credits]: https://openrouter.ai/docs/api/api-reference/credits/get-credits
[vercel-credits]: https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api
[cloudflare-balance]: https://developers.cloudflare.com/api/resources/ai_gateway/subresources/billing/methods/credit_balance/
[cloudflare-usage]: https://developers.cloudflare.com/api/resources/ai_gateway/subresources/billing/methods/usage_history/
[workers-pricing]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[workers-unified]: https://developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/
[groq-rates]: https://console.groq.com/docs/rate-limits
[baseten-limits]: https://docs.baseten.co/inference/model-apis/pricing-and-limits
[baseten-billing]: https://docs.baseten.co/organization/billing
[fireworks-quotas]: https://docs.fireworks.ai/guides/quotas_usage/account-quotas.md
[fireworks-usage]: https://docs.fireworks.ai/accounts/exporting-usage-and-costs
[together-billing]: https://docs.together.ai/docs/billing-spend-controls.md
[together-rates]: https://docs.together.ai/docs/serverless/rate-limits
[cerebras-rates]: https://inference-docs.cerebras.ai/support/rate-limits
[cerebras-billing]: https://inference-docs.cerebras.ai/console/account-billing
[hf-billing]: https://huggingface.co/docs/inference-providers/pricing
[hf-oss]: https://raw.githubusercontent.com/steipete/CodexBar/main/docs/huggingface.md
[vertex-quotas]: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas
[bedrock-metrics]: https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html
[aws-credits]: https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html
[azure-quotas]: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota
[azure-credits]: https://learn.microsoft.com/en-us/rest/api/consumption/credits/get?view=rest-consumption-2026-06-01
[nvidia-troubleshooting]: https://docs.nvidia.com/rag/latest/troubleshooting.html
[opencode-inference]: https://opencode.ai/docs/console/api/inference/
[ling-billing]: https://developer.ant-ling.com/en/docs/getting-started/changelog/billing-upgrade/
[ling-api]: https://developer.ant-ling.com/en/docs/api-reference/
[radius-orgs]: https://radius.earendil.com/docs/organizations
[radius-package]: https://pi.dev/packages/@earendil-works/pi-radius
[typesafe-index]: https://docs.typesafe.ai/llms.txt
