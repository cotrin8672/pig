# Native Durable Host — 検証記録と残る受入条件

現行の本番経路は Electrobun/Bun 内の application-owned Pi Durable Host。
P0〜P4の実装と下記の自動検証は完了したが、**P5の全実機受入・全機能互換・リリース承認を意味しない**。
契約は [移行計画](../.pi/plan/pi-durable-native-migration.md)、設定は
[native configuration](native-configuration.md)、取得は
[manual installation](manual-package-installation.md) を参照。
旧 [SDK検証記録](sdk-runtime-verification.md) は過去の別実装の証拠である。

## 固定基盤と隔離範囲

- Pi Durable / pi-ai / Chord **1.5.0**、API基準 `f9a26365568127461c47a07a37dcb42c140a3ac5`。
- Electrobun **1.18.1**、source Bun **1.4.4**、同梱 Bun **1.3.13**。
  CI設定の tooling Bun **1.4.2** をローカルで実行したとは主張しない。
- `@pig/config` **0.1.0 / API v2**。各Workspaceに独立したModels、Registry、Harness、SQLiteとwriter lockを所有。
- 新会話は `agent-v2/workspaces/<opaque-id>/state.sqlite` のみ。旧履歴を探索・変換・削除しない。
- P0とアプリ復旧fixtureは一時データとfaux providerを使用。承認対象の外部効果は注入runnerで模擬し、実プロジェクトのコマンドや実認証を使用しない。
- smokeは一時SQLite、in-memory credentials/models、faux providerとnetwork拒否を使用する。**HOMEの差し替えは行わない**。desktop設定やプロジェクトコードをロードしない。
- 任意の明示import/config/extensionは信頼済みHostコードとして実行される。validationや一時HOMEをOS sandboxとは呼ばない。

## 最終ソースの実行結果

| 確認 | 結果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0、257 files、警告なし、fixなし |
| source Bunでroot `pnpm test` | **710 pass / 0 fail、89 files、18,759 expect calls** |
| 同梱Bunで同じ全対象を実行 | **710 pass / 0 fail、89 files、18,759 expect calls** |
| SQLite/storage focused suite | 各Bunで48 pass / 0 fail、803 expect calls |
| standalone P0 | 各Bunで5/5 probe成功 |
| 配布assets + ConfigLoader focused suite | 各Bunで61 pass / 0 fail、14,841 expect calls（assets 31、loader 30） |
| Shell修正 + native tools + アプリ強制終了復旧 | 各Bunで23/23成功。上記710件にも包含 |
| source native smoke | exit 0、受付・出力・provider cleanup・writer再open成功 |
| 最終Vite build | exit 0。dynamic/static importとchunkサイズの非致命的警告は残る |
| 最終Canary（隔離ソースsnapshot） | exit 0。検証後も261 input filesがlive sourceと一致 |
| 実配布archiveの再配置解決 | exit 0。123 placements・257 dependency edges、native 1.5.0と実`@pig/config`を検証 |
| 実配布Bunの再配置native smoke | exit 0、Bun 1.3.13。source/store fallbackなし |

focused suiteは全体件数への追加ではない。fixture子プロセスの `node:assert` はBunのexpect集計に含まれない。
root対象は `apps/desktop/src`、`apps/desktop/scripts`、`packages/config/src`。
`packages/config/src` 単独にはテストファイルがなく、両Bunで単独探索はexit 1（0 tests）だった。
Config v2のschema検証はdesktopの `config-validation.test.ts`、実importはConfigLoaderと再配置testsで検証している。

P0の5 probeは `harness`、`wait-race`、`resources`、`recovery-safe`、`recovery-unsafe`。
実SQLiteのtransaction/CAS、再open、writer分離、watch、native選択、durable受付と安全/unsafe復旧を含む。

## 重要な回帰証拠

