# Pi SDK return — implementation contract

> **SUPERSEDED:** `pi-durable-native-migration.md` is the current implementation contract. The SDK-only/runtime/TUI/package requirements below are historical and must not be reintroduced. Preserve unrelated user changes and legacy data; native Durable migration is in progress, not yet accepted.

Status: **SDK application migration implemented; bounded automated verification passed; P5 native/manual release acceptance incomplete** (2026-11-09). Evidence/current limitations: §8 and [verification record](../../docs/sdk-runtime-verification.md). This plan supersedes the SDK→Durable goal dated 2026-11-08. Repository: `cotrin8672/piris`; baseline `53e0a280515975b4be8916f2ee402da1dc48fef9`. Preserve all existing uncommitted UI work. Do not reset/restore whole donor files, commit, or push.

> Superseding user requirement (2026-11-09): remove the legacy Archive feature, reader/schema/RPC/continuation metadata, standalone exporter and numeric/Durable link compatibility outright. Remove the manual Reconnect runtime button only; retain automatic connection/heartbeat/reconnect, ordinary SDK chat archive/pin state and custom-record rendering. Archive/export/legacy-link requirements below are historical and no longer desired; no legacy data is read, migrated or deleted. Prior verification/build evidence predates this removal and does not verify the changed source.

## 1. Accepted requirements and limits

- SDK is the only executable conversation runtime. Pin `@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui` to **1.5.0**; retain current Electrobun/React/Bun/Vite versions and scripts. Remove **all pi-durable imports and direct/transitive dependencies from the normal app/workspace dependency graph**, including tests/smoke/build paths. No dual harness, startup migration harness, or devDependency exception. Remove direct chord only after its app usages disappear; legitimate SDK transitives are not manually deleted.
- Keep current auth store/location and app-only credential policy; OpenAI API/OAuth separation, model overrides/catalog/utility models/thinking levels, general chat, shell choice, images, acceptance-before-clear, session metadata and current UI improvements. Unknown model settings must survive adaptation. One owner updates each catalog, not SDK and old updater simultaneously.
- Snapshot-based React GUI; SDK events are projected in Bun, not a second runtime. Custom UI = actual Pi `TuiAltScreen` → VirtualTerminal → xterm, not ScreenLines/ANSI semantic interpretation, CLI RPC process, PTY, or React form reconstruction. Factory/Component/done values stay in Bun.
- Initial P1/P2 includes Composer Bridge, status/title/working labels, string widgets, **saved + live custom message/entry basic rendering and RND-01**. Optional renderer reuse is P4, not a way to defer data preservation. No new Julia/marketplace standard, durable scheduler, SSH/pairing, arbitrary external fullscreen TTY, or universal extension sandbox claim.
- SDK profile: `~/.config/pig/pi-agent/`; desktop config and `auth.json` remain in `~/.config/pig/`. Do not touch official CLI `~/.pi/agent/` without explicit import choice. Set `PI_CODING_AGENT_DIR` once **before importing SDK** in the Host bootstrap; never vary process-global profile per session. Loader/settings/package manager/session storage/getAgentDir/children must agree.

## 2. P0 evidence and decisions (not application completion claims)

Evidence root E = `C:/Users/gummy/.pi-desktop/scratch/f7baa389-d3ec-41dd-bd7c-cdc623684e14/implementation-p0`.
Sources reused: `../runtime-investigation/sdk-1.5.0`, `ai-1.5.0`, `durable-1.5.0` extracted source maps, and UI investigation's upstream `f9a26365568127461c47a07a37dcb42c140a3ac5`. No broad re-investigation or real credentials/data/network.

### G-AUTH: passing isolated proof, requires the specified local SDK patch

`auth-probe.mjs` executes installed SDK 1.5.0 against a scratch-only copy and **the real pnpm-patched standalone installation** (`E/patch-install`), with in-memory credentials/model store, fake HOME/profile/env, and fetch forbidden. Seven checks pass: public-wrapper overwrite negative control; inert create + first refresh; all **42** builtin check/resolve paths; native/compatibility/unregister replay; stored key and fake OAuth refresh persistence; two runtime registration isolation; **actual AgentSession.reload** replacing a native registration with compatibility registration. Network calls: **0**, fake OAuth refreshes: **1**. This is not real login/provider E2E or complete arbitrary-extension isolation.

Public `Provider.auth.apiKey.check/resolve` wrapping works, but `registerProvider(id, config)` deletes the native wrapper and composes from the builtin again; registration also starts refresh before a post-registration wrapper can be installed. This regression is reproduced. Do not use readonly-provider mutation, private-field access, or a cast to pretend unpatched `ModelRuntime.create` accepts `authContext`.

**Selected minimal patch**: add a real optional `CreateModelRuntimeOptions.authContext: AuthContext`; pass it through the private constructor to `createModels({credentials, modelsStore, authContext})`. Published package patch changes only `dist/core/model-runtime.js` (3 lines) and `dist/core/model-runtime.d.ts` (2 added lines). The desktop imports the unbundled root, not the bundled CLI. Source maps remain upstream maps; record local patch provenance. No global process.env mutation is an app auth policy. SDK provider auth still sees explicitly stored provider-scoped env/config; trusted extension explicit keys/code are not sandboxed.

Patch artifact: `E/pi-coding-agent-1.5.0-auth-context.patch` (48 lines). Both scratch-copy and **bare public package import** (`E/patch-install/auth-installed.mts`) pass strict tsc without casts. Integrator copies the patch into `patches/pi-coding-agent-1.5.0-auth-context.patch` and merges this entry into the existing root **pnpm-workspace.yaml** patchedDependencies (preserve the electrobun patch):

```yaml
patchedDependencies:
  electrobun@1.18.1: patches/electrobun@1.18.1.patch
  '@earendil-works/pi-coding-agent@1.5.0': patches/pi-coding-agent-1.5.0-auth-context.patch
```

