# Pi Durable native migration — implementation contract

状態: P0〜P4の実装と本番native Hostへの切替済み。P5の自動検証結果と未達条件は [native検証記録](../../docs/native-runtime-verification.md) に分離して記録する。Windows実機受入・物理削除を含む全要件の完了宣言ではない。

本計画は `pi-sdk-return-implementation.md` と以前のSDK/Durable切替方針を置き換える。既存の未コミット変更を保持し、旧会話データの移行・削除は行わない。利用者の最新指示に従い、実装と検証後に全変更をcommit/pushする（履歴の書換え・force pushはしない）。

## 目的

既存GUIを維持したまま、Pi CLI/SDKのGUIから、TypeScript設定とDurable標準Extensionで組み立てるpig所有のAgent Hostへ移行する。独自Agent SDK、Chord Plugins、汎用multi-harnessは作らない。

- 実行基盤: `@earendil-works/pi-durable` 1.5.0のみ。
- モデル・認証: `@earendil-works/pi-ai` 1.5.0のnative Models。
- 基盤依存: `@earendil-works/chord` 1.5.0。固定上流APIは `f9a26365568127461c47a07a37dcb42c140a3ac5`。
- 初回はElectrobun/Bun内の論理分離。独立Host、SSH、常駐実行、大規模OrchestrationはP6以降。
- WorkspaceごとにHarness、Registry、Models、SQLiteと唯一writerを所有する。UI接続は実行寿命から分離する。

## 厳守事項

1. 旧pi-coding-agent/pi-tui、SDK専用のResourceLoader/PackageManager/認証patch/TUI/テストfixtureを完全撤去する。SDK fallback、互換shim、二重runtime、config v1の互換実行を残さない。正当なpi-ai/Durable/Chord依存は残す。
2. UIは変更しない。既存Dock、9表示domain、配置・見た目・入力・画像・モデル設定・通知・寿命を保持する。不可避な変更は理由と代替案を説明し、事前承認を得る。
3. コマンドはRTK経由。RTKがない場合の直接実行fallbackを作らない。Agentの最終書換後コマンド・cwd・引数に権限判定を適用する。機密コマンドや出力をRTKの記録へ漏らさない。
4. アプリ専用認証を維持し、環境変数/別CLIのモデル認証を自動探索しない。Git/npmの手動導入では利用者が設定済みの当該ツールの認証を利用する。信頼済みJSのsandbox保証はしない。
5. 受付と完了を区別する。requestIdと内容の永続照合、draft revision、epoch/revision、操作確認を維持し、受付不明時に入力を消したり新IDで自動再送したりしない。
6. インストール、ロード、Conversationでの選択を分離する。Harness/profileのselectionを明示し、登録だけで全会話に適用しない。
7. 旧SDK、旧Durable、公式CLIの履歴をscan/open/変換/削除しない。新しい `agent-v2/workspaces/<opaque-id>/state.sqlite` namespaceのみ使う。非会話の設定・プロジェクト一覧は保持する。
8. 外部副作用のexactly-onceを約束しない。shell等を安易にreplay-safeにしない。Task/doc定義とversionを検証する前に復旧実行しない。

## ユーザーが承認したUI例外

次だけを許可し、その他のUI変更は別途相談する。

- 旧Pi拡張のTUI専用ターミナル画面・接続コード・xterm依存の撤去。通常チャット、Shellツール出力、ネイティブ確認ダイアログは維持。
- Marketplaceの旧 `pi install` 表示/コピーと、開いている会話の再読込説明だけを実際の挙動に合わせる。カード・ボタン配置やスタイルは維持。
- 再生成・編集再送は元の会話を残すnative分岐として実装し、必要な操作案内のみ修正する。同一会話の巻き戻しと偽装しない。
- 空Dockでも呼べる `Ctrl+Alt+R` のグローバル `config.reload`。画面/ボタンを増やさず、IME/ダイアログ/repeat保護、キー設定の優先順位・衝突検証を維持する。

archiveと削除は別操作。削除をarchive/非表示へ置き換える案は不採用。固定Durable 1.5.0の公開Conversation APIには物理削除がなく、`NATIVE_PHYSICAL_DELETE_UNSUPPORTED` を返して原本を保持する未達機能として残す。消えていないのに削除成功を返さず、内部SQLで削除を捏造しない。

手動導入については、Marketplaceの既存一覧・カード配置を保ったURL/パッケージ名入力欄とインストール操作の最小限の追加を承認済み。インストール後に自動有効化しない。新しい診断画面などは未承認。

## Marketplaceと手動導入

