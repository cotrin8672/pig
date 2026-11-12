# サブスクリプションの複数アカウント：内部実装

## 境界

- UIは未実装。次はStorybookで見た目を確認し、承認後に本番UIへ組み込む。
- 将来の「Codex Private」「Codex Work」は表示上のグループ。SDKへ渡すProvider IDとモデルIDは常に元の値（例 `openai-codex`）。
- 追加対象は `provider.auth.oauth.isSubscription` が有効なサブスクリプション。APIキーの複数登録、自動ローテーション、上限到達時の別アカウントへのフォールバックはない。
- アカウント分離は認証の選択であり、プロジェクト・ファイル・履歴・拡張機能のセキュリティ隔離ではない。

## 保存と認証

`src/bun/provider-accounts.ts`:

- 既存の既定認証はpi標準の `auth.json` のまま。移動・コピー・形式変更はしない。
- 追加アカウントの名前、元Provider ID、OAuth credentialは `~/.config/pig/provider-accounts.json` に保存。安定したUUIDが識別子で、名前変更では変わらない。
- SDKの `CredentialStore` を実装する `AccountCredentials` が、各ランタイムの選択に応じて保存先を振り分ける。
- ファイルロック中にread-modify-writeを行い、同時refreshの二重実行、refresh後の削除の取り消し、別アカウントへのトークン書き戻しを防ぐ。
- refreshを開始した後のキャンセルでは、ローテーション済みトークンの保存を捨てない。
- 選択された追加アカウントが未認証・削除済みならエラー。`undefined` を返して既定認証や環境変数へ戻すことはしない。
- UIへ返すアカウント情報は `{ id, provider, label, configured }` だけ。トークンは含めない。

既定認証のコマンド解決・ロック等を再実装しないため、`src/bun/sdk.ts` のみにSDK **1.5.2** の内部 `AuthStorage` ローダーを集約している。このバージョンは型定義にクラスがあるが公開exportにはない。SDK更新時には内部ファイルのパスと `CredentialStore` 互換性を確認する必要がある。パッケージは既存のSDK runtime stagingで非バンドル配置される。

## チャット単位の選択

`SessionFlags.accounts` に `{ [providerId]: accountId }` を保持し、pigの `desktop.json` に保存する。

- チャットごとの `ModelRuntime` にそれぞれ独立した選択を渡す。同時に開いている別チャットには影響しない。
- 再オープン・再読み込み・フォークで選択を引き継ぐ。ピン留め・完了通知などの更新で選択を消さない。
- 保存やモデル選択に失敗した場合は、元のアカウント・モデルへ戻す。
- 名前を変えても選択は保持される。サインアウトでは名前とIDを残し、削除ではトークンも消す。
- 選択したアカウント／モデルが使えなくなった場合、勝手に別Provider・別アカウントで再開しない。

**現段階の制限:** user/assistantメッセージがあるチャットではアカウント変更を拒否する。同じアカウントのモデル変更は可能。OpenAIの暗号化推論などのアカウント間再送を実機確認してから、この制限と必要な履歴変換を見直す。

選択はpig固有のメタデータであり、pi CLIへは引き継がれない。CLIで履歴を開くと通常のpi認証が使われる。`desktop.json` を失うとアカウント選択も失われるので、バックアップには両方のpigファイルを含める。

## 本番UI未接続のRPC

| 操作 | パラメーター |
|---|---|
| `createProviderAccount` | `{ provider, label }` → 非秘密のアカウント情報 |
| `renameProviderAccount` | `{ provider, accountId, label }` |
| `removeProviderAccount` | `{ provider, accountId }` |
| `startLogin` メッセージ | 既存引数 + 任意の `accountId` |
| `logout` | `{ provider, accountId? }` |
| `accountModels` | `{ provider, accountId? }` → アカウント認証による利用可能モデル |
| `setModel` | 既存引数 + `accountId?: string \| null` |

`setModel.accountId` は省略するとそのProviderの現在の選択を維持し、`null` ならpiの既定認証を明示的に選ぶ。`ModelSelection` / `Snapshot` に現在の `accountId` を含める。`listProviders()` の追加アカウント情報は `ProviderInfo.accounts` に含まれる。

ログインのキャンセル／サインアウトはアカウント単位。同一ProviderのOAuthブラウザフローはコールバック待受ポートの競合を避けるため直列実行する。

`accountModels` は通信なしで既知のカタログとProviderのcredential filterから一覧を作る。Providerがプラン別のモデル制限を公開していない場合、その制限を独自に推測しない。

## 検証

- `provider-accounts.test.ts`: 保存、名前変更、秘密情報の非公開、個別認証、refreshの排他とキャンセル、削除との競合、ambient fallback禁止、破損ファイルの保全。
- `session-accounts.test.ts`: 模擬サブスクOAuthでログインから送信・選択保存・失敗時の復元・再オープン・フォーク・サインアウトまで実SDKで確認。
- `auth-operations.test.ts` / `desktop-state.test.ts`: アカウント別のキャンセルとProvider別の直列化、他のデスクトップ状態更新との共存。

実際のCodex/Claudeアカウントでのブラウザログイン、プラン差、会話途中の切替は未検証。