Keep root `packageManager: pnpm@10.14.0`. `rtk proxy mise exec -- pnpm install` regenerates lockfile patch hash; frozen-lockfile in CI. **Proven** in external `E/patch-install`: `pnpm install --offline --ignore-scripts` succeeded using pnpm 10.14.0, 122 reused/0 downloaded, and full auth probe + bare-import tsc passed against that install. An initial unpinned scratch attempt selected pnpm 11, ignored package.json's old pnpm field, and failed offline metadata resolution; the corrected pinned YAML route above works. Do not put this setting only in package.json. Equivalent authoring flow: `rtk proxy mise exec -- pnpm patch @earendil-works/pi-coding-agent@1.5.0 --edit-dir "$PI_SCRATCH_DIR/sdk-auth-patch"`, edit the two published files, then `rtk proxy mise exec -- pnpm patch-commit "$PI_SCRATCH_DIR/sdk-auth-patch"`; retain YAML/lock changes. No application dependency changes/install were performed in P0. P1 reruns proof against integrated install and fails startup if the patch contract is absent.

Create every app-owned ModelRuntime with actual patched option `authContext: { env: async () => undefined, fileExists: async () => false }`, app CredentialStore, explicit modelsPath/model store, `refreshOnCreate:false`; explicitly refresh only after construction/policy/profile setup. `allowModelNetwork:false` alone is NOT auth isolation. Existing stored OAuth refresh remains allowed; registration/reload must never replace the collection's auth context.

### G-DATA: passing Storage-only fixture proof

`data-probe.mjs` imports only Storage JSONL/node and chord Context; `storage-only-loader.mjs` rejects Harness/Session/task/tool implementation imports. Process execution and fetch are trapped; counters **0/0**. Original fixture → backup → disposable working copy includes fork-aware entries, paired tool call/result/details, image bytes, unknown custom data, running task and task/conversation documents, and torn main tail. Paginated scans + document materialization export all fixture records; recovery changes **working/main.jsonl only**. Original and backup per-file SHA256 manifests remain exactly equal before/after (`data-results.json`). chmod flags used on fixture files are not a claim of Windows ACL immutability. Real migration must protect retained backup with appropriate filesystem ACL/read-only media and never pass original/backup paths to Storage.open.

**Exporter decision**: separate one-time tool outside pnpm workspace and normal app graph. It may use the retained old installed **1.5.0** through an explicit absolute module root, or its own standalone external package installation with its own lockfile. Retain/copy that tool's dependencies before normal dependency pruning. No exporter import from app, normal package scripts, app bundling, or workspace devDependencies. No Harness.open/resume/registry/tools/models; unknown records remain JSON, not executable migrations.

Installed SDK production-manifest closure: **122 packages, zero unresolved edges, zero pi-durable paths** (`sdk-production-dependencies.json`). Thus SDK 1.5.0 does **not** force a Durable transitive dependency. Recheck the final installed desktop graph/lockfile in P5; stale physical node_modules presence is not dependency ownership.

Reproduce from workspace root (all shell through RTK):

```sh
rtk proxy mise exec -- node "$PI_SCRATCH_DIR/implementation-p0/setup.mjs"
rtk proxy mise exec -- node "$PI_SCRATCH_DIR/implementation-p0/auth-probe.mjs"
rtk proxy mise exec -- node --loader 'file:///C:/Users/gummy/.pi-desktop/scratch/f7baa389-d3ec-41dd-bd7c-cdc623684e14/implementation-p0/storage-only-loader.mjs' "$PI_SCRATCH_DIR/implementation-p0/data-probe.mjs"
rtk proxy mise exec -- pnpm exec tsc --noEmit --strict --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2022 "$PI_SCRATCH_DIR/implementation-p0/auth-contract.mts"
rtk proxy mise exec -- pnpm --dir "$PI_SCRATCH_DIR/implementation-p0/patch-install" install --offline --ignore-scripts
rtk proxy mise exec -- env P0_PATCHED_SDK_ROOT="$PI_SCRATCH_DIR/implementation-p0/patch-install/node_modules/@earendil-works/pi-coding-agent" node "$PI_SCRATCH_DIR/implementation-p0/auth-probe.mjs"
rtk proxy mise exec -- pnpm exec tsc --noEmit --strict --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2022 "$PI_SCRATCH_DIR/implementation-p0/patch-install/auth-installed.mts"
```

## 3. File ownership / parallel work boundary

All application paths below are relative to `apps/desktop/src/`; names are planned, not existing implementations. Runtime owner first publishes the exact shared DTOs below, then UI and Runtime work disjointly. Changes to these contracts require coordinated revision; do not independently invent UI/backend variants.

| Owner | Exclusive files / responsibility |
|---|---|
| Runtime + integration | `shared/runtime-contract.ts`, `shared/extension-ui.ts`, `shared/terminal-ui.ts`, `shared/archive.ts`, `shared/transcript.ts`, `shared/rpc-schema.ts`, `shared/session-links.ts` and their tests; `bun/index.ts`, `bun/pi-service.ts`, `bun/session-host.ts`, `bun/runtime-profile.ts`, `bun/model-runtime.ts`, `bun/sdk-send-receipts.ts`, `bun/sdk-projector.ts`, `bun/image-policy.ts`, `bun/project-trust.ts`, `bun/archive-reader.ts`, `bun/session-files.ts`, auth/model/resource/shell adapters and old durable service/test removal. Sole package.json/pnpm-workspace.yaml/lock/patch integrator. |
| Bun Extension UI/TUI owner | `bun/extension-ui.ts`, `bun/ui-request-broker.ts`, `bun/composer-bridge.ts`, `bun/terminal-ui.ts` and tests. Exports `createExtensionUIHost`, `UIRequestBroker`, `ComposerBridge`, `TerminalUIHost` as below; no edits to session-host or shared schema. |
| React UI owner | `mainview/App.tsx`, `rpc.ts`, `store.ts`, `Composer.tsx`, `chat-snapshot.ts`, transcript renderers, `UIRequestBroker.tsx`, `TerminalDialog.tsx`, `terminal-ui.ts`, `terminal.css`, `draft-store.ts`, `extension-status.tsx`, `ArchiveView.tsx`, related tests/styles. Preserve all pre-existing UI edits, especially Settings/model picker/effort/CSS/i18n. |
| Package owner (after contracts) | `bun/packages.ts`, `bun/package-queue.ts`, `mainview/Extensions.tsx`, `extensions.css`, `shared/packages.ts` and tests; coordinate root entry wiring through integrator, no independent profile creation. |
| One-time data exporter | External standalone `exporter.mjs` + its fixture tests/install instructions; no workspace package dependency. Archive reader belongs to Runtime; display belongs to React. |

