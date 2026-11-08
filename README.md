# piris

A minimal Windows desktop chat client for the in-process pi coding-agent SDK.
Electrobun **1.18.1**, Bun, React 19, Vite, Tailwind v4, and zustand.

## Install

On Windows x64, install [Scoop](https://scoop.sh/) and the Microsoft Edge
WebView2 Runtime, then run in PowerShell (once the first release is published):

```powershell
scoop bucket add piris https://github.com/cotrin8672/piris
scoop install piris          # Latest stable release
# Or: scoop install piris-nightly   # Latest successful main build
```

Both packages install the same unsigned portable app, with the `piris` command
and Start menu shortcut. **Scoop treats them as separate apps, not replacements:**
installing both conflicts on the `piris` shim and shortcut. Fully exit the app,
then use `scoop reset piris` or `scoop reset piris-nightly` to select which runs
(also reset the remaining package after uninstalling the other).
Both builds use identifier `dev.piris.desktop` and channel `stable`, sharing
`%LOCALAPPDATA%/dev.piris.desktop/stable` settings/projects and pi's existing
credentials/sessions. Do not run both concurrently; back up data before switching.
Scoop uninstall does not remove this data. No Scoop `persist` directory is needed.

Update with `scoop update` followed by `scoop update piris` or
`scoop update piris-nightly`. Nightly uses a rolling prerelease and Scoop's
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

The workflow uploads `piris-windows-x64.zip` plus its `.sha256`, then commits the
stable Scoop version/hash to `main` using `GITHUB_TOKEN` (`contents: write`).
No Excavator service is needed; checkver/autoupdate metadata is also provided.
Wait for that bucket commit before installing the first stable build. See
[bucket maintenance notes](bucket/README.md) for the initial checksum and layout.

## Run

Requires Windows with WebView2, Node 22+, pnpm 10.14, and Bun (tested with 1.4.2).

```sh
pnpm install
pnpm dev
```

Add a project folder with **+**, open **Providers** to sign in with an OpenAI
ChatGPT Plus/Pro or Anthropic Claude Pro/Max subscription, then create a chat
with the project's **+**. Enter sends; Shift+Enter inserts a newline. Sending
while pi is running queues a follow-up. Stop aborts the current run. Closing a
chat releases its live SDK session without deleting history.

`pnpm dev` builds the webview and launches the app. For webview HMR, also run
`pnpm --filter @piris/desktop exec vite` in another terminal; restart `pnpm dev`
after changing main-process code. Without Vite, the app uses bundled views.

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm --filter @piris/desktop smoke
pnpm build
```

`pnpm build` writes an unsigned development bundle under
`apps/desktop/build/dev-win-x64/`. Release automation builds the `stable` channel
and packages a portable ZIP instead.

## Storage and limits

- pi owns credentials at its default `~/.pi/agent/auth.json` and sessions at its
  default location. Existing CLI extensions, skills, and settings load normally;
  extension UI dialogs are not implemented. Only `openai-codex` and `anthropic`
  appear in the model picker.
- Project folders are saved in `projects.json` inside Electrobun's
  `Utils.paths.userData` (`%LOCALAPPDATA%/dev.piris.desktop/dev` for dev builds).
  Removing a project never deletes files or session history.
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

The smoke script creates and disposes an in-memory session without sending a
prompt or initiating login. Real subscription login and model requests need
manual verification; automated tests only cover transcript/event handling.
