# SDK runtime 移行 — 検証記録と残りの受け入れ条件

2026-11-09 時点。**通常会話ランタイムの SDK 移行と限定された自動検証は完了。全機能互換・native E2E・リリース完了ではない。** 契約は [実装計画](../.pi/plan/pi-sdk-return-implementation.md) を参照。本書は証拠の範囲を記録するもので、契約を緩和しない。

## 後続の削除要求（2026-11-09）

Legacy Archive の画面・検出・reader/schema/RPC・continuation metadata と standalone exporter/移行手順を削除。numeric/Durable session links は拒否し、検証済み opaque SDK ID のみを開く。手動 Reconnect runtime ボタンも削除し、自動接続・heartbeat・reconnect は維持する。通常 SDK chat の archive/pin と custom-record/image 表示は維持。実 legacy data/auth/profile は変更しない。以下の件数・build/native 証跡は削除前の履歴であり、変更後 source の検証・配布一致には転用しない。

## 到達点と証拠の種類

- SDK / pi-ai / pi-tui は **1.5.0**。通常 app/workspace の実行・テスト・smoke/build graph に Durable はない。セッション内 installed-manifest 監査は **526 nodes、missing required edges 0、Durable nodes 0、lock 内 pi-durable 0、direct chord なし**。単に古い node_modules が物理的に残っているかとは区別する。
- 1.5.0 時点では認証情報をアプリ内に限定するパッチを使用していた。以下の auth probe は当時の記録。1.5.2 への更新でこのパッチを削除し、現在は公式 SDK の認証を使用する。保存先は従来と同じで、未保存の場合は SDK が環境変数なども参照する。
- 最終 postfix の repository suite は **268 pass / 0 fail、1,532 assertions、63 files**。既存 UI integration subprocess の **11 pass** は別集計。typecheck / lint (**202 files、fix なし**) / SDK faux-provider smoke は exit 0。
- production frontend build は exit 0（2,201 modules）。既存の static/dynamic import と大きい chunk の警告は残る。隔離 Chrome の actual React DOM + bundled xterm は **14/14 scenario groups** 成功。ただし **fake Electrobun IPC** であり、本物の Bun Host / native WebView2 E2E ではない。スクリーンショットも手動視認・物理幅検査の代用ではない。
- actual Electrobun CLI の **candidate2 dev/stable** build と、repo 外へ link-free に移した各 payload の shipped **Bun 1.3.13** による **6/6 SDK checks**、stable installer ZIP 内 archive の SHA256 一致監査は成功。installer の実インストールはしていない。
- final-postfix-r2 の **Vite/dev/stable、両 relocated payload の SDK 6/6、stable installer/archive identity、source/snapshot/app currentness は成功**。203 input files の source inventory SHA256 は `197729443352aa3d2697ff3c62cc48a9ab70a9ba35ad1df045e95961fb472a74`。最初の隔離 build は stage rename の Windows EPERM で失敗、同じ source hash の新規 snapshot で 1 回再試行して成功し、失敗記録も保持。さらに **変更していない final stable payload の native UI-root handshake / 実 RPC / 30,016 ms dwell は成功**（下記）。これは candidate の panic 解決や長時間安定性を意味しない。

### Native：限定 startup 証明と未解決 panic

candidate2 の本物の WebView2 は bundled root/native bridge を描画した後、約 **2,727 ms** で shipped Bun 1.3.13 が `attempt to use null value` panic、child exit 9。後続 screenshot は timeout。これは実際の失敗として保持する。

bounded investigation の candidate 8 launch と final payload の追加 3 diagnostic launch では panic が再現しなかった。**非再現は解決ではない**。その後、official pinned Bun1.3.13 symbol bundle の published digest、PDB GUID/age、shipped binary と同一の `.text` を照合し、**local symbolization は成功**。Worker event loop の `Bun Task.tickQueueWithCount` から `std.debug.unwrapNull` が呼ばれたことは確定した。ただし異なる null checks が同一 panic callsite に compiler-merge されており、最適化済みの保存 trace から正確な nullable field/branch は一意に復元できない。raw inline ReadFile/S3 labels は因果の証拠ではなく、FFI や SDK 移行の因果も未証明。出荷用 Bun/DLL 交換・推測 patch・upgrade 推奨はない。symbolization 作業では app/workspace/runtime/native 変更、upload、新規 native launch は行っていない。