Do not create a generic multi-harness/plugin transport framework. `pi-service.ts` remains the RPC-facing facade. Bun owns SDK types; no AgentSession/Component/functions cross IPC. Shared DTOs may use existing pi-ai Message/ImageContent types, but no SDK session or Durable types.

## 4. Frozen shared contracts

### 4.1 Runtime identity, opening and snapshots — `shared/runtime-contract.ts`

```ts
export type SessionAddress = { hostId: string; sessionId: string; epoch: number };
export type UIAddress = SessionAddress & { uiId: string };
export type SessionPhase = 'opening' | 'ready' | 'closing';
export type OpenSessionParams = { openId: string; cwd: string; id?: string };
export type OpenState =
  | { state: 'opening'; address: SessionAddress }
  | { state: 'ready'; snapshot: Snapshot }
  | { state: 'failed' | 'cancelled'; message: string }
  | { state: 'unknown' };
export type RuntimeEvent =
  | { type: 'opening'; openId?: string; previous?: SessionAddress; address: SessionAddress; cwd: string }
  | { type: 'ready'; openId?: string; snapshot: Snapshot }
  | { type: 'replaced'; previous: SessionAddress; snapshot: Snapshot }
  | { type: 'closed'; address: SessionAddress; reason: 'close' | 'cancelled' | 'failed'; message?: string }
  | { type: 'snapshot'; snapshot: Snapshot };
```

`Snapshot` in rpc-schema retains existing info/model/effort/contextUsage/transcript/failure/aborted and adds `address: SessionAddress; snapshotSeq: number`. `WireEvent` remains `{type:'snapshot', address, snapshotSeq, transcript, failure?, aborted?}`; no raw SDK event exposure. RPC session snapshot publication is ordered by address + snapshotSeq; ignore older publications/open responses. `SessionInfo.id` and `address.sessionId` are the actual opaque SDK SessionManager ID, **never numeric coercions**. SessionManager is allocated/opened before SDK session creation, enabling opening address registration. `openId` is client UUID correlation/idempotence key; changed cwd/id with the same openId is rejected. Allocate hostId once per Bun process and monotonically increasing epochs across reopening/reload/replacement; never reuse an epoch within a host.

Fork/new/switch may change the persisted SDK ID: Runtime emits `replaced` mapping previous address to the new Snapshot and UI remaps tab/draft ownership explicitly. Reload keeps SDK ID, increments epoch and also emits `replaced`. Do not use persisted SDK IDs as arbitrary filenames; host resolves known sessions/workspace membership. Legacy numeric links map to `legacy-durable:<id>` Archive references, not a new session with similar text. Reject traversal/oversize/unknown links. Transitional timestamp fork API rejects ambiguous matches; new APIs require entryId.

### 4.2 Acceptance and draft contract — `shared/runtime-contract.ts`, `shared/extension-ui.ts`

```ts
export type SendKey = SessionAddress & { requestId: string };
export type PromptAccepted = { disposition: 'started' | 'queued' | 'handled' };
export type PromptReceipt = SendKey & (
  | { state: 'pending' }
  | { state: 'accepted'; accepted: PromptAccepted; acceptedAt: number }
  | { state: 'rejected'; code: string; message: string }
  | { state: 'unknown'; reason: 'host-restarted' | 'not-found' }
);
export type DraftContent = {
  text: string;
  pastes: { id: string; marker: string; text: string }[];
  images: { id: string; image: ImageContent }[];
};
export type DraftState = DraftContent & { revision: number };
export type DraftSyncParams = SessionAddress & { expectedRevision: number; content: DraftContent };
export type DraftSyncResult = { applied: boolean; draft: DraftState };
export type PromptParams = SendKey & {
  text: string; images?: ImageContent[]; draftRevision: number;
};
```

A send's canonical payload hash includes expanded text, ordered image bytes/MIME, draftRevision and address. The Host registers pending **before** prompt/preflight. Same key+hash returns the same pending/terminal receipt; same key+different payload fails with `REQUEST_ID_CONFLICT`. Keep terminal receipt records for Host lifetime, including closed/old epochs (no silent eviction permitting retransmit); lookup is read-only and may query old epochs. New mutation requests must match current host/address. A crash loses receipts: `unknown`, never exactly-once across crashes.

Per session/epoch admission mutex serializes **preflight only**, released at `preflightResult` or pre-accept failure, not at model completion. This prevents two different IDs racing through async auth/input handlers into started. `sdk-send-receipts.ts` is the sole adapter to the real typed SDK 1.5.0 internal `preflightResult` option. Always attach prompt Promise failure handling; accepted model/extension errors are separate Snapshot failures, not rejected acceptance. `handled` is dispatch acceptance, not proof the handler succeeded (`bindExtensions.onError` projects errors). Empty input with no viable image is rejected by Host.

Preserve Electrobun `maxRequestTime: 600_000` (existing mainview/rpc.ts:93), on Bun and UI. The prompt RPC returns acceptance, not full prompt Promise. Timeout/transport error is **indeterminate**, not rejection: retain draft/images/requestId, show “checking acceptance,” call `getPromptReceipt`, and poll only lookup while pending. Never automatically call prompt again after timeout. Accepted → clear only if local revision still equals sent revision; rejected → retain and show error; unknown/Host changed → retain, warn possible execution, offer user-confirmed new send with new ID only after inspecting history. Stop/Close must cancel preflight/UI even when prompt RPC is pending. Lookup RPCs must not wait on the admission mutex.

