# Provider残量取得：実装前の再調査

調査日: **2026-11-12**。
対象: pigのソース、インストール済み `@earendil-works/pi-ai` **1.5.2**、公式資料・公式ソース、他ハーネス／使用量メーターの実装。

前回の [実現性調査](provider-usage-feasibility.md) の続編。**取得経路を発見したことと、pigで実際に取得できたことは区別する**。

> 後続の実装状況・現在のコード構成は [Provider使用量の実装](provider-usage.md) を参照。本書の「未実装」は各調査時点の記録。
今回は公開文書・ソース・公開OpenAPIだけを読み、保存トークン・Cookie・実残高は読んでいない。
認証付き使用量API、課金される推論、他ツールの認証更新・ログインは実行していない。

## 1. 結論と前回からの訂正

1. **Codex CLIは必須ではない。** Codex公式実装、CodexBar、複数のPi/OpenCode拡張は同じ使用量HTTP APIを使う。pigの既存Codex OAuthから直接取得するのが最軽量。
2. **公式app-server経由でも、別途CLIログインが必須とは限らない。** 実験的な `chatgptAuthTokens` モードで、Hostが所有するアクセストークンとアカウントIDを渡せる。pigとCLIの認証ファイルをコピーする必要はない。
3. **Radiusの正式な残高・予算APIが見つかった。** 前回の「operation未確認」は解消。公開OpenAPIでパス・権限・返却スキーマまで確認できた。
4. **MiniMaxは公式CLIにAPI残高とToken Planの両方の取得実装がある。** ただし `*_usage_count` の意味がレスポンス世代によって反転する。フィールド名だけを信じる実装は危険。
5. **Claudeは「取得経路なし」ではない。** OAuth内部API、通常応答のヘッダー、公式status-line、CLI `/usage`、WebセッションAPIがある。ただし公開保証・認証ポリシー・429・外部資格情報の所有権を分けて判断する必要がある。
6. **OpenAI APIの旧残高APIを使うOSSは今もある。** ただし旧ユーザーキー／Webセッション用のbest-effort経路であり、通常のproject API keyで使える正式な残高APIとは扱わない。
7. **「17社は今の接続のまま簡単に取得できる」という前回の説明は過大。** CLI追加、管理権限、別スコープのトークン、内部API、契約差を含む。件数ではなく、adapterと認証方式ごとに対応を判定する。

### UIの合意（取得仕様への要求）

- サイドバー常設、**18pxの二重リング**。横幅はサイドバーの利用可能幅に追従し、パネルの固定幅を増やさない。
- 内周=容量。設定で「残り／使用済み」を切り替え、初期値は残り。
- 外周=次のリセットまでの残り時間の比率。リセットに近づくほど短くなる。
- リセット表示は `1h 12m` / `45m` / `12s` / `12/1`。言語非依存。
- 外周には **reset日時だけでなく、windowの長さまたは開始日時** が必要。
- window長を取得できないときは外周を未提供にする。最初の取得時刻をwindow開始としたり、月を30日と仮定したりしない。
- 金銭残高だけのProviderは金額表示。金額から無理に%を作らない。
- 取得経路がないものは非表示。対応済みadapterの一時エラーや権限不足まで「非対応」に変えない。

このメモは取得ロジックの設計資料であり、本番のサイドバーや設定にはまだ組み込んでいない。

## 2. 調査した他実装（commit固定）

実際に読んだ中心ファイル。OSSの存在は公式サポート／規約上の許可／全環境での動作保証にはならない。

| 実装 | 確認したこと | pigへの示唆 |
| --- | --- | --- |
| [OpenAI Codex][codex-rpc-source] `c0cc9fc820f6` | app-server protocol、external auth、rate-limit処理、HTTPクライアント、ヘッダーパーサー | HTTPの実体と公式RPCの両方を参照できる。権限・account・limit IDを保つ |
| [CodexBar][cb-codex] `7447bc77c249` | Codex OAuth HTTP、CLI/PTY fallback、Claude OAuth/Web/CLI、Mistral Cookie、MiMo、OpenAI、Copilot、Gemini、Qwen等 | 対応数が多いが、裏では複数の資格情報とプラットフォーム依存処理。単純な「全部API」ではない |
| [OpenCode本体][oc-limits] `3d308eae2e68` | Console予算とGo使用量。Claude連携はAgent SDK経由の別経路も持つ | 現行本体のusage機能は全社共通残量APIではない。Consoleのorgを明示する |
| [opencode-usage-plugin][oc-plugin] `180282c36245` | Codex WHAM、Copilot internal、Z.ai、OpenRouter | CLIプロセスを介さない小さなHTTP adapterの実例。ただしregistryではClaudeが有効列挙されておらず、ファイルの存在=対応とはしない |
| [opencode-codex-usage][oc-codex] `1d19d3f9a163` | WHAM probe、cache、quota monitor | OpenCode内で能動照会する例。Codex CLIのTUIを読むことは必須でない |
| [pi-usage][pi-usage] `84c35cc8967d` | SDKの解決済み認証を利用、Codex、DeepSeek、Moonshot、Vercel、MiniMax、Go、ChatGPT companion | pigと同じSDK系で参考になる。特にorigin制限・account guard・キャッシュ境界 |
| [pi-usage-meters][pi-meters] `9c97be579a7e` | Claude/Codex/Copilot/Kimi/Grok/GLM/MiniMax | window期間、reset、利用率を一緒に扱う例。複数の独立制限を合算しない |
| [piQuota][piquota] `cc4c27cde89a` | 外部認証を読み取り専用で利用、429 backoff、前回成功値 | 再起動してもポーリングで制限を悪化させない設計。外部ツールのrefresh tokenを勝手に更新しない |
| [TokenMeter (Windows)][tokenmeter] `5620b1bf4e4d` | Codex WHAM、Claude OAuth/status-line、MiMo Cookie/CDP、OpenAI旧残高 | Windows実装例がある。ただしCDPやCookie回収は通常キー利用と別機能。初期pigに丸ごと持ち込まない |
| [Gemini CLI][gemini-source] `aeb6c04b093e` | `retrieveUserQuota` とquota bucket型 | Gemini CLI/Code Assistの残量と、AI Studio APIキーの残量は別 |
| [MiniMax公式CLI][minimax-endpoints] `ae29aae57b05` | quotaとaccount balanceの振り分け、数値解釈 | 「簡単なAPI」にも世代差がある。公式fixtureを基準にテスト |
| [Z.ai公式plugin][zai-source] `0446d0bb0bc5` | monitor quota HTTPと地域別host | 公式ツール実装から得られる経路。独立した安定REST仕様とは区別 |

対応数の宣伝やREADMEの一覧だけで判断せず、上記の取得処理・認証処理まで確認した。

## 3. Codex：4つの経路を比較

### 3.1 既存pig OAuthで直接HTTP（第一候補）

公式Codex backend-clientも使う経路:

```http
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <Codex access token>
ChatGPT-Account-Id: <selected ChatGPT account/workspace ID>
Accept: application/json
```