final の新規・未変更コピーでは、actual UI-root が Host の hostId を受理・保持し、`runtimeState` の実 response が **既存の暗号化 WebSocket** を通って成功。UI 自身の **6 connected:true heartbeat replies** と response 後 **30,016 ms** の dwell、screenshot、launcher 生存、panic/例外なし、自分の process tree cleanup を確認した。203 source inputs と authoritative app/成功コピーの各 **15,388 original files** の hash は最終 inventory と一致。これは session-only の限定 native startup/IPC 証明で、provider/session 操作や long-haul release approval ではない。

以前のボタン表示からの接続不良推測は計測誤りとして訂正済み。手動再接続ボタンは後続のユーザー要求で削除し、自動 lifecycle は維持する。

## 機能 coverage matrix

「永続」は repository にあるテスト、「session」は当時だけの scratch harness/probe を示す。root `pnpm test` は `apps/desktop/src` のみで、scripts 検証を包含しない。以下は削除前の coverage 記録で、削除済み機能の受け入れ要件ではない。

| 領域 | 自動証拠・実装範囲 | 未検証・制限 |
|---|---|---|
| 通常会話 / opaque ID / lifecycle | 永続 `session-host*.test.ts`：open/cancel、chat/tools/stop/close/reopen、fork/rewind/new/switch、epoch、model/effort 復元、失敗 transition の fail-closed | 実 provider の会話、非協調 extension の強制停止は未保証 |
| acceptance / draft / images | 永続 `sdk-send-receipts` / `send-controller` / `draft-store` tests：dedupe/conflict、timeout→lookup のみ、queued images、編集後/old epoch の保護。UI-ACCEPT-01 stale warning 修正済み | Host crash 越しの exactly-once は保証しない。unknown 時に自動再送しない |
| auth / profile / resources / trust | 永続 `model-runtime` / `resources` / `project-trust` tests、session patched-install auth probe。ancestor .agents と themes、safe-mode omission を含む | 実 auth 未実施。Trust は OS sandbox/Permission ではない |
| Root Broker / Composer / terminal | 永続 broker/bridge/terminal/UI tests。実 Pi TuiAltScreen→VirtualTerminal→xterm、cancel/ready/seq/ACK/limits。Chrome session は自然な 5 秒 heartbeat と reconnect/resync・再送なしを確認 | Chrome は fake Host。WebView2 の IME/物理入力/clipboard/mouse は別 gate |
| Root loss | 永続 `ui-connection-lease.test.ts` と real SDK Host fixture：5 秒 heartbeat / 30 秒 lease、非協調 view loss 時に native/terminal UI と startup を cancel | Bun event loop 停止中は timer も遅延。native crash/quit の async cleanup 完遂は未証明 |
| custom records / status / widgets | 永続 projector/UI tests と Chrome session：保存/live custom-entry.data、JSON/raw fallback、status/title/working labels/string widgets、RND-01 basic rendering | optional Component renderer/header/footer/custom editor/React Composer shortcut は未対応を明示。全 extension 互換とはしない |
| Marketplace / providers | 永続 package/queue/state/model tests：user-scope、逐次 mutation、pending/failed apply、A/B・同 cwd の provider isolation | 実 npm/network install 未検証。SDK process-global API registry・任意 JS globals は完全隔離しない |
| shell / image policy | 永続 SDK tool/resource/Host tests：Git Bash・PowerShell、timeout/cancel、blockImages、queued model policy | 任意外部 full-screen TTY / PTY の互換性を主張しない |
| 配布 assets / native startup | 永続 `scripts/sdk-runtime-assets.test.ts`（別実行）。final 実 CLI/再配置 session：両 channel SDK 6/6、installer hash/currentness。未変更 final native copy の実 UI-root hostId / runtimeState / 6 connected heartbeats / 30,016 ms dwell 成功 | 歴史的 panic は未解決。long-haul/native manual/provider E2E と install/sign/publish は未実施 |

当時の final Opus review は **1 回実施済み**。model/effort、transition admission、trust boundary、safe-mode 表示整合は postfix と回帰テストで対処。R2 は失敗した runtime を閉じる fail-closed。`apps/desktop/rtk/history.db` は指示通り保持。削除後の独立 review を実施したとは記載しない。R1 streaming 全 branch projection 性能は残る観察事項。

## 再実行（Git Bash、workspace root）

pnpm **10.14.0** と node/bun は mise 管理。依存準備が必要なら担当者が `rtk proxy mise exec -- pnpm install --frozen-lockfile` を実行し、patch/lock を検証する。検証のために SDK/app/native の version を変えたり、package manager を勝手に更新しない。

