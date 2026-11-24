# Design system review — Storybook only

`mise run storybook` → **Design System** から確認する。

1. **Screens / App**: 全体画面のプレビュー
2. **Domain / Sidebar・ChatScreen・ComposerUI**: 画面を構成する大枠。その配下に個別部品を置く
3. **Patterns**: `mainview/patterns/` の組み合わせ部品（SettingsCard・SettingsRow・ActionsMenu・ConfirmButton・InlineRename）
4. **Primitives**: `mainview/primitives/` の最小部品を部品名ごとに展示
5. **Foundations**: 既存の色・文字・半透明面、出力枠の構成案

## 境界

- 階層は `Design System / 粒度 / 部品・対象名`。ガイドや分類直下のまとめStoryは置かない。
- 本番部品はそのままimportして展示する。サンプル操作を通信や設定保存につなげない。
- 共通React部品が存在しないものは「既存CSS」または「構成案」と明記する。
- 構成案のコードはこのディレクトリに閉じる。アプリからimportしない。
- CSSは `.ds-review` 配下だけへ適用する。既存Storyの分類・見た目も変更しない。
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