| 領域 | 自動証拠と境界 |
| --- | --- |
| 本番接続・会話 | `application-runtime`、`native-host-regressions`、`durable-host*`。immutable所属、隠しモデル、model/effort、fork、再open、draftと失敗transitionの保護 |
| 受付・復旧 | `durable-send-receipts`、`durable-projector`、`application-recovery`。requestIdとpayload照合、受付不明時の照会、元receiptの維持。新IDの自動再送なし |
| 実アプリ強制終了 | 一時SQLiteを使う本物のHarnessを子プロセスごと強制終了。before-intentの再接続は新しいUI確認を必要とし、明示承認時だけ模擬効果1回。unsafe write intent後は中断ToolResultを保存し、target未作成・古い承認による実行なし |
| Shell設定変更 | Bash/PowerShellを固定定義として登録。現在のShellでmodel/callable/nestedを絞り、明示tools/modelToolsを拡大しない。最終RTKのprogram/argv/prefix/UTF-8/cwd/hashを照合。待機中の設定変更は効果0で失効し、reload/restart後も履歴・receipt・model/effortを保持 |
| 権限・画像・調査 | `native-approvals`、`native-tool-policy`、`native-tools`、`image-policy`。immutable workspace root、conversation別spill、最終同期lease、read-only調査と親モデル継承。UI切断は許可/Stopではない |
| 保存定義の互換性 | `application-compatibility`。組込み固定protocol/doc/task/tool metadataをmanifestで照合。不明/欠落/外部closureはmetadataやfunction hashで安全と認定しない。saved doc、承認、未完了委譲をpackage置換前に確認 |
| Config・provider・resource | `application-config`、`config-loader`、`config-validation`、`resources`。candidateとlast-good、catalog/workspace/generation別のfresh provider、実TS import、明示resource選択。初期化済みresource path変更は再起動が必要 |
| Package lifecycle | `durable-package-manager`、`packages`、共有source parser。exact npm version/Git commit、script-disabled取得、immutable generation、失敗時rollback、実Host mutation lease。起動/reload/復旧で自動installしない |
| UI入力 | manual install/parser/ConfirmButton、keymap/reload、runtime/store tests。mock RPCのブラウザー確認は二段階確認・ref維持・credential URLのtransport前拒否を検証したが、実WebView2とは別 |
| 配布解決 | `durable-runtime-assets.test.ts`。実closureの再配置、native identity、実ConfigLoaderと`@pig/config` import、Photon WASM、CodeMode worker/QuickJS。SDK/TUI/xtermの拒否とstage rollback |

再起動でlive workを再開する場合、明示resourceを再ロードし、project bytesには永続trustを要求する。
以前のプロセスだけの一度限りの承認を背景実行へ転用しない。
モデル認証はアプリ所有で、環境変数や別CLIを自動探索しない。実subscription loginの成功証拠とは別である。

## 配布ビルドの記録

- 最終Viteは成功。live workspaceの最終Canary初回は既存 `build/durable-runtime.next` によりfail-closedで停止した。
  ガード付きでその生成ディレクトリだけをscratchへ退避し、現行stage・実行中アプリは保持した。
- 再実行はnative 123 package placements作成後、Electrobunのコピー中にstage内 `ts-algebra/README.md` のENOENTで停止した。
  後続の観測では同ファイルは存在し、さらに別のlive-stage再生成を確認した。共有stageは静止していなかったが、過去のENOENTのwriterや特定watcherへの因果は断定しない。
- **同一最終ソースの隔離snapshotでVite/Canaryがexit 0**。repository編集、依存install、版変更、利用者process操作はなし。
  261 input filesをコピー前後に照合し、検証終了後もlive bytesとの一致を確認した。source inventory SHA256:
  `49ef8f16a885a8f38ad5269fa6d17a5dbfc7fb3ea60d8c43e41a8e547279f5af`。
- 生成した実Canary archiveをpath検査して展開し、そのBun・app bundle・全node_modulesをscratchへ再配置した。
  12,694 regular dependency filesはarchiveとbyte一致、linkは0。123 package placementsと257 dependency edgesを確認し、native各1.5.0と実`@pig/config`が再配置先だけで解決することを検証した。