以下は **repository にある自動テストの再実行用**。scratch-only runner を必要とせず、新しい隔離 HOME/config/temp を作る。既にインストール済みの依存が前提で、これ自体は OS/network sandbox ではない。RTK/mise で先に有効化した PATH を子プロセスへ渡すため、HOME 変更後に mise の global config を再探索しない。ここでは app/native/exporter を起動しない。下の inline runner 自体は今回実行した repository test ではない。

```sh
rtk proxy mise exec -- bun --no-install --eval '
  const fs = require("node:fs"), p = require("node:path");
  if (!process.env.PI_SCRATCH_DIR) throw Error("Set external PI_SCRATCH_DIR first");
  const root = fs.mkdtempSync(p.join(process.env.PI_SCRATCH_DIR, "sdk-verify-"));
  const home = p.join(root, "home"), temp = p.join(root, "tmp");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(API.?KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|^AWS_|^AZURE_|^GOOGLE_|^GCLOUD_|^OPENAI_|^ANTHROPIC_|^GEMINI_|^MISTRAL_|^GROQ_|^COHERE_|^HF_|^HUGGING|^CLOUDFLARE_|^VERTEX_|^BEDROCK_|^PI_|^PIG_|^NODE_PATH$|^NODE_OPTIONS$|^BUN_INSTALL)/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0,2), HOMEPATH: home.slice(2),
    APPDATA: p.join(home,"AppData/Roaming"), LOCALAPPDATA: p.join(home,"AppData/Local"),
    XDG_CONFIG_HOME: p.join(home,".config"), XDG_CACHE_HOME: p.join(home,".cache"),
    TEMP: temp, TMP: temp, TMPDIR: temp, PI_SCRATCH_DIR: root,
    PI_CODING_AGENT_DIR: p.join(home,".config/pig/pi-agent"), PI_OFFLINE: "1",
    BUN_CONFIG_NO_INSTALL: "1", AWS_EC2_METADATA_DISABLED: "true"
  });
  for (const key of ["HOME","APPDATA","LOCALAPPDATA","XDG_CONFIG_HOME","XDG_CACHE_HOME","TEMP","PI_CODING_AGENT_DIR"])
    fs.mkdirSync(env[key], {recursive:true});
  const commands = [
    ["pnpm","typecheck"], ["pnpm","lint"], ["pnpm","test"],
    ["pnpm","--filter","@pig/desktop","smoke"],
    ["bun","--no-install","test","apps/desktop/scripts/sdk-runtime-assets.test.ts"],
    ["pnpm","--filter","@pig/desktop","exec","vite","build","--configLoader","runner","--outDir",p.join(root,"vite-dist")]
  ];
  console.log("Isolated evidence root:", root);
  for (const cmd of commands) {
    console.log(cmd.join(" "));
    const result = Bun.spawnSync(cmd, {env, stdin:"ignore", stdout:"inherit", stderr:"inherit"});
    if (result.exitCode !== 0) process.exit(result.exitCode || 1);
  }
'
```

fixture が設定した scratch 以外の HOME/profile を指す場合は実行を止める。credential の追加や実 project の open は不要。auth probe の session 実績と永続 `model-runtime.test.ts` は別物であり、上の suite だけで builtin 42 経路を再検証したとは扱わない。

依存監査は `rtk proxy mise exec -- pnpm --filter @pig/desktop list --prod --depth Infinity --json` と `rtk proxy mise exec -- pnpm why -r @earendil-works/pi-durable` で現インストールを確認し、manifest/lock と source/test/smoke/build import も突き合わせる。526 は今回の監査値で、`why` の空出力だけで全 edge/source 無依存を証明しない。

### watcher と配布検証の隔離