公式クライアントはbackend種別によって `/api/codex/usage` と `/wham/usage` を選ぶ。
上のURLを全環境・全組織に無条件で固定してよいという意味ではない。公式のworkspace routing/residency制約も変化している。

レスポンスで確認できる対象:

- `rate_limit.primary_window` / `secondary_window`。
- `used_percent`、`limit_window_seconds`、`reset_at`（Unix秒）、`reset_after_seconds`。
- `additional_rate_limits` 等の追加バケット（モデル等で独立する制限）。
- `credits`（CodexのCredits。OpenAI APIのUSD残高ではない）。
- `rate_limit_reset_credits.available_count`（提供時のみ）。
- より詳しいチケット情報は別GET `/wham/rate-limit-reset-credits`。失敗しても通常windowを捨てない。

[公式backend-client][codex-http-source]、[CodexBar fetcher][cb-codex-fetcher]、[Pi adapter][pi-codex]、[OpenCode plugin][oc-plugin]を照合した。

**pigで使う認証**:

- SDKの `auth/oauth/openai-codex.js` は `accountId` を保持し、既存のCodex access tokenを推論用に解決している。
- 更新はSDKの `Models.getAuth()` 等、既存のロック付きrefresh経路に集約する。残量メーターだけのrefresh実装を増やさない。
- pigの `AccountCredentials` はruntimeごとの選択とロック付き保存を持つ。監視のために会話runtimeの選択を一時変更せず、各accountに固定した解決コンテキストを作る。
- account/workspaceが不明な場合、CLIのデフォルトaccountへ黙ってフォールバックしない。
- ログアウト／アカウント削除中に返った古い応答をpublishしない。account generationを照合する。

**利点**: CLIインストール・起動・PTY不要。複数accountを同時取得しやすい。外周リングの期間も取得できる。

**制約**: このHTTPエンドポイント自体は汎用公開REST APIではない。公式ソースに実装があっても安定性保証は別。
スキーマ変更・401/403・アカウントルーティングへの保守が必要。地域制約のあるアカウントでは特にRPC経由を検討する。

### 3.2 公式app-server + pig所有トークン（CLI連携の本命）

「CLIに別ログインし、`~/.codex/auth.json` を読ませる」だけが方法ではなかった。
[公式app-server文書][codex-app-server]と[生成protocol][codex-login-schema]に外部トークンmodeがある。

概念上のstdio JSONLシーケンス（requestの成功を待って次へ進む）:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"pig_usage","version":"1"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized"}
{"id":2,"method":"account/login/start","params":{"type":"chatgptAuthTokens","accessToken":"<pig-owned access JWT>","chatgptAccountId":"<account ID>"}}
{"id":3,"method":"account/rateLimits/read"}
```

- `codex app-server` のstdio transportは改行区切りJSON。HTTPサーバーやPTYを立てる必要はない。
- `chatgptAuthTokens` は**実験的機能**。`capabilities.experimentalApi = true` が必要。
- mainだけでなく、調査時点の最新公開release **0.167.2**（2026-11-11、commit `ce21072c90d3`）のschemaでも、このmodeと `excludeResetCreditDetails` を確認した。最小対応versionまでは確定していない。
- [同release][codex-release]にはWindows x64/ARM64の `codex` と、単独の `codex-app-server` 配布物もある。将来RPC方式を同梱するなら、必ずしもユーザーにCLI全体の導入を要求する必要はない。ただし同梱・更新・署名・依存物・ライセンス確認は別途必要。
- 渡すのはaccess token、account ID、任意のplan type。**refresh tokenは渡さない**。
- 公式実装は `ExternalAuthBridge` に認証を保持する。管理ログインの保存とは別modeで、ログイン途中の保存処理もキャンセルする。
- Hostに `account/chatgptAuthTokens/refresh` が届く場合、pig側の同じaccountで更新し、新しいaccess tokenを返す。現行実装の待機期限は約10秒。
- `account/read.refreshToken` をtrueにしてもexternal-token modeでは無視される。Hostが更新責任を持つ。
- rate-limit読取自体の全401経路でrefresh callbackが必ず来る、と仮定しない。事前の有効トークン解決とbounded retryをHost側でも設計する。
- 少なくとも監視用processの `CODEX_HOME` / cwd / config / MCP / 通知を分離・最小化する。ユーザーのプロジェクト設定を監視だけのために読み込ませない。トークンをargv/envに置かずstdioで送る。
- `thread/start` や `turn/start` は不要。使用量取得のために推論を投げない。
- バージョンをfeature probeし、対応しないCLIには「連携非対応」を返す。複数accountの結果はprocess/accountに固定し、グローバルCLIのactive accountを書き換えない。

取得結果:

- `rateLimits` は旧互換の単一バケット。
- `rateLimitsByLimitId` があればそちらを優先し、重複表示しない。
- `RateLimitWindow` の `usedPercent`, `windowDurationMins`, `resetsAt`。期間とresetはnullもあり、外周を描けない場合がある。
- `rateLimitResetCredits.availableCount`、提供されれば個別券の期限等。
- 現行schemaには `excludeResetCreditDetails` もある。詳細券一覧を毎回読む必要がないなら省略可能だが、古いCLIとの互換を確認する。
- `supportsLunaReserve` のような能動機能向けopt-inは受動メーターでは付けない。
- `rateLimitResetCredit/consume` は呼ばない（読み取り用途外）。

**利点**: パース、backend routing、API差分への追従の多くを公式CLIに委ねられる。

**コスト**: Windows配布物・実行パス・CLI更新・experimental API・process管理が追加依存。複数アカウントを全部常駐processにすると重いので、必要時起動／短期idle終了を検討する。

**推奨**: pigの標準版は直接HTTP adapterを小さく実装し、公式RPCを選べる上位の取得方式として分離する。公開インターフェース経由を優先する方針なら、RPCを先にしてもよい。どちらでも**認証所有者はpigのまま**にする。

### 3.3 既存Codex CLIのログインを使う

ユーザーが明示的に「CLIアカウントの使用量を表示」を選ぶ場合の経路。

- `account/read` とrate-limit responseのaccount識別を利用。email一致だけでworkspace一致と判断しない。
- 古いCLIで十分なaccount IDが得られなければ、pigアカウントに紐づけず「Codex CLI」として別ソースにする。
- **CLIのauthファイルをpigのauth形式へコピーしたり、監視がrefresh tokenを勝手にローテーションしない。**
- CodexBar現行実装も、共有authの更新をCLI所有者へ委譲し、usage pathから共有ファイルを書き換えない方向になっている。
- ネイティブ／legacy／OpenCode由来の認証を一括して扱わない。401になっても別ツールの別アカウントへ切り替えない。

### 3.4 通常の推論応答／セッションログ

- 公式Codexは `x-codex-primary-used-percent`、`x-codex-primary-window-minutes`、`x-codex-primary-reset-after-seconds` 等を読む。secondary、creditsもある。[parser][codex-headers]
- pigのSDKはHTTP `onResponse` とtransport側の `onProviderStreamEvent` を持つ。Codex SSE pathの `onResponse` 呼び出しも確認した。
- `rate_limits.updated` 等のstreamイベントは存在するtransportで別途parseする。WebSocketでHTTP応答ヘッダーが毎turn取れるとは限らない。
- コールバック例外が会話を壊さないよう、軽いパースと非同期publishのみ行う。
- CLI jsonl内のrate-limitイベントは過去の観測であり、常時更新APIではない。他アプリで消費した分を把握できる保証もない。最終観測時刻を保つ。
- CodexBar旧来のPTY `/status` は文字列・画面パース。macOSのSwift/PTY実装をWindowsへ直接移植できず、ConPTYや画面制御コード対応が必要。JSON-RPCより優先する理由はない。

## 4. Claude：実装例は多いが、標準採用を分けて考える

### 4.1 OAuth内部API

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <Claude OAuth access token>
anthropic-beta: oauth-2025-04-20
```