ComposerBridge keeps synchronous Bun mirror for getEditorText. UI `syncDraft` RPCs are ordered/awaited before command/prompt/shortcut invocation; CAS conflicts return current draft, never overwrite newer extension edits silently. Server assigns revision; Extension setEditorText changes text/reconciles paste markers but preserves images; pasteToEditor uses same folding/paste rules. `draft` event publishes the whole updated state. UI local unsynced edits are reconciled rather than discarded; inactive-session edits never touch active draft. Epoch rotation transfers draft explicitly; late old-epoch ACKs cannot clear new draft.

### 4.3 Root Broker, Trust and status — `shared/extension-ui.ts`

```ts
export type UIRequest = UIAddress & {
  parentUiId?: string; title: string; expiresAt?: number;
} & (
  | { kind: 'confirm'; message: string }
  | { kind: 'select'; options: string[] }
  | { kind: 'input'; placeholder?: string; initialValue?: string }
  | { kind: 'editor'; initialValue?: string }
  | { kind: 'project-trust'; cwd: string; fingerprint: string;
      resources: { path: string; kind: 'code' | 'settings' | 'instructions' | 'skill' | 'prompt' }[] }
  | { kind: 'terminal' }
);
export type UIReply = UIAddress & (
  | { kind: 'cancel' }
  | { kind: 'confirm'; value: boolean }
  | { kind: 'select' | 'input' | 'editor'; value: string }
  | { kind: 'project-trust'; value: 'once' | 'persist' | 'safe' }
);
export type ExtensionStatus = {
  statuses: { key: string; text: string }[];
  widgets: { key: string; lines: string[]; placement: 'aboveEditor' | 'belowEditor' }[];
  title?: string; workingMessage?: string; workingSymbol?: string;
  hiddenThinkingLabel?: string;
};
export type ExtensionUIEvent =
  | { type: 'request'; request: UIRequest }
  | { type: 'requestEnd'; address: UIAddress; reason: 'done' | 'cancelled' | 'timeout' | 'failed' }
  | { type: 'draft'; address: SessionAddress; draft: DraftState }
  | { type: 'status'; address: SessionAddress; status: ExtensionStatus }
  | { type: 'notify'; address: SessionAddress; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'capability'; address: SessionAddress; api: string; supported: boolean; message: string };
```

Root subscribes to runtime/extension/terminal events **before any open RPC**, independently of chat mount/navigation. One unified waiting/focus list for native and terminal requests, not two independent blocking FIFOs. Parent/child calls identified by Bun AsyncLocalStorage where possible; foreground waiting children; unsupported independent custom nesting fails explicitly. Pi overlays remain inside their TUI. Another session cannot silently steal focus. Validate reply kind, selected value membership, address and size; resolve once. Cancellation: confirm=false; select/input/editor=SDK cancellation value; custom rejects AbortError, never guesses T. Human deadlines (SDK options/signal) are distinct from terminal-ready timeout. No UI availability means deny/fail, never grant.

Project Trust is an **initial Broker request**, before project code/config execution: wire `ResourceLoader.reload({resolveProjectTrust})` and SettingsManager trust. Show existing project code/instructions/skills/prompts and global resource sources, trust-once/persist/open-safe/cancel. Safe mode visibly lists omitted resources and offers trust+reload; never silently drop old `.pi` assets/AGENTS/SYSTEM compatibility. Global `~/.config/pig` resources are explicitly mapped into SDK additional paths/overrides; test SYSTEM/APPEND_SYSTEM/AGENTS precedence and linked worktrees. Discovery must not evaluate project code before approval. Trust is not Permission or OS sandbox.

### 4.4 Terminal transport — `shared/terminal-ui.ts`

```ts
export type TerminalHostEvent = UIAddress & (
  | { type: 'open'; title?: string; parentUiId?: string }
  | { type: 'data'; seq: number; data: string }
  | { type: 'close'; reason: 'done' | 'cancelled' | 'failed'; message?: string }
);
export type TerminalClientCommand = UIAddress & (
  | { type: 'ready' | 'resize'; cols: number; rows: number }
  | { type: 'input'; inputSeq: number; encoding: 'text' | 'binary'; data: string }
  | { type: 'ack'; seq: number }
  | { type: 'cancel' }
);
```

Each terminal request also enters UIRequestBroker; terminal `open` is transport initialization, not a second dialog. UI creates xterm, registers output listener, fits, then ready; Bun only then starts actual TUI/factory. ready idempotent; inputSeq/output seq increase from 1 per UI; cumulative ack only after xterm.write callback. Reject stale host/session/epoch/uiId, duplicate input/ready and impossible/future acks. Preserve ANSI order/fragment boundaries; no arbitrary dropping. Initial limits: input packet ≤64 KiB UTF-8 (binary each char 0..255, measured bytes); outstanding output ≤1 MiB UTF-8; dims integer 2..1000 cols, 1..1000 rows; ready deadline 15 s. Coalesce resize; validate/rate limit ingress. Overflow explicitly fails/cancels that UI, not truncated ANSI continuation. Terminal.write is synchronous: no promise to throttle arbitrary extension code.

Forward onData once, onBinary separately; IME/composition Enter must not trigger Composer send/shortcuts. Escape goes to Pi Component; explicit close is cancel. OS/shell/PTY input is not this protocol. Root surfaces survive tab switches; WebView disconnect/reload cancels pending custom UI (initial release has no live terminal resume). Shared user keymap via public KeybindingsManager and global TUI key manager; no donor empty-on-reload keymap. Theme/capabilities Host-wide consistent, no per-session global race; reject unadvertised Kitty/image/query features. xterm text only, no innerHTML, OSC52/extra privilege handlers disabled; Host validates external http/https links on click.

### 4.5 Transcript projector — `shared/transcript.ts`, `bun/sdk-projector.ts`

