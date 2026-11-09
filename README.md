# pig

pig (pi on gui) is a native Pi Durable agent host with an Electrobun GUI.
It uses Pi Durable, pi-ai and Chord **1.5.0**, Electrobun **1.18.1**, Bun, React 19,
Vite, Tailwind v4 and zustand. It does not run the Pi Coding Agent SDK or a TUI.

## Install

On Windows x64, install [Scoop](https://scoop.sh/) and the Microsoft Edge
WebView2 Runtime, then run in PowerShell (after the corresponding pig build is published):

```powershell
scoop bucket add pig https://github.com/cotrin8672/pig
scoop install pig          # Latest stable release
# Or: scoop install pig-nightly   # Latest successful main build
```

Both packages install the same unsigned portable app, with the `pig` command
and Start menu shortcut. **Scoop treats them as separate apps, not replacements:**
installing both conflicts on the `pig` shim and shortcut. Fully exit the app,
then use `scoop reset pig` or `scoop reset pig-nightly` to select which runs
(also reset the remaining package after uninstalling the other).
Both builds retain the legacy identifier `dev.piris.desktop` and use channel
`stable`. App settings, model credentials and new native conversations live in
`~/.config/pig`. Old histories are not discovered, converted or deleted.
The WebView profile/cache remains under
`%LOCALAPPDATA%/dev.piris.desktop/stable`. Do not run both clients concurrently;
back up data before switching.
Scoop uninstall does not remove this data. No Scoop `persist` directory is needed.
If upgrading from piris, quit the app and uninstall the old `piris` or
`piris-nightly` Scoop package before installing pig; the shared profile is retained.

Update with `scoop update` followed by `scoop update pig` or
`scoop update pig-nightly`. Nightly uses a rolling prerelease and Scoop's
`nightly` version: updates re-download it without hash verification.

### Publish

Push `main` to build CI and publish/replace the `nightly` prerelease. Manual
`Release` workflow runs also build the latest `main`. The release body identifies
nightlies as `0.1.0-nightly.<UTC date>.<short SHA>`; the internal app version stays
at the configured base version, and the Electrobun channel stays `stable`.

For stable releases, keep the versions in `apps/desktop/package.json` and
`apps/desktop/electrobun.config.ts` equal, commit and push `main`, then:

```sh
git tag v0.1.0 && git push --tags
```

The workflow uploads `pig-windows-x64.zip` plus its `.sha256`, then commits the
stable Scoop version/hash to `main` using `GITHUB_TOKEN` (`contents: write`).
No Excavator service is needed; checkver/autoupdate metadata is also provided.
Wait for that bucket commit before installing the first stable build. See
[bucket maintenance notes](bucket/README.md) for the initial checksum and layout.

## Run

Requires Windows with WebView2, Node 22+, pnpm 10.14, Bun and RTK on PATH.
Native tests run with Bun 1.4.4 and Electrobun's bundled Bun 1.3.13.

Windows x64 builds also require Visual Studio 2022/2026 C++ Build Tools with
CMake and the Windows SDK. The post-build hook compiles the pinned Electrobun
native drag-region backport, downloads about 170 MB of checksum-verified SDKs on
the first build, and caches the result. Installed dependencies are not modified.

```sh
mise exec -- rtk proxy pnpm install
mise exec -- rtk proxy pnpm dev
```

Add a project folder with **+**, open **Providers** to sign in with an OpenAI
ChatGPT Plus/Pro or Anthropic Claude Pro/Max subscription, then create a chat
with the project's **+**. Enter sends; Shift+Enter inserts a newline. Sending
while the agent is running queues a follow-up. Stop explicitly aborts the run.
Closing a chat only detaches its UI: native work and durable history remain.

Each chat's **…** menu provides Rename, Pin/Unpin, Archive/Restore, Copy link,
and Delete. Rename updates native conversation metadata; pins and archive flags
are Desktop-only. Archived chats remain available from **Archived chats**.
**Physical deletion is currently unsupported by the pinned native public API**:
Delete reports an error without hiding, archiving or deleting the conversation.
Removing a project never deletes its chats. Regenerate/edit-resend creates a new
native fork and preserves the original conversation.

Copied `pig://session/<id>` links are local, not cloud shares. Paste a link in
pig outside a text field, or click a Markdown chat link inside pig, to open it.
Only conversations in registered project folders or the general chat scope can be opened.
Electrobun 1.18.1 does not support OS-level URL activation on Windows/Linux, so links do not
launch the app from other applications.

## Manual extension installation

Marketplace also accepts GitHub repository URLs (HTTPS/SSH), npm package URLs,
and npm names/specs, including personal/private sources using existing Git/SSH/npm
credentials. Installation pins the resolved version/commit and does **not** load
or enable code. See [manual installation](docs/manual-package-installation.md)
for accepted forms and safety boundaries.

The local catalog is intentionally empty until compatible entries are supplied.
Native TypeScript configuration is explicit and uses `apiVersion: 2`; see
[native configuration](docs/native-configuration.md). Installed packages are not
automatically imported or selected. `Ctrl+Alt+R` reloads configuration, including
with no open chat; unsafe changes retain the last-good configuration.

`pnpm dev` builds the webview and launches the app. For webview HMR, also run
`pnpm --filter @pig/desktop exec vite` in another terminal; restart `pnpm dev`
after changing main-process code. Without Vite, the app uses bundled views.

```sh
mise exec -- rtk proxy pnpm typecheck
mise exec -- rtk proxy pnpm lint
mise exec -- rtk proxy pnpm format
mise exec -- rtk proxy pnpm test
mise exec -- rtk proxy pnpm --filter @pig/desktop smoke
mise exec -- rtk proxy pnpm build
```

`pnpm build` writes an unsigned development bundle under
`apps/desktop/build/dev-win-x64/`. Release automation builds the `stable` channel
and packages a portable ZIP instead.

## Storage and limits

- App-owned model credentials are stored in `~/.config/pig/auth.json`; models and
  overrides use `models.json`. Model authentication does not discover environment
  keys or another CLI's credentials. Manual package acquisition may use existing
  Git/SSH/npm credentials, never credentials embedded in source URLs.
- Each explicitly authorized Workspace owns fresh Models, a registry, a Harness,
  SQLite storage and a lifetime single-writer lock under
  `~/.config/pig/agent-v2/workspaces/<opaque-id>/state.sqlite`. Old history
  locations are not scanned, opened or migrated.
- Desktop-only files under `~/.config/pig` include `projects.json`,
  `appearance.json`, `disabled-models.json`, `settings.json`, and `desktop.json`.
  First startup copies only known non-conversation Desktop files from Electrobun
  userData without overwriting existing files. Originals remain untouched.
- Native confirm/select/input/editor dialogs, the existing Dock and Composer are
  supported. SDK custom/TUI extension interfaces are not supported.
- Resources are selected explicitly. Project bytes require trust; trusted
  JavaScript is not sandboxed. Unknown saved task/document definitions fail closed.
  Shell and generic filesystem/tool effects are not advertised as replay-safe or
  externally exactly-once. Close and UI loss do not imply permission or Stop.
- OAuth URLs remain visible beside manual-code inputs; the system browser opens
  automatically. Cancel handles both the whole flow and per-prompt cancellation.
- The Windows folder picker uses an RPC **message**, not a request, to avoid
  Electrobun #156. Both RPC endpoints allow ten-minute requests.
- `patches/electrobun@1.18.1.patch` only suppresses type-checking in two upstream
  implementation files: missing optional Three.js declarations and Bun FFI
  pointer/nullability errors. App code remains strict and uses the package's
  real API types. Remove this patch when those upstream errors are fixed.
- pnpm's normal isolated linker downloaded the Electrobun CLI/core binaries
  successfully; no hoisting workaround was needed. Only electrobun/esbuild
  dependency build scripts are approved.

The native smoke uses temporary storage, in-memory credentials and faux providers,
without real login or project commands; it does not replace HOME. Automated checks
are separate from Windows/WebView2 manual acceptance, real subscription login and
private-repository access. See [native verification](docs/native-runtime-verification.md)
for executed checks and remaining limits.
