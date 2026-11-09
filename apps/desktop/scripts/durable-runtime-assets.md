# Native Durable distribution assets

`electrobun.config.ts` externalizes Durable, pi-ai and Chord **1.5.0**, the
app-owned `@pig/config` **0.1.0** (API v2), plus CodeMode and Photon subpaths.
Their production closure retains module locations/exports, adjacent CodeMode
workers, QuickJS WASM and Photon WASM.
Electrobun's own framework/native bundling and the existing application identifier
(`dev.piris.desktop`) are unchanged. No SDK, TUI, terminal compatibility layer or
Node service is shipped through this stage.

The `preBuild` hook `durable-runtime-assets.ts` copies the installed production
closure into `build/durable-runtime`. It follows required dependencies/peers and
installed optional edges, never devDependencies, an external cache, a registry,
install scripts or source patches. Native roots and CodeMode must match 1.5.0;
Photon must match 0.3.3. SDK/TUI packages and xterm are rejected even on optional
edges. Changes to dependencies must first be installed/locked by their owner.

One identity per name is hoisted; conflicting versions are nested with ordinary
`node_modules` resolution. Cycles reuse visible identities. Package contents,
assets, licenses and source maps remain intact. pnpm links must resolve inside
the installation, except the explicitly bound app-owned workspace `@pig/config`;
package-internal links are materialized only when contained and acyclic.
Escaping/broken/cyclic links fail closed. Output has no symlinks or
absolute build-machine dependency paths. `durable-runtime-manifest.json` records
placement identities, manifest SHA256 and resolved production edges; it is not
a signature or a full-file integrity manifest.

`build.copy` puts the closure and manifest in `Resources/app`, beside `bun/`.
No `NODE_PATH`, global cache or repository path is needed. A completed `.next`
stage is promoted by directory renames; Windows replacement keeps `.previous`
for rollback until promotion succeeds. Existing `.next`/`.previous` directories
fail with their exact recovery paths. Review/remove only the named generated
directory, after closing processes holding it. Build/stage junctions are refused.
The old `build/sdk-runtime.next` is unrelated and is not read, removed or reused.
User histories, projects and settings are never scanned, migrated or deleted.

## Verification

Local commands use the mise-managed toolchain and mandatory RTK:

```powershell
mise exec -- rtk proxy bun --no-install test apps/desktop/scripts/durable-runtime-assets.test.ts
mise exec -- rtk proxy bun --no-install apps/desktop/scripts/smoke.ts
mise exec -- rtk proxy pnpm build
```

The root test command includes desktop `src`, desktop `scripts` and
`packages/config/src`. The native smoke uses the real `Harness.open`, a pi-ai
faux provider, an empty registry/explicit empty tools and extensions, in-memory
credentials/models and temporary app-owned SQLite through
`openDurableStorage({ dataRoot, workspaceId })`. It asserts durable admission,
settled assistant text, provider-session cleanup and release of the SQLite
writer, then closes/removes temporary storage. It does not read desktop config,
load project code, authenticate or use the network. `--no-install` is mandatory;
a fetch trap alone does not disable Bun auto-install.

CI and release install upstream RTK **0.42.0** using its documented Windows ZIP:
`https://github.com/rtk-ai/rtk/releases/download/v0.42.0/rtk-x86_64-pc-windows-msvc.zip`.
The pinned SHA256 is
`527552ec419988ff4a862415ba28d5aa7c1148ef3dc926ae11a4c133e63a7491`
(verified against that release's `checksums.txt` and downloaded archive).
No speculative setup action or crates.io package is used. Native build/dev
subprocesses resolve RTK and run through `rtk proxy`, with no raw fallback.

Workflows retain tooling Bun **1.4.2**. A local pass on Bun 1.4.4 does not establish
compatibility with Electrobun 1.18.1's bundled Bun **1.3.13**. After building, each
workflow also bundles only the smoke's app-owned code into runner temp, copies
the actual packaged native closure beside it, and runs that relocated smoke
with the packaged Bun and `--no-install`. Release checks the extracted portable
payload, without changing ZIP/checksum/version/channel/publication behavior.

Passing source smoke or Vite is not proof of an interactive packaged app, native
DLL prerequisites, dynamic user extension loading, image/CodeMode behavior under
the deployed Bun, or WebView/IME/security correctness. Those remain separate
release gates. No environment-variable isolation is an OS sandbox.