```ts
export type TranscriptRecord = {
  id: string; entryId?: string; parentId: string | null; branchId: string;
  order: number; rendererKey?: string;
} & (
  | { kind: 'message'; message: Message; customType?: string; details?: unknown; display?: boolean }
  | { kind: 'custom-entry'; customType: string; data: unknown }
  | { kind: 'session-entry'; entryType: string; data: unknown }
);
export interface Transcript {
  records: TranscriptRecord[];
  tools: Record<string, { status: 'running' | 'done' | 'error'; result?: unknown }>;
  current: string | null;
  running: boolean;
  liveToEntry: Record<string, string>;
}
```

`Message` is existing pi-ai model Message **plus** an app-owned serializable custom-message variant `{role:'custom',customType:string,content:unknown,display:boolean,details?:unknown,timestamp:number}`. Saved records use exact string entry IDs; temporary live IDs are `live:<epoch>:<counter>`, never array index/timestamp identity. branchId is current leaf ID (or `root`), parentId is persisted parent or null; SDK metadata/nonmessage entries are retained without invented messages. Project SessionManager.getEntries/getBranch/getTree on restore and resync; use `entry_appended` for live appendEntry data and SDK message/tool updates for transient changes. CustomEntry has **customType/data**, not content. Deduplicate by entryId and map live→committed IDs. Basic JSON/text/details rendering is mandatory and safe even absent/throwing renderer; do not infer Plan/Goal semantics. Tool partial/final, call IDs, details, error and GUI images survive. Use `agent_settled` for completion, not `agent_end`. Snapshot resync closes event gaps.

### 4.6 RPC additions and changed parameters — `shared/rpc-schema.ts`

Keep existing unrelated auth/settings/models/projects/image RPCs unchanged. Register these exact request names (response types above; `void` uses existing Electrobun convention):

```ts
openSession(params: OpenSessionParams): Promise<Snapshot>;
getOpenState(params: { openId: string }): Promise<OpenState>;
cancelOpen(params: { openId: string }): Promise<void>;
getSessionSnapshot(params: SessionAddress): Promise<Snapshot>;
prompt(params: PromptParams): Promise<PromptAccepted>;
getPromptReceipt(params: SendKey): Promise<PromptReceipt>;
syncDraft(params: DraftSyncParams): Promise<DraftSyncResult>;
resolveExtensionUI(params: UIReply): Promise<void>;
terminalCommand(params: TerminalClientCommand): Promise<void>;
abort(params: SessionAddress): Promise<void>;
closeSession(params: SessionAddress): Promise<void>;
reloadSession(params: SessionAddress): Promise<{ state: 'applied' | 'pending' }>;
forkSession(params: SessionAddress & { entryId: string }): Promise<Snapshot>;
rewindSession(params: SessionAddress & { entryId: string }): Promise<Snapshot>;
runtimeState(): Promise<RuntimeViewState>;
```

`RuntimeViewState = { hostId: string; sessions: {phase: SessionPhase; snapshot?: Snapshot; address: SessionAddress; openId?: string}[]; pendingUI: UIRequest[]; drafts: {address: SessionAddress; draft: DraftState}[]; statuses: {address: SessionAddress; status: ExtensionStatus}[] }`. Used for initial Root state and explicit reconnect snapshot, not terminal replay. UI→Bun messages `connectUI` / `disconnectUI` carry `{clientId:string}`; Host cancels UI owned by lost view (also on native transport/window loss, not only cooperative disconnect). Bun→UI messages: `runtimeEvent: RuntimeEvent`, `extensionUIEvent: ExtensionUIEvent`, `terminalEvent: TerminalHostEvent`. Keep legacy `sessionEvent` as addressed WireEvent during UI migration only; never apply duplicate snapshot effects. Remove old unaddressed abort/close messages once callers move. Exact mutations: `setModel(params: SessionAddress & {provider:string; id:string}):Promise<ModelSelection>` and `setEffort(params: SessionAddress & {effort:Effort}):Promise<ModelSelection>`; stale addresses cannot target replacements.

Opening RPC also keeps 600000 ms transport limit: timeout uses getOpenState(openId), not another open. cancelOpen works before address arrives; mark cancellation synchronously, cancel Broker requests, and destroy late initialization results. Keep root listeners active while open waits on trust/session_start/custom UI.

## 5. Bun module APIs and lifecycle

`bun/session-host.ts` exports `SessionHost` with methods matching the RPC names in §4.6 (pi-service/index delegate); constructor dependencies are concrete app credentials/profile/settings and event sinks, not a harness interface. Host owns one **AgentSessionRuntime per open session**, created via createAgentSessionRuntime with cwd-bound services factory. Always pass app-owned ModelRuntime to createAgentSessionServices; never fall back to SDK's profile auth.json runtime. Auth/settings pre-chat catalog has its own **user-only ModelRuntime**. Every session has a distinct ModelRuntime (even same cwd); shared CredentialStore/common config only. Credential changes refresh all live instances. User-approved extension providers may load pre-chat; workspace providers never enter the user-only/global catalog.

Track registration IDs/origin for that session, including native/compatibility/virtual registrations, through public runtime registration methods. Reload removes previous extension-origin registrations with public unregister methods before new resource factories register (place removal in the owned ResourceLoader.reload delegation, after old SDK shutdown/invalidation). Stored models.json/builtin definitions remain. Deleted extensions must disappear; A reload/remove cannot affect B. SDK's process-global low-level API registry reset on reload and arbitrary extension globals are not fully isolated: serialize loader/reload operations Host-wide and test concurrent sessions; do not promise process isolation.

`bun/extension-ui.ts` exports:

```ts
export function createExtensionUIHost(options: {
  address: SessionAddress;
  broker: UIRequestBroker;
  drafts: ComposerBridge;
  emit: (event: ExtensionUIEvent) => void;
  emitTerminal: (event: TerminalHostEvent) => void;
}): ExtensionUIHost;
export interface ExtensionUIHost {
  readonly uiContext: ExtensionUIContext; // SDK type, Bun only
  handleTerminal(command: TerminalClientCommand): void;
  getStatus(): ExtensionStatus;
  rotate(address: SessionAddress): void;
  cancelAll(reason: 'stop' | 'close' | 'reload' | 'disconnect'): void;
  dispose(): void;
}
```

