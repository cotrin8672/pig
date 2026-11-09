# PI-Desktopを基準にしたセッションドック

参照元は `vastsa/PI-Desktop` の `v0.22.0-beta.6`、commit `18549b74232f6b661d9dc240dc0036a91bddd3cd`。インストール済みアプリのpackage metadataとも照合した。

- [TaskDock.tsx](https://github.com/vastsa/PI-Desktop/blob/18549b74232f6b661d9dc240dc0036a91bddd3cd/apps/desktop/src/components/TaskDock.tsx)
- [TodoDock.tsx](https://github.com/vastsa/PI-Desktop/blob/18549b74232f6b661d9dc240dc0036a91bddd3cd/apps/desktop/src/components/TodoDock.tsx)
- [composer.css](https://github.com/vastsa/PI-Desktop/blob/18549b74232f6b661d9dc240dc0036a91bddd3cd/apps/desktop/src/styles/composer.css)
- [表示寿命](https://github.com/vastsa/PI-Desktop/blob/18549b74232f6b661d9dc240dc0036a91bddd3cd/apps/desktop/src/features/chat/background-tasks/bar-visibility.ts)
- [開閉・選択状態](https://github.com/vastsa/PI-Desktop/blob/18549b74232f6b661d9dc240dc0036a91bddd3cd/apps/desktop/src/features/chat/background-tasks/dock-state.ts)

参照元ライセンスはLGPL-3.0。ソースファイルの転載ではなく、配置・表示条件・操作仕様を参照し、pigの既存Reactコンポーネント、デザイントークン、Adapter API上で実装した。

## 揃えた部分

- 入力欄直上、会話幅に揃えた一つのドック。既定は折り畳み。上部のSession帯・常設の右ペインは廃止。
- 44pxの要約行。TODOの完了数・現在の項目・稼働数・タブ・開閉ボタンを同じ行に置く。
- TODOと実行一覧を共有枠内で切り替える。空のタブと空のドックは表示しない。
- 中止項目を完了率の分母から外す。全件中止は0/0ではなく中止表示。並行TODOは追加件数を示す。
- 実行行は状態点・名前/コマンド・状態/経過時間・提供された操作。名前は一行省略、行を開くと出力。
- 展開一覧は最大200px/24vh、ログは最大180px。文字サイズ・色・角丸はpig既存トークンを使用。
- このrendererで実行中を観測した処理だけ、終了後10秒残す。最初から保存済みの終了履歴は表示しない。閲覧中の出力は時間切れで消さない。
- 開閉・タブ・閉じる操作はrendererの表示状態のみ。プロセスの正本や実行制御を変更しない。

## pig側の接続と差分

- Agentとbackground processを共通の「実行」一覧に表示。Agentは別アイコン、詳細にprofile・依存等を残す。PI-Desktopの実行エンジンや独自subagent機能は移植しない。
- schedule/mode/goal/annotation/document/statusはデータがあるとき「情報」から開ける。9種類を同じカードで常設しない。
- 停止等はAdapterが登録したactionだけ。確認・フォーム・世代/表示revision検証・エラー通知は維持。
- 設定reload・接続診断・keymapsは展開後の「接続情報」へ。普段のヘッダーには出さない。
- UIデータが空のときドックは存在しないため、最初にconfig.tsを作った場合はアプリを再起動して読み込む。ドックが表示されている場合は接続情報からreload可能。
- 過去の完了結果は会話履歴に残る。ドックから非表示にすることは、履歴やExtension側のデータの削除ではない。

既存のサイドバー・会話本文・入力欄・ModelPicker・画面全体の配色を変更しない。
