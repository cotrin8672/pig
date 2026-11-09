# @pig/config — Config API v2

信頼されたユーザーTSから、native Durable Extension / Provider / profile、Host command、Session Adapterを組み立てます。SDK/TUI互換、独自Tool DSL、sandboxは提供しません。`apiVersion: 1` は移行診断付きで拒否し、部分実行しません。

## 設定

明示したユーザーの `~/.config/pig/config.ts`（Windows: `%USERPROFILE%\.config\pig\config.ts`）だけを読みます。プロジェクトTSやインストール済みpackageを自動探索・実行しません。

```ts
import { defineConfig } from "@pig/config";
import { defineExtension, section } from "@earendil-works/pi-durable";

const Policy = defineExtension({
  name: "example.policy",
  sections: [section("policy", () => "Observe, then explain your findings.")],
});

export default defineConfig({
  apiVersion: 2,
  runtime: {
    extensions: [Policy], // インストール定義。選択とは別。
    profiles: {
      main: { extensions: [Policy], tools: [], thinkingLevel: "high", maxTurns: 4 },
    },
    defaultProfile: "main",
  },
  sessionAdapters: [{
    id: "example.status",
    connect(ctx) {
      return ctx.sources.subscribe(() => ctx.views.set({
        kind: "status", id: "window", title: "Conversation window",
        source: { label: "Native view", scope: { kind: "session", id: ctx.session.id }, freshness: "live" },
        text: `${ctx.sources.conversation().entries.length} visible entries (not full history)`,
        tone: "info",
      }));
    },
  }],
});
```

`runtime.providers` はnative pi-ai `Provider[]`、`runtime.extensions` はnative Durable `Extension[]`。profileの `extensions` と `tools` は必須の明示配列、`modelTools` は任意配列です。`model` は `{provider, modelId}`。`thinkingLevel / instructions / cwd / maxTurns` はConversationのagentへ渡す設定で、HarnessSettingsへ誤配置しません。モデルはofflineロード時に必須ではありません。

HostはWorkspaceごとにRegistry/Modelsを所有し、HarnessSettingsのextension selectionも明示します（未指定ならnativeは全installedを選ぶため）。優先順位は builtin → user TS → 明示Conversation override。reloadでGUIの明示選択を上書きしません。read-onlyは実効 `tools` からwrite/edit/任意shellを除外してください。`modelTools` や指示だけではnested call権限を制限できません。任意JSのread-only sandbox保証ではありません。

## 読み込み・再読込

- source上限1 MiB、bundle上限4 MiB。相対importは毎回bundleし直します。構文・構造・native Registry検証の失敗でlast-goodを維持します。
- Loaderの `prepare()` は `ConfigCandidate{config,revision,dependencies,diagnostics}` を返すだけで適用しません。`accept(candidate, canApply)` はHost安全gateとcache cleanupの成功後だけ受理します。`reload()` はその直列化された組み合わせです。
- Runtimeの追加・変更・削除にはHost gateが必須。未接続なら候補全体をpendingにし、旧Adapter世代/Registry/configを維持します。Hostはpending/waiting/sleeping/background/子Task、承認待ち、Task/Doc version・schema依存も検査します。idle/runningだけ、`extension.version`、関数を消すJSON比較は互換証明ではありません。
- gateのreadyは非同期staging後の同期atomic `apply()` と安全leaseの `release()` を渡せます。cleanup成功前にpublishしないこと、applyがthrowしたら旧Host状態を維持することはHost側の契約です。互換性不明のresumeは拒否してください。
- `config.reload` は予約済みglobal commandです。backend契約と、空Dockからの到達性/Host shortcutのUI配線は別です。このパッケージは新toolbarやshortcutを追加しません。

TSは任意のHostコードです。top-levelは宣言だけにし、購読/timerはconnect内で管理します。API外の副作用はrollbackできません。相対moduleの `import.meta.url` asset探索や計算されたdynamic importはbundle後の位置に依存するため避けてください。

## Package / core解決