- 候補の調査・選定は利用者が別途指示する。当面はハードコードしたローカル一覧だけを使う。候補未指定時は空一覧とし、未検証パッケージを対応済みと表示しない。
- 自動npm検索、外部カタログ集約、独自レジストリは作らない。公式Durable Marketplaceの採用は後続。
- 別経路として、npmパッケージ名/URL、GitHub repository URLから明示操作で導入できるようにする。個人repoも対象とする。機密情報入りURLは拒否し、秘密をsource/ログへ保存しない。
- npmは解決済み正確なversion、Gitはcommitを固定する。任意コードをmetadata取得で実行せず、旧 `pi.extensions` を解釈しない。
- stagingで取得・検証し、失敗時は既存環境を保持する。更新/削除はTask依存を保護する。起動/config reload/会話復元で自動installしない。
- 取得成功をロード/有効化成功と混同しない。承認済みの最小入力欄を既存インストールRPCへ接続し、それ以外のUI変更は追加承認を得る。

## 実装順序とgate

| 段階 | 実装・受入 |
| --- | --- |
| P0 | 固定版を導入し、一時HOME/SQLite/faux providerでBun adapter conformance、再open/強制終了、writer分離、native選択、送信、watch、復旧と既知競合を検証 |
| P1 | `@pig/config` v2、候補検証と安全な適用、native Extension/profile/command、既存表示Adapterのnative read/controller port、last-good維持 |
| P2 | DurableHost/WorkspaceRuntime、認証/モデル、Conversation、永続受付、表示投影、再接続、Stopとdetachの分離へ本体を切替 |
| P3 | 指示/TODO/調査profile/Delegation/文書/RTK等の小さいnative拡張を既存Dockへ接続 |
| P4 | SDK/TUI/旧package実行経路/patch/不要依存をsource・fixture・lock・配布graphから撤去し説明を更新 |
| P5 | 型/lint/全test/native smoke/buildと配布物の解決・Windows実機受入。未実施を完了扱いしない |

P0の成立性gateが未通過のまま本体を切り替えたり、実データへ接続したりしない。Task/doc互換性を検証できないruntime設定変更は保留/拒否し、last-goodを保持する。live Task graphから消えたことを成功とみなさず、終端結果をdocument/entryへ保存する。

## 検証方針

全ローカルコマンドは `mise exec -- rtk proxy ...` またはRTK専用サブコマンドから実行する。

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`（desktop src、scripts、config packageのテストを含める）
- `pnpm --filter @pig/desktop smoke`
- `pnpm build`
- 配布同梱Bunでnative module、config import、Photon/WASM等の必要assetsを検証する。
- Windows/WebView2のIME、画像paste、OAuth、Shell、drag/resize、Dock、確認dialog、設定reloadは実機結果を別記する。

変更前の実行結果: typecheck/lint/smoke成功。testは469成功/1失敗（保存済み認証コマンドのGit Bash固定パス）。buildはVite成功後、既存の中断済み `build/sdk-runtime.next` により旧preBuildで停止。これらは移行後の成功証明ではない。

## 実装到達点

- **P0**: Bun SQLite adapter、Workspace単一writer、faux providerの5 probeと実SQLite強制終了復旧を実装・検証。承認前の再接続は元の受付を保持し、unsafe intent後は中断結果を保存する。再送や外部副作用のexactly-onceを保証しない。
- **P1**: `@pig/config` API v2、prepare/acceptとlast-good、native Adapter/CommandRegistry、明示profile/resource/provider factoryを実装。登録・導入・選択を分離。初期化済みresource選択変更は再起動が必要で、不明な外部定義の互換性は保留/拒否する。
- **P2**: `pi-service` とRPCをapplication-owned DurableHostへ切替。WorkspaceごとのModels/Registry/Harness/SQLite、immutable membership、永続receipt/draft、UI再接続、モデル/effortと会話分岐を接続。旧履歴は探索しない。
- **P3**: 明示resourceと内容に結び付くtrust、TODO CAS文書、親モデルを継承するread-only調査、承認と最終RTK実行lease、画像policyを実装。両Shellは固定定義で登録し、GUI設定でmodel/callable両方を絞る。切替・reload・再起動が履歴定義を変えない。
- **P4**: 旧SDK/TUI実装・fixture・依存・認証patchと旧配布経路を撤去。既存利用者変更と承認済みUI例外を保持。カタログは空のローカル一覧、手動npm/GitHub導入はexact version/commitのimmutable generationとして公開し、自動起動/reload/選択を行わない。置換はHostの実リースと保存依存検査で保護する。
- **P5**: source Bunと同梱Bunで全710テスト成功、型/lint成功。同一ソースの隔離Canary buildと実配布Bunの再配置smokeも成功。配布と実機の証拠を混同しない。通常dev buildの実行中アプリによるlock、private取得の実認証、WebView2実機操作は別gateとして残す。詳細・コマンドは検証記録を参照。

組込み固定定義だけは保存manifestで復旧互換性を証明する。任意closureのhashで外部定義を承認しない。再起動後のproject resource復旧は永続trustを必要とし、失われた一度限りの許可を背景実行へ転用しない。Node/SSH/P6は実装対象外。
