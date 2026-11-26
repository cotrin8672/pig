# pig対応Extensionの発見とUI連携

## 実装状況

- Marketplace: 初期表示「pig対応」（`shared/supported-extensions.ts` の静的リスト＋npm情報、取得失敗時は静的項目）、「すべてのパッケージ」で従来検索。対応パッケージに確認版バッジ。インストールは従来どおりlatest。
- 表示: 新しいUI APIは不要だった。既存のSession dock/Panelが `agents` / `schedule` ビューを描画するため、`bun/supported-adapters.ts` の組込みAdapterがユーザーAdapterより前に接続される。提供元はコマンドの `sourceInfo.path` 内の `node_modules/<pkg>/` で確認。
  - Subagent: nicobailon版のセッション単位の公開EventBus RPCでバックグラウンド実行を取得し、フォアグラウンド実行は `subagent` ツールの構造化された進捗・結果を表示する。接続前のフォアグラウンド結果はツール履歴に残る。
  - Schedule: `cron:change` ごとに当該Extensionの保存ファイルを読み取り専用で読み、このセッション＋共有ジョブを表示。「Manage」は `/schedule-prompt` を起動。
  - Ask: 追加実装なし（`ctx.ui.custom()` は既存のTerminalUIHostで描画）。npmの `pi-ask-user@0.17.2` をSDKのローダーで読み込み、pigのExtension UIホストと本番テーマで、選択・自由記入・キャンセル・abortが正しくツール結果に返ることを確認。WebView側の描画とキーボード操作は未確認。
- Storybook: `Settings/Marketplace`、`Design System/Domain/ChatScreen` の SupportedExtensions。
- アイドル休止: 実行中のsubagentや有効な予定のあるセッションは休止しない（休止はExtensionを破棄し、それらを失わせるため）。
- セッションタイトル: `@pi-archimedes/session-name` を「pig対応」に掲載。導入後は設定の「一般」でタイトル用モデルを選べる。設定はPiの共有 `settings.json` の `"archimedes.sessionName".model` に保存する。2.14.0／2.15.0を隔離profileと模擬プロバイダーで確認済み。別モデルで返った日本語タイトルの一覧更新、会話モデルに戻す操作、手動名の保持を確認した。実モデルでの日本語品質は未検証。

以下は当初の計画。

## 製品上の境界

対象は nicobailon版の `pi-subagents`、`pi-ask-user`、`pi-schedule-prompt`。サブエージェント以外のBackground taskは対象外。pigが配布するのは対応情報と表示コードであり、Extension本体ではない。起動・プロジェクトオープン時にインストールしない。他のExtensionを隠したり無効化したりしない。設定の正本、ツール実行、予定の発火は今までどおりExtensionに置く。旧 `@gotgenes/pi-subagents` は既存のインストールを変更しないが、pig専用の活動表示からは外れる。

## 1. Marketplaceを対応版への入口にする

- `apps/desktop/src/bun/packages.ts` の `searchPackages` は、空クエリではnpm検索の先頭1000件を月間DL順にした50件ページ、キーワード検索はnpmの50件ページ。各ページ内部を再ソートしても、1000件外の対応パッケージは出ない。
- `apps/desktop/src/mainview/Extensions.tsx` のMarketplace初期画面を「pig対応」にする。「すべてのpiパッケージ」へ切り替えれば既存検索・ページングをそのまま使える。インストール済みの一覧・更新・削除は対応の有無で絞らない。
- 3件の静的カタログに正確なnpm名・動作確認版・対応内容を記録。「pig対応」内の検索はこのカタログに対して行い、ネットワーク障害時も説明は読める。インストールはユーザーが選んだときだけ既存のpackage操作経路へ。推奨版とnpm latestが違う場合は確認版を明示し、暗黙に上書き・ダウングレードしない。
- カタログ掲載とランタイム有効化を分離。専用表示には、そのセッションで実際にロードされた提供元と検証版を確認する。取得できない場合や同名の別ツールでは通常表示。未検証版は「未検証」であって「利用禁止」ではない。

## 2. UI契約は薄く始める

`docs/session-ui-domains.md` のsources、表示の登録/解除、操作ID・revision・世代チェックと、既存ChatRenderer・ExtensionUIを再利用する。新しいAgent/Task/Scheduler共通型、任意Reactの自動ロード、設定ファイルの汎用エディタは作らない。

最初に不足する表示場所だけ追加する。候補はセッション内のComposer Chip。安定したローカルID・ラベル・任意の登録済み操作IDを持つ宣言的表示とし、名前空間と寿命はHost管理。ボタンから任意のツールを実行しない。1件ならそのまま、増えたら既存Composerのレイアウトに収まる形に集約し、入力欄下に新しい行を作らない。詳細表示は既存surfaceを優先する。最初はpig側連携と信頼済み設定で試し、外部Extension作者向けSDKの固定は後にする。

## 3. 上流ごとの接続試験

| 対象候補（検証開始版） | 初版の完了条件 | 根拠・制約 |
| --- | --- | --- |
| `pi-ask-user@0.17.2` | 既存UIで単択・複数選択・自由記入・取消・abortが正しいtool callに一度だけ返る | pigの `bun/extension-ui.ts` は `custom()` をTerminalUIHostで実装している。RPC fallbackに入る前提を置かず、他Extensionのcustomを無効化しない。専用フォームは初版外。 |
| `pi-subagents@0.89.1` | 既存のSubagents表示で進捗・終了が分かる | セッションごとの公開RPC `status` と `asyncSnapshot` を使い、イベントは再取得のきっかけにする。pigは実行や停止を代行しない。 |
| `pi-schedule-prompt@0.5.1` | 「10分後」「一定間隔」を現在のチャットに登録し、発火先を確認。カードに登録内容を表示。現在一覧・取消は当該Extensionの `/schedule-prompt` のJobsへ | toolのlist結果は取得時のスナップショットでありライブ購読ではない。pigから `tool.execute` を呼ばず、永続化ファイルを編集せず、タイマーを再実装しない。公式な更新経路を確認できなければ次回発火のライブChipは出さない。 |

上流確認先：[Subagent Extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)、[Ask](https://github.com/edlsh/pi-ask-user)、[Schedule](https://github.com/tintinweb/pi-schedule-prompt)。mainと配布版の差があり得るため、実装時は該当npm版をテスト用の隔離profileに導入する。

## リリース順

1. 既存package操作がversion指定を保持するかと、ロード元/版を実セッションから照合できるか確認。Marketplace切替・静的カタログを追加。実機試験が通った組合せだけを「対応」として公開。
2. Askでインストール→有効化→質問→取消→アンインストールを通す。未導入profileにツール・サービス・専用UIが現れないことも確認。
3. Subagentを2セッションで検証し、ツールカードと必要最小限のChipを実装。セッション切替、reload、連携例外、古い操作、配布版更新後も他セッションを操作しないことを試験。
4. Scheduleで単発・反復・取消・busy中の配送・セッション切替・アプリ再起動を検証。停止中の発火や取りこぼし再送はpigとして保証しない。

自動テストはカタログとページングの独立、提供元不一致、対応版/未検証版の区別、イベントの寿命と既定描画へのfallbackを中心にする。Windows配布版では隔離profileによる実パッケージのスモーク試験と、Chip追加時の実描画・キーボード操作を別途確認する。