`UIRequestBroker` constructor takes `(emit:(event:ExtensionUIEvent)=>void)` so trust UI works before any ExtensionUIHost. Exposes `request(request:Exclude<UIRequest,{kind:'terminal'}>):Promise<UIReply>`, `resolve(reply:UIReply):void`, `cancelSession(address:SessionAddress):void`, `pending():UIRequest[]`, `registerTerminal(request:UIRequest & {kind:'terminal'},cancel:()=>void):void`, `endTerminal(address:UIAddress,reason:'done'|'cancelled'|'failed'):void`. Custom requests are registered in the same focus/waiting list but their arbitrary result Promise belongs only to TerminalUIHost; native Broker replies never carry a custom result. `ComposerBridge` takes the same event sink and exposes `read(address:SessionAddress):DraftState`, `sync(params:DraftSyncParams):DraftSyncResult`, `setText(address:SessionAddress,text:string):void`, `paste(address:SessionAddress,text:string):void`, `transfer(previous:SessionAddress,next:SessionAddress):void`, `remove(address:SessionAddress):void`; initialize revision 0. `TerminalUIHost` exposes SDK-typed `custom:ExtensionUIContext['custom']`, `handle(command:TerminalClientCommand):void`, `cancelAll():void`, `dispose():void`; ExtensionUIHost delegates handleTerminal to it. Keep SDK uiContext stable across reload, dispatching to current epoch surfaces, not disposed old hosts.

Lifecycle ordering (all mutations serialized per Host session; cancellation signal/mark is immediate):

1. **Open**: Root listeners connected → allocate SessionManager/address + register opening → trust decision → services/SDK create → attach projector subscription/UI facade → bindExtensions once with mode:'tui', commandContextActions, abort/shutdown/onError → await session_start → ready/open response. Failure or cancelled open always ends Broker and disposes whatever was created, including late results.
2. **Stop**: cancel target pending UI/preflight, reject new admission while stopping, await session.abort; preserve receipt status already accepted. Do not stop another session. Persisted data stays SDK-owned.
3. **Close/app quit**: mark closing immediately; cancel UI/preflight and reject new UI; await abort/settlement; call **AgentSessionRuntime.dispose() once** (emits shutdown reason quit); setBeforeSessionInvalidate performs synchronous surface disposal/subscription teardown; remove Host state. Direct AgentSession.dispose alone does not emit shutdown. Noncooperative extension hang is diagnosed, not called forcibly reclaimed.
4. **new/switch/fork**: use AgentSessionRuntime.newSession/switchSession/fork through commandContextActions; not nonexistent AgentSession replacement APIs. Runtime aborts/emits correct shutdown; before-invalidate callback disposes old UI/subscriptions; setRebindSession registers new opening address, reattaches projector/UI and binds new session once before finishing startup. Emit replaced, transfer draft deliberately. Veto before-switch/fork leaves old session/address intact.
5. **Reload**: defer while running/admission/UI waiting; report pending. Explicit stop/cancel allows applying. Cancel/dispose old surfaces and clear status, deny UI during transition; call session.reload once. SDK emits shutdown(reason:reload), invalidates runner, reloads resources, reapplies retained binding, emits startup(reason:reload). Use beforeSessionStart to rotate epoch/facade and emit opening(previous) before new startup UI; publish replaced Snapshot after startup completes. Never call bindExtensions again on the same reload. If reload fails, publish failure/disabled extension state, not applied. Cleanup must continue across disposal exceptions.

`registerShortcut`: initial P2 explicitly **unsupported in React Composer** with per-extension capability warning; shortcut-only entrypoints are never “compatible verified.” Terminal Component key handling/onTerminalInput apply only to actual terminal focus/input, not global React. P4 may add Composer shortcut dispatch using public getShortcuts(effectiveConfig), with address/draft flush, focus ownership, browser conflict/IME checks, and handler error reporting; do not silently advertise it because mode=tui. Component widgets/header/footer, custom editor/autocomplete and renderer surfaces are separately capability-listed, never fabricated success/approval values.

`bun/image-policy.ts` is sole image-policy owner: exported `preparePromptImages(images:ImageContent[], options:{queued:boolean; blockImages:boolean; provider:string; modelId:string}):Promise<{images:ImageContent[]; hints:string[]}>`. Append returned decode/block hints to text before admission. Idle path uses SDK normalization once; queued followUp bypasses SDK processImage and therefore must normalize in Host before acceptance. Capture the model policy for queued images; defer Host model changes while those images remain queued, or prove a consumption-time revalidation hook before allowing them (do not assume SDK does it). Do not double resize idle inputs. Extension-inserted images, tool results, saved-history projection and model context each enforce blockImages, not only Composer; scrub before persistence where existing policy did. Preserve existing decode-failure text/hint fallback and GUI image gallery. Test queued model changes, including extension-driven changes; if unsupported, reject/defer explicitly. Shell adapter preserves Git Bash usr/bin/Bun workaround and separate truthful PowerShell tool name/description/arguments/stop/timeout. No broad permission increase.

## 6. Immutable Archive and app/export workflow