CodexBar、Piメーター、TokenMeter等に実装がある。
`five_hour`, `seven_day`、プラン／モデル別window、extra usage等が返る例がある。

- JSONの `utilization` は通常0–100の**使用率**。後述のunified headerの0–1と取り違えない。
- `resets_at` はISO日時。nullや欠けたwindowを0%として扱わない。
- 現行CodexBarは `user:profile` 権限不足と一般403を区別し、429/`Retry-After` を処理する。
- pig SDKのAnthropic OAuth要求scopeにも `user:profile` は含まれる。ただし**scopeがあることは使用量APIの公開保証や第三者利用許諾を意味しない**。
- 複数アカウント／複数ツールのpollが同じ上限を共有する可能性がある。再起動・手動更新でbackoffを破らない。
- 外部Claude Codeの認証を読むだけのメーターはrefreshしない方が安全。一方、pigが正当に所有する認証なら既存の所有者が更新する。全Providerに一律の「読み取り専用だから更新禁止」を適用しない。

### 4.2 通常推論のunified headers

例:

```text
anthropic-ratelimit-unified-5h-utilization
anthropic-ratelimit-unified-5h-reset
anthropic-ratelimit-unified-7d-utilization
anthropic-ratelimit-unified-7d-reset
```

utilizationは0–1、resetはUnix秒として扱う実装例。文書化された一般REST契約ではない。
既に実行したリクエストの応答だけを観測すれば追加消費しない。**ヘッダーのために空の推論を送らない**。

### 4.3 公式status-line出力

[公式status-line資料][claude-statusline]には次が明記されている。

```text
rate_limits.five_hour.used_percentage
rate_limits.five_hour.resets_at
rate_limits.seven_day.used_percentage
rate_limits.seven_day.resets_at
```

Pro/Max/Ultra等の対象環境でも**sessionの最初のAPI応答後**にしか出ず、windowは独立して欠ける。
resetを過ぎるとClaude Code自身もそのwindowを落とす。

- 公式Claude Codeを普段使う人向けの「最後に観測した値」取り込みなら現実的。
- 常時pigだけを使うユーザーの能動照会にはならない。
- 既存status-lineコマンドを勝手に置き換えない。明示的な導入・既存表示へのtee・出力サイズ制限・atomic fileが必要。
- TokenMeterのWindows実装にもstatus-line snapshot fallbackがある。macOS Keychainの読み方を移植する必要はない。

### 4.4 CLI `/usage` とWeb API

- CodexBarにはPTYで公式Claude CLIの `/usage` を読む実装がある。status-lineより能動的だが、trust画面・更新案内・認証待ち・終了処理・バージョン差の管理が必要。
- Webでは `claude.ai/api/organizations/<org>/usage` などをsession Cookieで読む方法がある。
- Cookie/ブラウザアカウントとpig OAuthアカウントを一致確認できない状態で結果を混ぜない。

### 4.5 採用判断

[現行認証ポリシー][claude-legal]は第三者アプリによるClaude.aiログインの提供、ユーザーのサブスク資格情報によるリクエスト中継、資格情報の収集・保存・介在を制限している。
未改変Claude Codeを本人の認証で使うこととは区別される。

この規約が読み取り専用メーターの各経路にどう適用されるか、endpoint固有の許諾は確認していない。
**他OSSに実装がある／opt-inにする、だけで規約上の問題が解消するとは扱わない。**

推奨:

- API key利用の公式throughput headersは通常対応。
- Claude Codeの公式出力取り込みは補助連携候補（本人の既存利用の観測）。
- 独自OAuthポーリング／Web Cookieは技術的な実験候補に留め、標準ONにしない。採用前に認証ポリシーを確認する。

## 5. 公開RESTが見つかっていなかったProviderの再評価

### 5.1 Radius：今回は公式APIを確定できた

公式 `@earendil-works/pi-radius` **0.1.19** の配布物が、公開agent guide/OpenAPIへの導線を持つ。
その文書・operation契約を**認証なしで**取得して確認した。

```text
GET https://radius.pi.dev/v1/agent.md
GET https://radius.pi.dev/v1/openapi.json
GET https://radius.pi.dev/v1/meta/operations/billing.balance.read
GET https://radius.pi.dev/v1/meta/operations/budgets.usage.list
```

[残高operation契約][radius-balance]:

```http
GET /v1/organizations/{organizationId}/billing/balance
Authorization: Bearer <token>
```

- 契約上: scope `gateway`、role `owner` / `admin` / `member`、risk `read`。
- 通貨USD。`balance.credit_balance`、`reserved`、`available`、`updated_at`。
- `available = credit_balance - reserved`。契約上、予約精算中は負になることもある。勝手に0へ丸めない。
- pigのRadius OAuthは `gateway offline_access` を要求する。scope上は整合するが、実account/API key種別の権限は別途疎通確認する。
- org IDは選択済み組織／認証コンテキストから解決する。メールから推定しない。

[予算operation契約][radius-budget]:

```http
GET /v1/organizations/{organizationId}/budgets/usage
```

- `five_hours`, `day`, `week`, `month`。
- `perMember` / `shared` を区別し、`limit` / `used` / `resetAt` を返す。
- 管理者は既定でaverage viewになる場合がある。本人の残枠と平均を取り違えない。`selection=principal` と本人のprincipal IDを契約に従って選ぶ。
- `used: null` / `resetAt: null` を未提供として保持。%や外周を捏造しない。

**初期版の有力対象へ格上げ。** 金銭残高と本人／共有の予算は別metricとして扱う。

### 5.2 OpenAI ChatGPT (`openai`)：新しい実験例はあるが、Codexの数字は代入しない

通常のAPIキーProvider (`openai-api`) ともCodex (`openai-codex`) とも別。

Pi拡張の[companion実装][pi-chatgpt]では、別途ログインしたCodex OAuthを用いて:

```text
GET /backend-api/wham/usage/chatpass/apps
GET /backend-api/wham/usage
```