- 利用者の dev watcher、Vite port、共有 `build/sdk-runtime[.next]`、artifacts を奪わない。watcher を kill したり、共用 stage を削除して成功に見せない。`pnpm build` は Vite + Electrobun であり read-only 検査ではない。
- [配布設計と永続 packaging tests](../apps/desktop/scripts/sdk-runtime-assets.md) に従い、最終 source/config/hooks/lock/patch を allowlist で専用 scratch snapshot へコピーし、前後の per-file SHA256 を一致させる。build/dist/artifacts/.env/rtk を流用しない。依存参照 link は build snapshot 内だけに限定し、検査する payload は完全 link-free にする。
- その専用 snapshot の `apps/desktop` で順番に `rtk proxy mise exec -- pnpm exec vite build`、`rtk proxy mise exec -- pnpm exec electrobun build --env=dev`、`rtk proxy mise exec -- pnpm exec electrobun build --env=stable`。実 hooks/native prerequisites は維持し、PowerShell profile が実 HOME を読むのも避ける（build 子プロセスは `-NoProfile -NonInteractive`）。
- actual dev と stable archive を repo 外へ安全にコピー/展開し、path traversal/link を拒否。empty cwd、fresh HOME/AppData/SDK profile、credential/resolver/cache env 除去、**payload 自身の `bin/bun.exe --no-install`** で上記 6 checks を再実行。mise Bun に置換しない。manifest/edges/native DLL/全 file hash と installer 内 archive の一致を保存する。詳しい criteria はリンク先を参照。
- native launch は追加の許可・isolation review 後だけ。専用コピー/専用 WebView profile、shipped Bun の home/temp preflight、loopback-only 操作、自分の PID tree のみ cleanup。env/proxy は OS firewall ではない。実利用 app/credentials/legacy data に対して試さない。

## 残る exact acceptance gates

1. **最終 source → 配布一致（今回の自動 gate は成功）**：final report が source inventory、actual dev/stable、両 relocated payload 6/6、installer hash/currentness を結び付けた。ここから source/config/lock/patch を変えた場合はこの gate を再実行し、以前の成功を転用しない。native 受け入れは別途必須。
2. **Native 長時間安定性 / panic / quit**：削除前 payload の限定 startup gate（実 UI-root/RPC/heartbeat/30,016 ms dwell）は成功済みだが、歴史的 panic は未解決。長時間・反復安定性と async app quit の disposal 完遂は未証明。今回の削除では native 調査・起動を行わない。
3. **Windows/WebView2 manual**：日本語 IME composition Enter が送信/shortcut にならないこと、paste/binary/Unicode 幅/mouse/overlay/Escape/focus/hotkey、native clipboard、OSC52 と不正 URL の拒否/安全な外部リンク。Chrome fake IPC の成功で代用しない。
4. **信頼された実 Permission Extension**：deny → 実 tool 実行数 0、cancel/timeout/disconnect でも fail-closed、任意値の成功/承認を捏造しないことを最終 native app で確認する。mock permission fixture だけでは完了しない。
5. **認証/外部 package**：明示的なユーザー許可がある場合のみ実 API/OAuth と provider、実 npm install/update/remove→各 session の pending/apply/failure を確認。秘密を logs/screenshots に含めない。未許可なら未検証のまま明記する。

## Session evidence の参照と保存

今回の scratch root は実装計画 §2 の E の親。以下は **削除前の証跡名で、repository test や永続的な配布検証 runner ではない**。消去前に reports、commands/isolation metadata、inventories、logs/results/screenshots を credential/profile を除いて保管する。fresh checkout の再現は上の repository commands と配布 criteria に従う。

- `sdk-return-runtime-implementation-report.md`、`sdk-return-runtime-postfix-report.md`（最終 suite は後者）。
- `sdk-return-final-opus-review.md`、`sdk-return-react-postfix-report.md`、`sdk-return-archive-postfix-report.md`（Archive static-render script は session-only）。
- `sdk-return-browser-final-report.md`、`browser-verification/final-heartbeat-archive-evidence/`（14 groups、fake IPC）。
- `sdk-return-packaged-app-report.md`（candidate2）、`sdk-return-native-crash-investigation.md`（bounded diagnosis、未解決）。
- `baseline-verification/postfix-final-{tests,typecheck,lint,smoke}.*`、`sdk-return-installed-graph.json`。
- `sdk-return-packaged-final-report.md`、`release-verification/{isolated-build-final-postfix-r2,packaged-final-postfix-r2-report,installer-final-postfix-r2-audit,currentness-final-postfix-r2}.json`（final CLI/SDK/installer/currentness 成功）。
- `sdk-return-native-ipc-report.md`、`sdk-return-native-ipc-findings.md`、`native-ipc-investigation/{final-rpc-ready,verification}.json`（未変更 final native startup/実 IPC/heartbeat/dwell、source/app hash 一致、cleanup 成功）。初期 probe の見落としと無条件ボタンの解釈を訂正。**歴史的 panic の解決・long-haul/manual release gate は pending**。
- `sdk-return-native-symbolization-report.md`、`native-symbolization/{identity-check,decoded-local,panic-site-symbolized,panic-predecessors}.json`（official pinned symbols の照合と local symbolization 成功、compiler-merged panic site の曖昧性）。dispatcher は既知、正確な nullable field/branch と migration/FFI 因果・出荷 fix は未確定。
