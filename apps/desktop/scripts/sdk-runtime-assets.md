# SDK distribution assets

Electrobun's default single-file Bun bundle is not a valid SDK distribution.
The SDK discovers its package version/themes from its module location; extension
aliases resolve packages at runtime; QuickJS and code-mode need the pinned WASM
and the worker adjacent to the original host module.

`electrobun.config.ts` therefore externalizes the three public Pi package roots
(and their subpaths) through supported `build.bun.external`. The existing host
bundle, stock Electrobun framework/native setup, frontend copy entries and
release-metadata postBuild hook remain in place. Do not externalize all packages indiscriminately:
Electrobun's own framework bundling has different native path requirements.

The `preBuild` hook `sdk-runtime-assets.ts` stages the **installed production
closure** of SDK/pi-ai/pi-tui in `build/sdk-runtime`. It follows dependencies,
installed optional dependencies and peers, not devDependencies; missing required
edges fail the build. No install, registry resolution, lifecycle script or source
patching occurs. The Pi packages are installed from npm without local patches.
Dependency changes must be installed/locked by the dependency owner before a
release build.

One package identity per name is hoisted. Conflicting identities are nested in
ordinary `node_modules` directories with the appropriate visible versions;
cycles reuse visible identities. Package contents, package.json/exports, assets,
licenses and source maps remain intact. pnpm package links may resolve only
inside the workspace installation. Package-internal links are materialized only
when contained and acyclic; escaping/broken/cyclic links fail closed. Output has
no symlinks, no store links and no absolute build-machine dependency paths.
Durable is forbidden even on an optional edge. The generated
`sdk-runtime-manifest.json` records every placement's name, version, manifest
SHA256 and resolved production edges (not a signature or full-file integrity
manifest).

`build.copy` places `node_modules` and the manifest under `Resources/app`, beside
`bun/`, so standard resolution works from the host and unbundled SDK. No runtime
`NODE_PATH`, `PI_PACKAGE_DIR`, global cache or repository path is needed. The
stage is reused when its complete file/directory tree, manifest and dependency
placements match the installed production sources byte for byte. Missing,
changed or extra contents, including symlinks, cause a cache miss. The check
does not repair the stage or modify installed packages.

On a cache miss, the hook copies into `.next` before replacing the generated
stage. An existing interrupted `.next` blocks rebuilding until explicit
removal/review; it is never reused as a cache. Replacement removes the old stage
before renaming `.next`, so interruption in that window also requires manual
recovery. A copy failure leaves the old stage intact. Electrobun 2 keeps this
normal directory layout; do not reintroduce the removed v1 ASAR build options.

## Verification

All shell commands run through RTK and the mise-managed toolchain:

```sh
rtk proxy mise exec -- bun --no-install test apps/desktop/scripts/sdk-runtime-assets.test.ts
rtk proxy mise exec -- pnpm exec biome check apps/desktop/electrobun.config.ts apps/desktop/scripts/sdk-runtime-assets.ts apps/desktop/scripts/sdk-runtime-assets.test.ts
rtk proxy mise exec -- bun --no-install apps/desktop/scripts/sdk-runtime-assets.ts
```

The root `pnpm test` currently searches `apps/desktop/src`; run the packaging
suite explicitly. Before release, copy the actual complete runtime payload to a
fresh directory **outside the repository**, reject all links, validate manifest
versions/hashes/edges, use empty cwd and isolated HOME/USERPROFILE/AppData/SDK
profile, strip credentials and module-cache/resolver variables, then execute
with `bun --no-install`. Exercise a real extension importing SDK/TUI/typebox,
dark/light/system themes, Japanese/combining-accent/emoji TUI rendering, compile
the copied pinned WASM, and execute a real code-mode worker returning 42.
Preserve the default-single-file negative control: it must still reproduce the
missing themes/aliases/WASM/package identity. Merely finding asset filenames or
passing Vite does not prove module resolution. Network fetch traps do **not**
disable Bun auto-install; `--no-install` is mandatory.

Native prerequisite provisioning/build success, final actual Electrobun output,
relocated native launch/profile isolation and manual WebView/IME/security checks
are separate release gates. Do not launch a real app to verify JavaScript package
resolution or claim environment variables constitute an OS sandbox.