を読む。`openai` 側のnative OAuth tokenをWHAMへそのまま送る実装ではない。

- apps一覧からnative登録の `clientId` に一致する唯一のappを確認。
- `allowed_usage_percent` はappへの許容割合（cap）であって、残量ではない。
- ソース自身が「appの%はUIと独立検証できていない」「registration一致は独立した本人証明ではない」と明記する。
- 同じメールでログインしたつもりでもworkspace違いがあり得る。native grantとcompanion側のaccount/userを確実に照合できない場合は表示しない。
- **公開された照会APIとは言えず、前回の『公開API未確認』は変わらない。** ただし技術的な候補が全くないわけではない。

初期版では非表示。実験するなら計測値の意味とaccount照合を先に検証し、CodexのquotaをChatGPT枠としてコピーしない。

### 5.3 OpenAI API：旧billing endpointを使う他実装の実態

CodexBarとTokenMeterに次のfallbackがある:

```text
GET https://api.openai.com/v1/dashboard/billing/credit_grants
```

- CodexBarは「現在の公開API reference外」「older user API keysのbest-effort」と明示。
- TokenMeterは通常キーで駄目な場合に専用ブラウザprofile/CDPからDashboard側のAuthorizationとorganization headerを取得する実装を持つ。
- つまり「普通のAPI keyだけで公式残高APIが使える」という証拠にはならない。Webセッション取得・有効期限・organization一致確認が追加される。
- 公式Admin `/v1/organization/costs` / `/usage/completions` はusage/costであり、プリペイド残高ではない。
- projectのrate-limit capを組織全体の上限として使わない。CodexBarにもこの区別の修正がある。

初期版は公式ヘッダーのみ。旧billingとWebセッションは標準fallbackにしない。

### 5.4 Google：AI Studio / Gemini CLI / Gemini Webを分ける

- pig標準の `google` はGemini APIキー。`usageMetadata` は1回分の消費で、アカウントの残枠ではない。
- Cloud Quotas / Monitoring / Billingは追加Cloud認証とIAMが必要。API keyだけで残プリペイド金額を返す公式経路は引き続き確認できなかった。
- [Gemini CLI公式ソース][gemini-source]の `retrieveUserQuota` はCode Assist側のOAuthで呼ぶもの:

```text
POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
{ "project": "<Code Assist project>" }
```

  `remainingFraction`, `resetTime`, `modelId` を返す。**AI Studio APIの残枠として使えない**。resetだけではwindow長も分からない。
- CodexBarはGemini CLIとGemini appを別ソースにしている。CLIではプラン／アカウント対象が変わっており、すべての個人アカウントに使えると仮定しない。
- Gemini WebにはCookieで内部GraphQL persisted queryを読む実装例がある。appの5時間／週枠であって、APIキーの枠ではない。query signatureへの依存もある。

現状のpig標準 `google` に別のGoogleログインのquotaを自動で紐づけない。

### 5.5 Copilot：通常の接続で取れる候補があるが、token種別と新旧課金に注意

```text
GET https://api.github.com/copilot_internal/user
```

CodexBar、OpenCode plugin、CopilotChat.nvim等で確認。
`quota_snapshots`（premium/chat/completions）、`percent_remaining`、`quota_reset_date` 等。

重要なpig固有差分:

- pi-aiのCopilot credentialの `access` は短命なCopilot推論token。
- `refresh` フィールドには長命なGitHub OAuth tokenを保持する実装。
- GitHub APIを読むときに推論tokenを誤送信しない。単なる `getAuth().apiKey` では足りず、Host側のprovider固有credential解決が必要。
- EnterpriseのGitHub host・issuer・accountを維持し、public GitHubへ勝手にフォールバックしない。

公式Billing APIもあるが、追加billing read権限と本人／組織scopeを確認する必要がある。
新しいAI Creditsの使用額に対する**含有枠の分母**が取得できないケースをCodexBarも扱っている。
その場合「usageしかない」のでリングを描けない。plan名から固定の分母を埋めない。
`chat` と `premium` に同じpoolが載る場合は加算しない。

内部API adapterとしては有力。新旧課金レスポンスのfixtureを別々に持つ。

### 5.6 MiMo / Xiaomi Token Plan：Windows実装はあるがCookie連携

CodexBarとTokenMeterは `platform.xiaomimimo.com/api/v1` 以下のbalance / token-plan detail / usageを使う。
認証は `api-platform_serviceToken` と `userId` 等のWeb Cookie。

- pigの通常推論APIキーだけで同じ照会ができるという根拠は今回も得られなかった。
- TokenMeterは専用Chrome profileを起動しCDPでCookieを取得する。WindowsのブラウザCookie暗号化を回避するためにも重い追加機構になる。
- ブラウザの全Cookieを回収する実装は模倣しない。採用するなら専用profile、対象originだけ、明示的ログイン、最小保存範囲を設計する。
- AMS / CN / SGPは推論hostの違いだけでなく、課金・アカウント対応の検証が必要。
- ローカルsessionのtoken合計をquotaに見せるfallbackは不採用。CodexBarもlocal accountingを実quotaと区別している。

初期版は非表示。将来、利用希望が多ければブラウザセッション連携として別枠で実装する。

### 5.7 OpenCode GoとZen

- OpenCode本体は `GET /zen/go/v1/usage` を使い、bearer tokenに加えて `x-opencode-org-id` を渡す。
- 現行公式・他ツールには `/inference/go/v1/usage` への移行情報もある。**URLだけで新旧を決め打ちしない**。originとworkspaceを維持した互換アダプターが必要。
- 返却windowはrolling/weekly/monthly、`status`, `percent`, `resetsAt`。%の意味をschema/fixtureに基づき確認する。
- Consoleには予算API `/api/policies/current-budgets` があり、member個人に適用される予算を読める。service accountの403は「予算0」ではない。
- CodexBarのZen残高はConsole session Cookieと `GET /console/api/billing/status` 等に依存。Goのquota APIが使えるからZen残高も同じキーで取れる、とはしない。

### 5.8 Qwen / Kimi / Meta / Grok

- **Qwen Token Plan**: [公式 `bl usage token-plan --output json`][qwen-cli] が候補。今回取得した文書は `bl 2.8.0` を基準としている。推論APIキーではなくCLI側の管理認証／AccessKey署名等を要する構成があり、4つの地域・個人プラン全部で「今のキーを送るだけ」とは言えない。CodexBarはCLIとpersonal console Cookie等を使い分ける。
- **Kimi Coding**: [公式ローカルserver][kimi-server]の `GET /api/v1/oauth/usage` はquotaとbooster walletを返す。localhost API自体にも認証が必要で、標準port固定・無認証と仮定しない。上流エラーがHTTP成功envelope内の `kind: error` になるため200だけで成功判定しない。hosted `/coding/v1/usages` はPi拡張にもあるが、legacy/experimental扱いとして別adapterにする。
- **Meta**: 公式 `muse usage` をCLI連携候補に維持。JSON schema、ログインidentity、CLI版の確定が必要。今回pig認証との互換を実機確認していない。
- **Grok / xAI**: CodexBarには `grok agent stdio` のACP `_x.ai/billing`、CLI proxy `/v1/billing?format=credits`、Web gRPC fallbackがある。**GrokサブスクOAuthとxAI推論／Management keyは別**。pigの `xai` にGrokサブスク残量をそのまま対応付けない。API残高ならManagement API + team IDが正規候補。

