# @pig/config — session UI API v1

Pi Extensionの状態をpigのネイティブUIへ投影する、Host側のTS設定APIです。実行エンジンや権限管理を置き換えません。

## 設定

ユーザーの `~/.config/pig/config.ts`（Windows: `%USERPROFILE%\.config\pig\config.ts`）に保存します。プロジェクト内のTS設定は自動実行しません。

```ts
import { defineConfig } from "@pig/config";

export default defineConfig({
  apiVersion: 1,
  sessionAdapters: [{
    id: "my-extension",
    connect(ctx) {
      ctx.sources.onBus("my-extension:state", data => {
        // dataはunknown。接続先のスキーマを検証してから投影する。
        if (typeof data !== "string") throw new Error("Invalid extension state");
        ctx.views.set({
          kind: "status", id: "status", title: "My extension",
          source: { label: "My extension", scope: { kind: "session", id: ctx.session.id }, freshness: "live" },
          text: data, tone: "info",
        });
      });
    },
  }],
});
```

チャットのSession欄から **Reload TS config** で適用。Pi Extensionをreloadする操作とは別です。相対importの変更も読み直します。構文・設定検証の失敗時は以前の設定を維持します。操作中なら適用を保留します。

設定は信頼されたローカルコードであり、sandboxではありません。top-levelは宣言だけにし、購読・timer等はconnect内で登録してください。API外の副作用は自動回収できません。相対モジュールはbundleされるため、元ファイルに対するimport.meta.url依存のasset探索や後からの動的importは避けてください。npm依存はユーザー設定ディレクトリから通常のnode_modules解決を使います。

## 型補完

このパッケージは公開APIの型と実装を含みます。現時点でnpm公開はしていません。設定ディレクトリで、このリポジトリの `packages/config` をローカル依存としてインストールするとTypeScript補完が使えます。

```powershell
mise exec -- pnpm add -D 'C:\path\to\pig\packages\config'
```

実行時の `@pig/config` はpigのLoaderが提供するため、基本的なconfigを実行するだけならインストール不要です。APIバージョンは `apiVersion: 1` で明示します。公開契約は `src/index.ts` と `src/models.ts`。

## 接続例

リポジトリの `examples/session-ui/pi-adapters.ts` に公式Pi TODO／plan-mode／subagentの接続例があります。コピーして使うときは型importを `@pig/config` に変更してください。`config.ts` は利用例です。

- TODO: branchのtoolResult.detailsから復元。読み取り専用。ツールexecuteをGUIから直呼びしません。
- plan-mode: 全entryのcustom stateから復元。提供元の絶対パスを指定した `/plan` 相当のtoggle。TODO消去を明示し、setに偽装しません。
- subagent: 一つのtool callに含まれる複数runを表示。子ごとの失敗、chain順序、保存結果と現在の稼働を区別。
- Schedule／Backgroundは、それぞれのExtensionが公開するstate/events/controllerへ同じ方法で接続します。汎用の停止・再開APIがあるとは仮定しません。

## 主要契約

- `sources.entries('branch'|'all')`: 復元規則はExtensionに合わせて選ぶ。読み取りは複製され、履歴再生は操作を呼ばない。
- `sources.tools()`: 保存済みの結果と現runtimeの途中更新。`origin`で履歴とliveを区別。再起動後の古い結果をrunningへ復活させない。
- `sources.subscribe(fn)`: 初回即時＋更新通知。再取得型なので連続通知を集約する。
- `sources.onEvent/onBus`: 生イベントは順序付きで配送。過大backlogは診断して当該Adapterを止める。
- `views.set(view)`: 表示snapshot全体を置換。9種のdiscriminated union。不正なnested値・重複ID・関数・循環・過大JSONを拒否。
- `commands.register`: Hostの操作。ボタンとkeymapは同じID。処理中は同Adapterへの二重要求を拒否。
- `pi.commands()`: 利用可能な名前・invocationName・提供元パス。`pi.invoke({name,source,...})`は完全一致した登録handlerだけを呼ぶ。例外は呼出元へ返し、未登録ならモデルに送らない。
- `pi.emit`: 対象Extensionの公開EventBus契約へ接続する。独自chの名前・データ形式はAdapterとExtension間の契約。
- `scope.signal/onDispose/interval`: セッション・設定世代に属する寿命。表示を閉じるだけではdisposeしない。disposeはExtensionのタスク停止ではない。

表示のsourceには `live / saved / unknown`、提供元、scopeを指定します。共有TODO等は `shared` scopeも可能ですが、Adapter接続自体はセッション単位です。共有リソースの競合制御は正本側が担当します。

## 操作とフォーム

viewまたは項目のactionsには `{id,label,command,input?,disabled?,confirmation?,fields?}` を渡します。IDはview全体で一意。非対応の操作を登録しなければ同じUIが閲覧専用になります。

- 固定inputはHost側の登録値が正本。クライアントから値を差し替えられません。
- fieldsは名前・ラベル・required・multilineで定義。操作handlerへ `{value: 固定inputまたはnull, fields: {名前:文字列}}` を渡します。
- generation、view revision、action IDを検査し、使用済みの表示要求を再実行しません。タイムアウト等で自動再送しません。
- 操作成功は、Extensionの状態変化を観測したこととは別です。GUIは楽観的に実状態を変えません。

## キー

```ts
keymaps: [{ keys: "Ctrl+Shift+P", adapter: "planning", command: "toggle", when: "composer" }]
```

chat / composer / panel、単一コンボのみ。同surface・同コンボの重複は設定エラー。UIで明示した既存キー設定が優先され、次にTS設定、次に既定キーです。IME変換中・TUI・既存UI要求中は発火しません。Pi内部の独自TUIキーまで変更するAPIではありません。

## 意図的に含めないもの

自動widget隠し、任意のReact実行、任意ファイル/URLの自動読込、汎用ツール実行、cron評価、プロセス起動、Goal継続ループ、注釈の自動再anchorは含めません。モデルの調査根拠・反例・具体的な限界は `docs/session-ui-domains.md` を参照してください。
