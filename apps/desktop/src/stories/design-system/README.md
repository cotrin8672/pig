# Design system review — Storybook only

`mise run storybook` → **Design System** から確認する。

1. **Screens / App**: 全体画面のプレビュー
2. **Domain / Sidebar・ChatScreen・ComposerUI**: 画面を構成する大枠。その配下に個別部品を置く
3. **Patterns**: 設定の構成案、既存の操作メニュー・二度押し確認・名前変更
4. **Primitives**: 既存CSSによる操作・入力の見本
5. **Foundations**: 既存の色・文字・半透明面、出力枠の構成案
6. **Guide**: 分類、部品台帳、使い分け、レビュー条件

## 境界

- この段階では本番UI、共通CSS、通信、設定保存を変更しない。
- 本番部品はそのままimportして展示する。移動・置換・公開API化はしない。
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