### 5.9 その他の「未確認」は未確認のままにする

NVIDIA、Ant Ling、Cerebras、TypeSafeでは、公開文書・今回読んだメーターの範囲から、通常キーで正確なaccount残高を読む契約を確認できなかった。
usage token数や402/429、価格表、ローカル積算があっても代用しない。

ただし「APIが存在しない」とは断定しない。Radiusのように公開contractから発見できるものもあるため、要求に応じて追加調査する。

## 6. 通常APIキーで始めやすいもの／追加確認が必要なもの

### 6.1 小さなHTTP adapterで実装しやすい

| 対象 | 読取 | 返却値・注意 |
| --- | --- | --- |
| DeepSeek | `GET https://api.deepseek.com/user/balance` | `balance_infos` の通貨別decimal文字列。付与分・入金分とtotalを二重加算しない |
| Moonshot国際/CN | `GET https://api.moonshot.ai/v1/users/me/balance` / `.cn` | `available_balance` を優先し、cash/voucherの独自合算を避ける |
| Vercel Gateway | `GET https://ai-gateway.vercel.sh/v1/credits` | `balance` / `total_used` / 任意の `token_pass.remaining,resets_at`。passと現金を合算しない。totalがなければpassの%は作れない |
| OpenRouter | `GET https://openrouter.ai/api/v1/key` | 自分のkeyの `limit_remaining` 等。**アカウント残高ではない**。上限未設定を残額0と扱わない |
| MiniMax global/CN | `/v1/token_plan/remains` または `/account/query_balance` | 公式CLIは `sk-api-` と他の認証を区別。地域の正しい公式API originを使う。Web Cookieのconsole endpointと混ぜない |
| Z.ai / 中国版 | `/api/monitor/usage/quota/limit` | 公式plugin実装に根拠。`Authorization` は公式pluginと同じ形式で。値の単位・個人/チームscopeを維持 |

OpenRouterのアカウント残高は別の `/api/v1/credits`。今回読み直した公式資料にもmanagement key必須の403が記載されている。
同一レスポンスの公式credit総額と使用額から残りを求める場合は、そのendpoint契約に基づく残高であり、pig内の推論ログだけから推定することとは違う。

MiniMaxの[公式 `resolveQuotaCounts`][minimax-counts]は、`current_interval_usage_count` が旧応答ではremaining、新応答ではusedとなる問題を扱う。
明示的 `remaining_percent` と整合する方を選び、矛盾時は値を落とす。percentがない場合のlegacy扱いも含め、公式fixtureをテストにする。
他拡張には `usage_count` を常にusedとみなすコードもあるため、無批判に移植しない。

### 6.2 Mistral：直接HTTPを追加確認（こちらを優先）