- **archiveからのBun 1.3.13でnative smokeがexit 0**。current smokeのapp-owned 3 modulesだけをbundleし、packageはexternal、`--no-install`、空の`NODE_PATH`で実行した。native受付・出力・cleanup・writer再openが成功した。
- 検証archive `canary-win-x64-pig-canary.tar.zst`: 129,276,639 bytes、SHA256
  `9746da9641e03b6fc2756750489b167bc65f050c9c1e2b0a0785d969c4d55722`。installerも生成したが起動/インストールはしていない。
- 通常 `pnpm build` のdev出力は、以前の実行で既存の利用者アプリによるWindows EACCESを確認済み。最終sourceでは再試行せず、launcher/Bunと使用中dev出力を保持した。
  Canary成功を通常dev buildの成功と混同しない。codesign/notarization、baseUrlなしのupdate patch生成は行われていない。

## 変更・依存の監査

- 開始時のmainview 82ファイルのhashと比較。差分は承認済みのTUI除去、manual install、reload、fork関連と、既存/並行の利用者変更に一致する。
  開始時のApp/SessionList/Settings/layout変更は保持し、Providers/UtilityModelSettings/settings.css/通知の並行変更も保持した。
- sourceの旧SDK/TUI実行importはなし。lockにSDK/TUI/xtermなし。assets内の禁止名とnegative testsは意図した拒否検査。
  既存の旧ビルド出力は実行中アプリの所有物として残し、現行source/新配布graphと混同しない。
- SDK認証patchを削除。native lifecycle patchのSHA256は
  `bacccb827b9c6c8262bf457c7ab23a527ac70d104cb09a5b400a372b13c2587d`。
  `pnpm install --frozen-lockfile --ignore-scripts` は成功済み。
- RTKの生成履歴DBは `rtk/` ignore対象であり、配布・commit対象にしない。
- commit前のindex監査で、生成物/DB/認証ファイル名・binary追加・高確度の秘密情報パターン一致は0。staged/working-treeの `git diff --check` も成功した。これは任意形式の秘密情報の不存在を数学的に保証するものではない。

## 再実行（Windows PowerShell、repository root）

```powershell
mise exec -- rtk proxy pnpm typecheck
mise exec -- rtk proxy pnpm lint
mise exec -- rtk proxy pnpm test
mise exec -- rtk proxy .\apps\desktop\node_modules\electrobun\dist-win-x64\bun.exe --no-install test apps/desktop/src apps/desktop/scripts packages/config/src
mise exec -- rtk proxy bun apps/desktop/scripts/durable-p0.ts
mise exec -- rtk proxy .\apps\desktop\node_modules\electrobun\dist-win-x64\bun.exe apps/desktop/scripts/durable-p0.ts
mise exec -- rtk proxy pnpm --filter @pig/desktop smoke
mise exec -- rtk proxy pnpm --filter @pig/desktop exec vite build
mise exec -- rtk proxy pnpm --filter @pig/desktop exec electrobun build --env=canary
```

Bun/Node/pnpmはmise管理。再実行は既存依存を使い、検証のためにnative版を変更しない。
CI/releaseにはRTKと同梱Bunでの再配置smoke gateを追加したが、未実行のリモートCI結果は本記録に含めない。

## 残る機能・受入条件

1. **物理削除は未対応**。固定Durable 1.5.0の公開APIに手段がないため
   `NATIVE_PHYSICAL_DELETE_UNSUPPORTED` を返して原本を保持する。archive/非表示への代替や内部SQL purgeはしない。
2. **Windows/WebView2の手動P5受入は未実施**。IME、実clipboard/image paste、OAuth、実Shell、dialog、drag/resize、Dock、実ウィンドウでのreloadなど。
   mocked DOM/RPC、source tests、installer生成は代替証拠ではない。
3. **実ネットワークのprivate GitHub/npm認証・取得は未検証**。設定済みGit/SSH/npm credentialsを使う設計と検証fixtureは、実アクセスの成功を意味しない。
4. 外部副作用のexactly-once、任意JS sandbox、任意外部定義の自動互換性、長時間安定性や署名/公開済みreleaseを保証しない。Node/SSH/P6は対象外。