`shared/archive.ts` owns backend-free JSON types; never imports Durable. `ArchiveV1` uses the fixture's exact envelope:

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ArchiveV1 = {
  format: 'piris-archive'; version: 1;
  source: { engine: 'pi-durable'; version: '1.5.0'; files: Record<string, string> };
  conversations: { legacyId: string; raw: JsonValue; entries: JsonValue[] }[];
  tasks: JsonValue[];
  submissions: JsonValue[];
  documents: JsonValue[];
  diagnostics: { code: string; files?: string[]; message?: string }[];
};
export type ArchiveRef = { archiveId: string; legacyId: string };
export type LegacyDataStatus = { detected: boolean; exported: ArchiveRef[]; instructions: string };
```

Archive ID = SHA256 of exact UTF-8 JSON file bytes, file `archive-<sha256>.json`, written create-exclusive, then read-only. Do not rewrite archives for metadata changes; pins/read state live in desktop metadata keyed by ArchiveRef. Verify digest and format/version before reading. Unknown JSON/kinds remain accessible as raw data. `raw` retains conversation id/parent/owner; `entries` preserves ascending fork-aware history, model messages/tool pairs/details/images, custom data/head/context edits/task attribution. `documents` stores Storage.document's `{record,version,value,deltasSinceBase}` current materialized values for session, every conversation, and every task scope. `tasks/submissions` preserve unfinished state; no restoration/execution. Original full directory + manifest preserves raw historical document versions/sidecars not materialized into v1. Diagnose torn recovery and inaccessible/unknown data, never silently declare migration complete.

`bun/archive-reader.ts` exports `detectLegacyData():Promise<LegacyDataStatus>`, `listArchives():Promise<ArchiveRef[]>`, `readArchive(ref:ArchiveRef):Promise<ArchiveV1>`. It performs only filesystem detection/validated JSON reads; no Durable load. RPC requests use the same names/params (`readArchive` takes ArchiveRef, others parameterless). Legacy detection at normal startup checks existence/format marker names only; **does not open/recover storage**. UI always exposes “Legacy conversations stored — not executable here,” export instructions and import/view Archive. Unknown/corrupt/inaccessible legacy format is reported, not deleted or hidden.

Explicit user migration workflow (no real data operations authorized in P0):

1. Stop/quit old desktop and confirm no writer. Back up desktop settings/model config/auth separately, without logging secrets; copy the **whole durable directory** including doc-/task- sidecars to a retained backup, record relative-path/size/SHA256 manifest, verify copies, protect backup against writes.
2. Create separate disposable working copy of backup. External tool accepts `--source-manifest`, `--working-copy`, `--output`; refuses source=backup/output overlap, missing manifest, changing source hashes, unknown version. SDK app never invokes it automatically. Only this working copy is opened/recovered with old Storage API. Log recovered file differences; scan conversations/entries/tasks/submissions/documents with pagination and no definition registry/migrations.
3. Write and validate content-addressed Archive; verify original AND retained backup hashes unchanged. Show counts/diagnostics/tool pairs/images/branches and unfinished tasks; import only Archive into SDK profile archive directory. Preserve original/backup indefinitely until explicit user cleanup outside this migration.
4. Reader/UI lists names/cwd from preserved entry/document JSON (including pig.name), with raw fallback. Legacy links and metadata resolve to ArchiveRef. “Continue in SDK” creates a **new SDK session** from user-confirmed summary/quotes, records legacy→new mapping; never claims full context/task/session-affinity continuation. Full context import is out of scope. Rollback uses retained old binary + untouched original/backup; no SDK→Durable conversion promise.

## 7. Phases and gates (do not conflate automated P2 and manual P5)

| Phase | Required deliverable / exit gate |
|---|---|
| P0 (this plan) | G-AUTH and G-DATA isolated evidence above; corrected shared contracts; superseded goal. Baseline checks are owned by separate baseline agent; import its results, do not invent passes. No app/package edits in P0. |
| P1a — integration skeleton | Publish shared contracts; apply/pin auth patch; bootstrap fixed profile; Root Broker receive path + project trust UX + opening/epoch/cancelOpen before extension startup. UI-01 dependency gate must pass before extension-enabled P1b open is called complete. |
| P1b — SDK runtime | SessionHost/AgentSessionRuntime/ModelRuntime ownership, all ordinary operations, snapshot projector with live/restored custom entries, receipt lookup/admission/timeout, Composer mirror/status/string widgets, image/resource/shell adapters. Mock chat/tools/stop/close/reopen/fork/rewind/model/effort/auth tests; no numeric-ID assumptions. G-AUTH rerun on pnpm-patched install; G-PROFILE and G-SHELL fixtures; RND-01 basic data cannot be deferred. Remove durable execution code/type/tests/dependencies as SDK replacements land, not a parallel selectable runtime. |
| P2 — automated UI/TUI | Restore donor selectively from `6e40d0d4f8a7efdee38b62c46f8b1347f10ae33d`, adapt contracts. Automated Root startup confirm/custom/trust and Close; broker nested/parallel cancellation; done arbitrary Bun value/sync/double/late factory; stale epochs/ready/input/ack/output limits/disconnect; keymap/overlay focus; Composer revision/image retention/inactive drafts/status/widgets; RND-01 restored/live custom data and renderer-error raw fallback. Permission denial fixture proves tool execution count zero. Existing donor 16 tests are useful but not substitute for new integration tests. **No requirement for real providers or manual WebView IME to finish automated P2.** |
| P3 — package/provider | Normal Pi Marketplace, SDK DefaultPackageManager user-scope install/update/remove, profile queue, approved pre-chat provider entry, per-session apply-pending and failed reload reporting. A/B provider identity/removal isolation and same-cwd sessions tested; install success ≠ loaded. SDK duplication warnings retained; npm/network errors visible. Package update must not touch project scope accidentally. |
| P4 — optional enhancement | Public message/tool/entry renderer reuse and component widget/header/footer small surfaces; lifecycle/width/partial/final/expand/fallback; optional shortcut/editor integration explicitly scoped. Never defer basic custom data/Composer/status/string widgets to P4. |
| P5 — release/manual | Windows/WebView2 **manual** IME/paste/mouse/binary/Unicode widths/overlay/focus/hotkey checks; real trusted Permission Extension deny→no tool; malicious OSC/URL checks; opt-in real auth only with user authorization; packaged Electrobun dynamic extension/assets/theme/code-mode/module resolution. Final Archive workflow fixture/reader, detection UX/README, installed graph+source+tests+lock no Durable dependency, rollback instructions. Manual/unavailable tests explicitly pending; no “complete migration” with security/release gates unverified. |

Mandatory automated send cases: two distinct IDs during async auth/input handler; same ID pending retry and payload conflict; queued input with images; pre-accept error preserves draft; accepted model/command error does not resend; timeout at existing 600000 limit uses lookup; Host restart unknown; Stop/Close during admission/startup; stale ACK cannot clear edited/replaced draft. Mandatory lifecycle cases: shutdown once on close/replacement/reload, old context/surfaces/listeners/timers released for cooperative extensions; new startup UI works; no duplicate bind/startup.

Verification after each integrated phase: `rtk proxy mise exec -- pnpm typecheck`, `rtk proxy mise exec -- pnpm lint`, `rtk proxy mise exec -- pnpm test`, and from apps/desktop `rtk proxy mise exec -- pnpm exec vite build`. Preserve/report pre-existing baseline failures separately. P5 checks actual distribution, not just Vite. Completion requires P1–P3 mandatory surfaces **including RND-01** plus P5 safety/manual evidence; P4 optional API limitations must be visible in UI/docs. P0 probes close feasibility questions, not these remaining integration gates.

## 8. 実装・検証の到達点（2026-11-09、契約変更ではない）

**通常会話の SDK 移行と限定自動検証は完了。全機能/native/release 完了ではない。** §§1–7 の契約・手動 gate は維持する。再現コマンド、機能 coverage、証拠の種別、残る exact acceptance gates は [SDK runtime verification](../../docs/sdk-runtime-verification.md) を参照。

- P1/P2 mandatory runtime/UI と RND-01 basic records、P3 package/provider の実装・自動 fixture を統合。P4 optional renderer/editor/Composer shortcut は未対応能力として明示し、全 extension 互換とはしない。SDK/AI/TUI 1.5.0 と [auth-context patch](../../patches/pi-coding-agent-1.5.0-auth-context.patch) を適用。実インストールへの隔離 auth probe は 7 checks、builtin 42 経路、network 0、偽 OAuth refresh 1（実 login ではない）。
- 通常 installed graph は **526 nodes / required missing edges 0 / Durable nodes 0**、lock の pi-durable 0、direct chord なし。app/source/test/smoke/build の Durable 実行経路は除去。外部 exporter と Archive 手順は後続の明示要求により削除済み。実 legacy-data は未変更。
- 最終 whole-tree postfix: **268 pass、0 fail、1,532 assertions、63 files + 別 child UI 11 pass**。typecheck、lint（202 files、fix なし）、SDK faux-provider smoke は成功。Chrome production React/xterm は **14/14 groups**、frontend build は成功。ただし fake IPC の session harness であり、永続 repository suite/native WebView2 E2E と混同しない。
- final Opus review は 1 回実施済み。F1 model/effort、F2 transition admission、F3 trust boundary、F4 safe-mode 整合、F5 Archive diagnostics/refresh は live-source 照合・postfix・回帰テストで対処。R2 は失敗 transition を閉じる fail-closed。Root heartbeat/lease は非協調 view loss の UI/startup cancellation を自動検証。**F6 `apps/desktop/rtk/history.db` は保持**。postfix 後の独立再 review は主張しない。
- final-postfix-r2 の **actual Electrobun CLI dev/stable + 両 relocated payload SDK 6/6 + installer archive hash + source/snapshot/app currentness は成功**（203 inputs、source inventory SHA256 `197729443352aa3d2697ff3c62cc48a9ab70a9ba35ad1df045e95961fb472a74`）。final report 到着を反映。初回 Windows stage-rename EPERM は記録を残し、同一 source hash の新規 snapshot で 1 回再試行して成功。shipped Bun 1.3.13 を維持、installer は未実行。配布自動検証成功 ≠ native 安定性成功。
- **限定 native startup/IPC は成功**: 未変更の exact final stable payload で actual UI-root の hostId 受理・保持、既存暗号化 WebSocket 経由の実 `runtimeState` response、UI 自身の 6 connected heartbeat replies、response 後 **30,016 ms dwell**、panic なし、cleanup を確認。203 source inputs と authoritative app/成功コピー各15,388 original files の hash は一致。`Reconnect runtime` は `App.tsx:111–117` の無条件ボタンで接続失敗ではなく、不在を gate にしない。以前の推測と socket response を見落とした初期 probe は訂正し、UX/source 変更は要求しない。
- **Native stability blocker は残る**: candidate2 の約2.7秒 Bun1.3.13 null-value panic / exit9 は未解決。official pinned symbol bundle の digest / PDB GUID・age / shipped `.text` 一致を確認し、**local symbolization は成功**：Worker event loop の `Task.tickQueueWithCount` → `std.debug.unwrapNull` は確定。ただし複数 null checks が同一 panic callsite に compiler-merge され、保存された最適化 trace から正確な nullable field/branch は一意に復元できない。raw inline ReadFile/S3 labels は因果を示さず、FFI/SDK移行の因果も未証明。必要な次の証拠は将来の失敗processでunwind前のlocal dump/registers/task tag、またはinstrumented same-source Bun。upgrade/推測fixは推奨せず、symbolizationでapp/runtime/native変更・upload・新規native launchは行っていない。8 candidate + 3 final非再現や限定startup成功をlong-haul release approvalと混同しない。P5の残りは元panicの解決/受け入れ判断、長時間・反復安定性/async quit disposal、WebView2手動IME/paste/binary/mouse/幅/overlay/focus/hotkeys/OSC/URL、実Permission deny→tool0、許可時のみ実auth/provider/npm、実legacy-data manifest/ACL/export/import/rollback受け入れ。SDK process-global registry/任意extension globals、非協調JS強制回収、streaming性能の制限も保持する。

証跡は scratch の runtime-implementation/postfix、final-opus-review、react-postfix、browser-final、archive-postfix、packaged-app、packaged-final、native-crash-investigation、native-ipc-report / native-ipc-findings、**sdk-return-native-symbolization-report.md**。詳しい識別名と保存方針は verification record に記載。ad-hoc probe/browser/static-render/native harness を repository tests と呼ばず、scratch 消去前の証跡保管と repository コマンドによる再実行を区別する。