**追調査で公式Vibeの直接HTTP実装を発見した。MCP必須ではない。**
詳細・スキーマ・制約は [§11](#11-mistralのmcp不要な取得経路追加発見) を参照。
以下は先に調べたMCP経路についての記録で、今後の第一候補は直接HTTP。

[公式文書][mistral-mcp]を再取得し、以下を確認できた。

```text
https://api.mistral.ai/mcp
Streamable HTTP
Authorization: Bearer <MISTRAL_API_KEY>
```

Billing能力は、orgのplan、API/Vibeのincluded budget残量、PAYG spend/limit。
通常のworkspace-scoped keyが持つ権限で動く。**具体的なtool名・入出力schemaは認証後の `tools/list` で提供**され、公開ページに固定列挙されていない。

- 接続→initialize→tools/listまでの読み取り疎通が次の検証点。
- toolを説明文だけで動的に選んで呼ばない。確認済みの読み取りtool名/schemaをallowlist化し、変更時は停止する。
- MCPサーバーはdeploy/delete等の書込toolも持つため、監視が汎用agentへ「請求を調べて」と委譲する設計は不適切。
- `readOnlyHint` だけを安全性の根拠にせず、引数・出力・副作用を確認する。
- CodexBarのMistral実装はMCPではなくWeb Cookie。billing usage、subscriptionページ、credits endpoint等を組み合わせる。これはfallbackの技術的参考であり、MCP schemaが判明した証拠にはならない。
- 含有予算のリセットを月初と決め打ちしない。実際のbilling period start/endがあれば外周に使い、なければ外周なし。

**優先度は高いが、「すぐGETを書けば完成する対応」とは数えない。**

## 7. 標準44 Provider IDの実装方針一覧

`builtinProviders()` を今回も認証なしで列挙して **43 ID** を再確認。
pig追加の `openai-api` と合わせて44 ID。認証方式・地域・契約差をひとつの「対応率」に丸めない。

記号: **公**=公式文書/公開contract、**源**=公式実装から確認、**実**=他OSSの内部API実装、**保**=account残量の経路未確定。
この表は実装候補の分類であり、pigでの疎通済みを意味しない。

| ID | 初期取得候補 | 採用上の条件 |
| --- | --- | --- |
| `openai-codex` | 源/公 HTTPまたはapp-server | 既存OAuth、account固定。RPC external-tokenはexperimental |
| `openai` | 実 companion endpoint | 別Codex認証・登録照合・本人確認が未解決。初期非表示 |
| `openai-api` | 公 応答ヘッダー | 短期制限のみ。残高は旧/実験経路で初期非対応 |
| `anthropic` | 公 API key headers / 公 CLI出力 / 実 OAuth | サブスク内部照会の採用はポリシー確認後 |
| `mistral` | 公 MCP Billing | tool名/schemaとキー権限の疎通が先 |
| `github-copilot` | 実 internal user / 公 Billing | GitHub tokenとCopilot tokenを区別、新旧課金 |
| `deepseek` | 公 balance | 通常キー、通貨別 |
| `moonshotai` | 公 balance | 通常キー、Kimi Codingと別 |
| `moonshotai-cn` | 公 balance | 中国host、通貨別 |
| `vercel-ai-gateway` | 公 credits | team scope、passは別metric |
| `openrouter` | 公 key budget / 公 credits | account残高にはmanagement key |
| `radius` | 公 balance / budgets usage | 今回operation確定。org/principalと権限確認 |
| `minimax` | 源/公 quota・API balance | 認証種別、schema世代差 |
| `minimax-cn` | 源/公 quota・API balance | 中国originと認証種別 |
| `zai` | 源 quota monitor | Coding PlanとPAYGを分ける |
| `zai-coding-cn` | 源 quota monitor | 中国host・個人/チーム別 |
| `kimi-coding` | 公 local CLI / 実 hosted | ローカル認証・quota/booster、実験endpoint |
| `meta` | 公 CLI / 公 API headers | CLIのidentity/schema確認が必要 |
| `qwen-token-plan` | 公 CLI | 管理認証と国際プランの互換を確認 |
| `qwen-token-plan-cn` | 公 CLI/管理API | AccessKey署名等、推論キーと別 |
| `qwen-token-plan-individual` | 公 CLI候補 / 実 console | 個人プランの対応確認、Cookieは初期外 |
| `qwen-token-plan-individual-cn` | 公 CLI候補 / 実 console | 同上。no-dataと0を区別 |
| `xai` | 公 Management balance / 源 Grok CLI | API残高とGrokサブスクは別認証・別metric |
| `google` | 公 Cloud管理 / 実 Web等 | API key単独ではaccount残量なし。CLI枠を転用しない |
| `google-vertex` | 公 Quotas/Monitoring/Billing | IAM追加。DSQでは固定残枠がない場合あり |
| `amazon-bedrock` | 公 Quotas/CloudWatch/Billing Credits | IAM追加、AWS全体creditsとBedrock割当を区別 |
| `azure` | 公 headers / ARM/billing | Entra追加、creditsは契約依存 |
| `cloudflare-ai-gateway` | 公 billing balance | account IDとread権限token |
| `cloudflare-workers-ai` | 公 quota仕様 / 統合課金 | 日次Neuronsの正確な残量取得は未確定 |
| `groq` | 公 headers | requests RPDとtokens TPMを分ける |
| `baseten` | 公 headers/usage/cost | 残高とは別。workspace権限 |
| `fireworks` | 公 headers/quota/billing | remaining欠落あり。現金残高未確定 |
| `together` | 公 usage費用（beta） | 有効化・遅延、残高未確定 |
| `huggingface` | 公/実 billing usage | billing read。walletはWeb本人確認＋Cookie |
| `cerebras` | 保 account残量 | console/usageとaccount残高は別。初期非表示 |
| `nvidia` | 保 account残量 | trial説明から残creditsを仮定しない |
| `opencode-go` | 源/公 Go usage | API経路移行、org・member scopeを維持 |
| `opencode` | 源 Console予算 / 実 billing session | API key/OAuth/console Cookieの種類を区別 |
| `xiaomi` | 実 console balance | Cookie追加。初期非表示 |
| `xiaomi-token-plan-ams` | 実 console quota候補 | 地域・account対応を要検証、初期非表示 |
| `xiaomi-token-plan-cn` | 実 console quota候補 | 同上 |
| `xiaomi-token-plan-sgp` | 実 console quota候補 | 同上 |
| `ant-ling` | 保 account残量 | usage/402/consoleだけでは残量としない |
| `typesafe` | 保 account残量 | 公開indexのrequest usageはaccount quotaではない |

Cloud管理系など前回の公式一覧を踏襲する行は、今回その全APIを実accountで再検証したわけではない。
カスタムProviderは追加のadapter契約がなければ自動対応させない。

## 8. pigの実装構成案

### 認証を監視機能が乗っ取らない

- Backend/Hostのみがcredentialにアクセス。RPC/WebViewへtoken・Cookie・生responseを送らない。
- **provider + account + org/project + auth方式** をsnapshotの所有キーにする。
- shared default authと追加accountをそれぞれ列挙し、会話中の選択を変更せずに取得する。
- refreshは既存ロックに委ねる。token自体をcache keyやログにしない。
- Copilotのようなprovider固有credential参照は狭いHost interfaceに閉じる。
- CLIのネイティブログインを表示する場合は、pig-owned accountとは別sourceにする。
- custom base URLのAPI keyを公式domainへ自動転送しない。公式OAuthを任意のmodel base URLへも送らない。
- endpoint/issuerを固定・検証し、redirectでAuthorizationを別originへ送らない。backend routingが必要なProviderは公式契約を別途扱う。

### adapterが返す最小データ

```ts
interface UsageSnapshot {
  providerId: string;
  accountId: string; // pigの内部ID。生tokenではない
  scope: { organization?: string; project?: string; region?: string };
  source: "official-api" | "official-cli" | "official-source" | "internal-api" | "response";
  observedAt: number;
  windows: Array<{
    id: string;
    label: string;
    usedPercent?: number;
    remainingPercent?: number;
    used?: string;
    remaining?: string;
    limit?: string;
    resetsAt?: number;
    windowDurationMs?: number;
    startsAt?: number;
  }>;
  balances: Array<{ id: string; amount: string; currency: string }>;
  // tickets/spend/key budgetは別metric。金銭残高へ混ぜない。
}
```

- adapter内で秒・ms・ISOを正規化する。decimal文字列と独自Creditsの単位を維持。
- 表示設定はprojectionだけに適用。rawのused/remainingを切り替えるための再取得は不要。
- 2リングの対象windowは安定したIDで決める。「常に少ない順でリング位置を入れ替える」と短期/週間の読み方が崩れる。
- 数値のheadlineは選択中の最も厳しいwindowなど、対象をtooltipで明示。
- window長・開始時刻不明なら外周はunknown。fixed window / calendar period / continuous refillを区別する。
- 金額だけ、使用額だけ、分母なし、unlimited等のProviderに偽のリングを付けない。

### 常設UIの更新

- UI描画はcacheを読むだけ。sidebar render・chat open・scrollのたびに全社照会しない。
- アプリ単位の監視serviceがaccount別single-flightと同時実行上限を持つ。複数windowでpollerを増やさない。
- 表示中・接続中だけ低頻度poll。初期案は通常HTTP 2–5分＋手動更新だが、Providerが許容する間隔の保証ではない。まず各APIで検証する。
- 秒表示や外周アニメーションの更新はローカル時計だけで行い、ネットワークを毎秒呼ばない。
- 429/`Retry-After`（秒/HTTP date）でbackoff。0秒指定やheader欠落でも最低cooldownを置く。手動更新で突破しない。
- 401は所有者によるrefreshを最大1回程度に制限し、反復する401/403は停止。疎通失敗で会話を失敗させない。
- 最終成功値とその `observedAt` を保持。エラー後に「今更新済み」にしない。
- resetを過ぎても残量100%に書き換えない。外周は期限到達として扱い、次の取得で確認する。

### 実装順

1. **共通データ型・account固定の認証解決・cache/poller・18px UI接続**。
2. **Codex直接HTTP、DeepSeek、Moonshot、Vercel、OpenRouter key budget**。
3. **Radius公式残高/本人予算、MiniMax、Z.ai**。
4. **Mistral MCP schemaの読み取り検証**（必要なら2と並行）。
5. **Codex app-server external token連携、Copilot、Go、Kimi**。
6. **通常の応答ヘッダー観測**。RPM/TPMは契約枠と別名で表示。
7. Claude公式出力／Qwen/Meta/Grok CLI／Cloud管理連携は、本人確認と導入コストを含めて個別判断。
8. Cookie・Web scraping・ChatGPT companion・旧billing fallbackは標準版から分離する。

### 実装時に固定すべきテスト

- public fixture＋匿名化した承諾済み実レスポンス。source commit/CLI version/取得時点を記録。
- Codex: single/multi bucket、追加モデル、null window、チケットcountのみ、expiry、401、account途中変更、CLI非対応。
- Claude: JSON利用率とheader利用率の単位差、window欠落、429、profile scope不足。
- MiniMax: usage_countがremaining/usedの両方、explicit percentとの矛盾、0、契約外モデル。
- Copilot: GitHub/Copilot token取違え、新旧課金、分母不明、enterprise issuer。
- Radius: reserved/available、負残高、member本人/average/shared、missing reset、permission denied。
- Mistral: tool schema変更・write tool混入・partial budget・billing period不明。
- 金額0、枠不明、unlimited、stale、permission denied、unsupportedを別状態にする。
- ネットワーク・監視エラーがチャット開始/送信のcritical pathへ伝播しない。

## 9. 残っている検証と境界

- 上記は**文書・ソース調査**。pigの残量取得adapterはまだ0件、実残量の取得確認も0件。
- Mistralはtools/list/schema、Codexはpig tokenでのHTTP疎通または対応CLIでのexternal auth、Radiusはorg解決と実際の権限が次の検証点。
- 複数社を無断でまとめて試さず、実装対象ごとに接続・accountを確認する。課金操作・チケット消費・推論は行わない。
- 今回の変更は調査文書のみ。既存の多数の未コミット変更やStorybook試作は変更していない。コードテストはこの調査に対しては不要。

## 10. 方針確定とOpenCodex／Claude CLIの追加確認

ユーザーとの確認:

- Codexは**pig所有OAuthを使う直接HTTP**で進める。
- Claudeは、利用条件の不確実さを説明したうえで、ユーザーの最新方針として**OAuthによる使用量HTTP照会**を採用する。通常応答ヘッダーも補完に使う。これはendpointの公式許諾を確認できたという意味ではない。
- PATHに公式Claude CLIがある場合の `/usage` 読取は、引き続き補助経路として検討する。

### Claude CLIがあれば `/usage` を使えるか

**技術的な実装例がある。PATHにあるから不可能、ということではない。**
ただし `/usage` は一般的な「必ずJSONを返す一回実行CLI API」ではなく、interactive commandとして扱う必要がある。

CodexBarの当該commitには2経路がある:

1. PTYで `claude` を起動し、`/usage` を送信して描画済み画面をparse。
2. PTY timeout等の場合、通常のsubprocessで次を実行しstdoutを同じparserに渡すfallback。

```text
claude --strict-mcp-config --settings '{"remoteControlAtStartup":false,"disableAllHooks":true}' /usage
```

これはCodexBarが配列argvで実行する内容の表記であり、そのままWindows shellへコピーするためのquotingではない。
`--print` や「調査用prompt」を渡す方式ではない。
source: [direct fallback][cb-claude-direct] / [PTY flow説明][cb-claude-pty]。

pigでの案:

- PATHから実体を解決し、version／利用可能な起動flagsを確認。
- 既存CLIの本人ログインを使う。pigからrefresh tokenをコピーしない。
- サブスク利用か、pigで表示するaccountと同じかを確認。照合できなければ「Claude CLI」の独立sourceとして表示する。
- 明示的な「CLIから更新」で非PTY方式の対応を先に検証。非対応版でstdoutが空でも0%にしない。
- 必要ならWindows ConPTYでPTY方式を追加。すでにあるCLIを使うのでClaudeの追加インストールは不要だが、pig側にPTY実装が必要。
- 専用cwd、hooks/MCP/remote control抑制、timeout、process cleanupを用意。ユーザーのプロジェクトを自動trustしない。
- 最初から全accountを毎分CLI起動でpollしない。CLIが別accountに切り替わったら古い紐づけを無効化する。

PATH上のCLIの実行や認証確認は今回行っていない。Windows実機でのnon-PTY出力／ConPTY挙動は次の検証点。

### 「OpenCodex」は別プロジェクトもあるため区別

追加で2リポジトリを取得して実装を確認した（実行・依存インストールはしていない）。

**`lidge-jun/opencodex`**、commit `95bb715bdb8598866f7e56ef395ee0a4d49a80ae`:

- [Codex quota query][ocx-codex-query] は `GET https://chatgpt.com/backend-api/wham/usage` を直接fetch。single-flight／backoffを持つ。
- [Claude usage][ocx-claude-query] は `GET https://api.anthropic.com/api/oauth/usage` を直接fetchする。
- **`claude-cli-usage.ts` という名前でも、CLIの `/usage` コマンドを実行しているわけではない。** access tokenを渡した内部HTTP照会で、User-Agent等も付けている。
- 従ってこのClaude実装を採用すると、今回選んだ「ヘッダー基本」ではなく、内部OAuth APIを能動的にpollする方針になる。
- endpointの存在は確認できるが、他OSSによるCLI風のheader設定をpigへ模倣することは推奨しない。

**`RyensX/OpenCodex`**、commit `f9c471618551052ca98b86c9bdc5a22c0ee006bf`:

- Codex Desktopの公式runtimeを利用する別の構成。
- [transport][ryensx-transport] は `account/rateLimits/read` を独立read methodとして扱い、[runtime hook][ryensx-runtime] は公式app-server起動を仲介する。
- 全Providerの残量を独自RESTで収集する実装としては扱わない。

**OpenCodeのことだった場合**:

- 先の調査の通り、本体のusage機能はConsole/Go予算が中心。
- `opencode-usage-plugin` のCodex対応はWHAM直接HTTP。Claudeの取得コードはあるがregistryでの有効列挙は別なので、ファイルの存在だけで本体の標準対応とみなさない。

## 11. MistralのMCP不要な取得経路（追加発見）

ユーザー指定により、今回の実装対象から xAI/Grok、Google/Vertex/AWS/Azure、MiMo、OpenCode Zen残高、Hugging Face wallet、OpenAI API、NVIDIA/Ant Ling/Cerebras/TypeSafe は一旦外す。
§7の全件表は調査結果として残すが、対応予定を意味しない。

### 公式Vibeの直接Billing HTTP

`mistralai/mistral-vibe` commit **`b20313e01d6926d4191da89c32d5da11e3a0a060`** を取得して確認した。
[公式 `_billing.py`][vibe-billing] が次の実装を持つ:

```http
GET https://api.mistral.ai/v1/billing/budget
Authorization: Bearer <Mistral platform credential>

GET https://api.mistral.ai/v1/billing/subscription
Authorization: Bearer <Mistral platform credential>
```

- `BudgetResult.vibe_budget` に `usage_percentage`, `initial_budget`, `reset_at`, `payg_enabled`。
- `SubscriptionResult` に `plan_name`, `vibe_payg_enabled`。
- `usage_percentage` は使用率。100を超える応答も公式testにある。表示上のringはclampしてもrawを失わず、PAYG時の超過を「利用停止」と扱わない。
- `reset_at` は任意。期間開始/長さはこのモデルにないため、**この応答だけで月次windowの外周比率は確定できない**。月初・30日固定を仮定しない。
- Billingクライアントはplatform credentialで認証し、[API key用実装][vibe-api-key-auth]では `Authorization: Bearer <api_key>` を使う。MCP・CLI起動・Cookieは不要。
- `/budget` に **`see_org_inference_usage`** 権限が必要と公式sourceが明記。403は権限不足として扱う。
- 公式VibeのUIはVibe keyのchat plan／Mistralモデルでbudgetを表示し、通常API/Codestral key等では表示を抑制する。すべてのMistral APIキーでVibe枠が返る、とはまだ断定しない。
- self-hosted等にはAPIがない場合があり、404・malformed response・欠落budgetを0%にしない。
- 公式実装は3秒timeout、subscriptionとbudgetを並列取得し、片方の失敗でaccount全体を壊さない。

[公式test fixture][vibe-billing-tests] には `api_budget` と `currency` もあるが、CLIの `BudgetResult` は `vibe_budget` のみをモデル化している。
Vibe以外の予算まで対応する場合は、APIの実応答または契約を別途確認する。

**前回の「MistralはMCP schema確認待ち」という説明は調査不足だった。**
Vibe使用率はMCP以外でも公式クライアント実装から取得方法・field名を確認できた。
ただし今回確認したのは公式ソースとmock testで、pigの実キーでの成功ではない。公開REST referenceの安定契約と同一視もしない。

### 残る検証／実装方針

- pigのMistral adapterはまず直接Billing HTTPを実装する。
- 対象キーのプラン・組織と `see_org_inference_usage` 権限を疎通で確認する。
- `vibe_budget` と使用率・resetを表示。初期予算が0以下なら%の有効性を検討し、無条件にfull capacityにしない。
- account全体の金銭残高とVibe月次予算を混ぜない。
- MCPは必要な値が直接APIにない場合の補助候補とし、必須にはしない。

## 参照（主要な固定リンク）

[vibe-billing]: https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/vibe/app_server/_billing.py
[vibe-api-key-auth]: https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/vibe/core/platform_auth/_api_key.py
[vibe-billing-tests]: https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/tests/app_server/test_billing.py
[ocx-codex-query]: https://github.com/lidge-jun/opencodex/blob/95bb715bdb8598866f7e56ef395ee0a4d49a80ae/src/codex/quota-query-backoff.ts
[ocx-claude-query]: https://github.com/lidge-jun/opencodex/blob/95bb715bdb8598866f7e56ef395ee0a4d49a80ae/src/providers/claude-cli-usage.ts
[ryensx-transport]: https://github.com/RyensX/OpenCodex/blob/f9c471618551052ca98b86c9bdc5a22c0ee006bf/gateway/runtime/model-router/transport.cjs
[ryensx-runtime]: https://github.com/RyensX/OpenCodex/blob/f9c471618551052ca98b86c9bdc5a22c0ee006bf/gateway/runtime/ipc/official-runtime.cjs
[cb-claude-direct]: https://github.com/steipete/CodexBar/blob/7447bc77c2497323d9c41e40164ce705533493c8/Sources/CodexBarCore/Providers/Claude/ClaudeUsageFetcher.swift#L1189-L1197
[cb-claude-pty]: https://github.com/steipete/CodexBar/blob/7447bc77c2497323d9c41e40164ce705533493c8/docs/claude.md#cli-pty-fallback
[codex-app-server]: https://learn.chatgpt.com/docs/app-server
[codex-release]: https://github.com/openai/codex/releases/tag/rust-v0.167.2
[codex-rpc-source]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server/src/request_processors/account_processor.rs
[codex-login-schema]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server-protocol/schema/typescript/v2/LoginAccountParams.ts
[codex-http-source]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/backend-client/src/client/rate_limit_resets.rs
[codex-headers]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/codex-api/src/rate_limits.rs
[cb-codex]: https://github.com/steipete/CodexBar/blob/7447bc77c2497323d9c41e40164ce705533493c8/docs/codex-oauth.md
[cb-codex-fetcher]: https://github.com/steipete/CodexBar/blob/7447bc77c2497323d9c41e40164ce705533493c8/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift
[oc-limits]: https://github.com/anomalyco/opencode/blob/3d308eae2e68dc39dfc12aba9dd408f9ce1cc0a1/packages/core/src/usage-limits.ts
[oc-plugin]: https://github.com/IgorWarzocha/opencode-usage-plugin/blob/180282c3624541fd26fcb4d1f264c17e46ac8e59/src/providers/codex/index.ts
[oc-codex]: https://github.com/jasonmit/opencode-codex-usage/blob/1d19d3f9a163b4287dccf9c29cea5f497992037f/lib/codex-usage-probe.ts
[pi-usage]: https://github.com/Hill-98/pi-usage/tree/84c35cc8967dd54a216efd6eb8b98c0213a08eba/src/usage
[pi-codex]: https://github.com/Hill-98/pi-usage/blob/84c35cc8967dd54a216efd6eb8b98c0213a08eba/src/usage/providers/openai-codex.ts
[pi-chatgpt]: https://github.com/Hill-98/pi-usage/blob/84c35cc8967dd54a216efd6eb8b98c0213a08eba/src/usage/providers/openai-companion.ts
[pi-meters]: https://github.com/Quigleybits/pi-usage-meters/blob/9c97be579a7e4e064e17a3ba27b73af080e3cde9/extensions/core.js
[piquota]: https://github.com/J3pf/piQuota/tree/cc4c27cde89ae28040611a70e3fbe28b57915195/src/providers
[tokenmeter]: https://github.com/zensoku142/TokenMeter/tree/5620b1bf4e4dafe85e40cf9847060a04c1910b6c/api/providers
[gemini-source]: https://github.com/google-gemini/gemini-cli/blob/aeb6c04b093eb00c33585ba587c4889ae4c5e957/packages/core/src/code_assist/server.ts
[minimax-endpoints]: https://github.com/MiniMax-AI/cli/blob/ae29aae57b05c2140c7ea6aba0a852763ffe7859/src/client/endpoints.ts
[minimax-counts]: https://github.com/MiniMax-AI/cli/blob/ae29aae57b05c2140c7ea6aba0a852763ffe7859/src/utils/quota.ts
[zai-source]: https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs
[claude-statusline]: https://code.claude.com/docs/en/statusline.md
[claude-legal]: https://code.claude.com/docs/en/legal-and-compliance.md
[mistral-mcp]: https://docs.mistral.ai/resources/mcp
[radius-balance]: https://radius.pi.dev/v1/meta/operations/billing.balance.read
[radius-budget]: https://radius.pi.dev/v1/meta/operations/budgets.usage.list
[qwen-cli]: https://www.alibabacloud.com/help/en/model-studio/cli/usage-quota
[kimi-server]: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html

通常残高API・Cloud管理APIの公式リンク全件は [前回調査の参照一覧](provider-usage-feasibility.md#参照資料) も参照。