native peerはpi-ai / pi-durable **1.5.0**。実行時のpi-durable / pi-ai / chordはversionだけでなくHostと同じrealpathである必要があります。Loaderは外部package内の静的importとcore peer/dependency解決も検査し、入口aliasだけで内部の重複copyを直したとは扱いません。これは任意dynamic codeの完全検証やsandboxではありません。

`ConfigLoaderOptions.moduleRoot`（文字列または毎prepareで読む関数）は明示したmanaged dependency workspace用です。`resolveModule(specifier, fromDirectory)` はbundle入口の解決hookで、外部npm内部のresolverを書き換えません。自動install・package discoveryはしません。manual install成功とload/selectは別です。外部npmはBunのprocess module cacheを使うため、更新を相対module reloadと同一視しません。

入口/相対bundleの `@pig/config` value exportは `defineConfig` と `viewActions` だけです。外部npmからのvalue-importには、Hostと同じ実packageと一致するcore peerが必要です。型補完用にはこのrepoの `packages/config` を明示的なローカル依存として使えます。公開型は `src/index.ts`、表示DTOは `src/models.ts`。

## Adapter / command契約

- `sources.conversation()`: detached native window、`before`、**builtinのみ**のdocs。全履歴やcustom TODOではありません。
- `sources.taskGraph()`: Workspace全体のlive graph。消失を完了/成功と推測しません。終端outcomeはentry/domain docに永続化します。
- `sources.snapshot(token)` / `watchDocument(token, listener)`: native ConversationDocToken。不存在はundefined。watchは初回valueとretiredを通知し、取得中のdisposeでも後で必ず解放します。必要docは `runtime.conversationCreated(tx, conversation)` 等の作成commitで生成します。
- `sources.subscribe`: 初回即時＋集約した再取得通知。`views.set/remove`: 既存9 domainのJSON snapshot。不正値・循環・過大JSON・重複nested actionを拒否します。
- `commands.register`: Adapter内local ID。内部は `(adapterId, localId)` のtupleで分離します。Hostのnamespaced command IDとは別です。
- `controller.configure(AgentChange)` / `commit(txCallback)`: 明示command実行中だけ利用できるHost束縛port。commit内ではtxだけで読みます。snapshot/watchを呼ぶとmutation lineがdeadlockし得ます。native numeric ConversationIdは `sources.conversation().conversation.id`、表示用 `session.id` は文字列です。
- `scope.signal/onDispose/interval`: 設定/会話世代の寿命。disposeはruntime Taskのabortではありません。`ctx.pi`、branch/all sources、EventBus、汎用Tool.execute経路はありません。

Host commandは `{id,title,scope,validateInput?,enabled?,confirmation?,allowWhileStreaming?,run}`。IDは `example.refresh` 等のnamespace付き、`config.reload` とapp builtinは予約です。常にbounded JSON検証を行い、validator未指定ならinputなしだけを許します。enabledは無効理由を返します。confirmation transportがなければ拒否し、確認をruntime権限承認の代用にしません。scope/streaming/generation/busy/cancellationもHostで検査します。

view actionの固定inputはHostの値が正本。fieldsは正確な名前・必須・文字列上限を検査し `{value, fields}` をhandlerへ渡します。generation/revision/action IDを検査し、使った表示revisionは消費します。二重実行・自動再送・楽観的な状態変更はしません。

キーは `chat / composer / panel` の単一combo。同surfaceの重複はエラー。既存 `{keys,adapter,command,when}` はAdapterKeymap DTOのまま、Host用 `{keys,command,when}` は別契約で、SessionUIStateへ混ぜません。Host bindingのrenderer配線は別途承認対象です。既存GUI override → TS → defaultとIME/対話保護を維持します。

## Native例

`examples/session-ui/config.ts` と `durable-adapters.ts`: TODO、独立したworkflow Mode、owned Delegationのlive graph＋永続outcome、Artifact Document。repo内typecheck用の相対importはコピー時に `@pig/config` / `@earendil-works/pi-durable` へ変更します。例はDelegationの**観測契約**であり、独立Agent通信や汎用subagent起動APIを提供しません。

UI/DTOの9 domainは変更しません。任意React注入、汎用tool実行、cron、プロセス起動、旧履歴変換は含めません。詳細は `docs/session-ui-domains.md`。
