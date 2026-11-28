# StorybookのDesign System

`mise run storybook` → **Design System** から確認する。

1. **Screens / App**: 全体画面のプレビュー
2. **Domain**: Sidebar・Composerなどの画面を構成する部品と、Provider使用量・モデル選択などの用途別部品
3. **Patterns**: 設定行、共通ページ枠、ツールチップ、画像プレビューなど、繰り返し使う組み合わせ
4. **Primitives**: `mainview/primitives/` の機能に依存しない基本部品（Button・TextFieldなど）
5. **Foundations**: 色・文字・半透明面、出力枠の構成案。**Motion** から採用済みの動きと本番部品の見本を確認できる。

## 本番UIの棚卸し

| 対象 | 整理結果 |
| --- | --- |
| Provider使用量の二重バー | 一覧と詳細の描画を `Domain/UsageMeter` に共通化。塗り・枠線それぞれの割合だけで描画でき、時刻・取得・設定には依存しない。画面での使用例は `Domain/ProviderUsageView`。 |
| テキストのコピー、アーカイブ切替 | Markdownのコード・表、会話、招待コードは `Patterns/CopyButton`。チャット・プロジェクトの一覧切替は `Domain/ArchiveToggle`。 |
| 設定・拡張機能の更新点 | `Domain/IndicatorDot` の差し色表示を再利用。ボタン右上への配置だけをサイドバー側で指定する。 |
| チャット一覧・吹き出し・入力 | `Domain/ChatTextArea`、`Patterns/ChatListRow`・`MessageBubble`・`ComposerForm` をローカル／リモートで共用。`Domain/SessionList`・`ComposerEditor`、`ChatRenderer/Messages/PendingUserMessage`、`Screens/App`・`RemoteChat` で組み合わせと実画面を確認できる。 |
| 既存の共通部品 | `Patterns` に `ColorPicker`・`ContentPage`・`ImagePreview`・`LazyDetails`・`Sheet`・`Tooltip`、`Domain` に `EffortSlider`・`ModelSelect` を単体掲載。 |
| 通知・セッション活動 | `NotificationCenter` と `SessionPanel` の見本を親ページから `Domain` の単体ページへ移動。通知の未読バッジ `CountBadge` も `Domain`。トーストの `Notifications` は履歴とは別ページに掲載。 |
| Composerの件数ボタン | `SessionPanel` と `SessionIndicators` で `Domain/ComposerCountButton` を共用。位置・開閉は既存の `useComposerPopover`、各パネルの内容は呼び出し側に残す。 |
| モデル・新規チャットの接続先Picker | 候補行の配置・選択表示を `Patterns/PickerOption` で共用。検索やキーボード選択、選べない候補の扱いはそれぞれ維持する。 |
| サインイン・PC接続 | `OAuthLoginDialog` と招待・接続・Project選択に使う `Sheet` が `Patterns/DialogFrame` を共用。認証・接続の失敗は `Patterns/ErrorAlert` で表示する。 |

次の候補は、似ている見た目だけで統合せず現行の境界を保つ。

| 候補 | 今回まとめない理由 |
| --- | --- |
| 画像・パッケージコマンドのコピー | 画像を切り替えたときの成功表示や、コマンド全体を押す操作は、テキスト横のアイコンボタンとは異なる。 |
| 不透明度・推論強度・色相のスライダー | 不透明度と色相には連続反映、推論強度には確定時の保存・失敗時の復元がある。 |
| Picker全体・入力要求・出力枠 | フォーカスの戻し先・閉じ方・スクロール上限が用途ごとに異なる。既存の共通CSSは引き続き使う。 |
| `TurnSpinner`・`OrbitTrail` などの内部描画 | `RunningIndicator` 専用の実装として置き、親部品の使用例で確認する。 |

## 境界

- 階層は `Design System / 粒度 / 部品・対象名`。ガイドや分類直下のまとめStoryは置かない。
- `Primitives` は固有の機能を前提にしない基本部品のみ。共有数や部品の大きさではなく用途で分ける。
  Composer専用の操作、プロバイダーのロゴ・利用枠、通知の未読表示などは `Domain` に置く。
- 本番部品はそのままimportして展示する。サンプル操作を通信や設定保存につなげない。
- 共通React部品が存在しないものは「既存CSS」または「構成案」と明記する。
- 構成案のコードはこのディレクトリに閉じる。アプリからimportしない。
- 見本の配置用CSSは `.ds-review`・`.ds-specimen` 配下に閉じる。本番での見た目は部品のCSSに任せる。
- 比較案・未収録の画面・未検証のスマホ動作を、本番対応済みとは扱わない。

レビュー後、責務・API・状態・移行範囲に合意した部品から小さく移行する。
移行前後の見た目・操作・focusを比較し、既存のUIガイドと回帰検査を維持する。
Storybookでの確認は、本番での安全性検証の代わりにはしない。

## 検証

```powershell
mise exec -- bun test ./apps/desktop/src/stories/design-system/catalog.test.ts
mise exec -- bun test ./apps/desktop/.storybook/design-system-ui.test.ts
mise exec -- pnpm test:ui
```

新しいCard・出力枠・ページは、上の描画テストで通常幅・390px幅・文字拡大を確認する。
実セッション、ネイティブウィンドウ、スマホ実機・ソフトキーボードはこの見本の検証対象外。
