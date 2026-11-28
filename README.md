# pig

pig (pi on gui) is a thin GUI client for the pi agent harness.
Tauri 2, Bun, React 19, Vite, Tailwind v4, and zustand.

## Install

### Windows installer

Starting with the first Tauri installer release, install `pig-setup.exe` from
[Releases](https://github.com/cotrin8672/pig/releases) for in-app updates.
In **Settings → About & updates**, enable **Include nightly builds** to receive
the newest stable or nightly build. Turning it off waits for a newer stable
build; it does not downgrade. Updates verify the Tauri updater signature.
Older Electrobun installations do not migrate themselves to this installer.

### Scoop

On Windows x64, install [Scoop](https://scoop.sh/) and the Microsoft Edge
WebView2 Runtime, then run in PowerShell (after the corresponding pig build is published):

```powershell
scoop bucket add pig https://github.com/cotrin8672/pig
scoop install pig          # Latest stable release
# Or: scoop install pig-nightly   # Latest successful dev build
```

Both packages install an unsigned portable app, with the `pig` command
and Start menu shortcut. **Scoop treats them as separate apps, not replacements:**
installing both conflicts on the `pig` shim and shortcut. Fully exit the app,
then use `scoop reset pig` or `scoop reset pig-nightly` to select which runs
(also reset the remaining package after uninstalling the other).
Tauri and Electrobun use `~/.config/pig` for desktop settings by default.
Pi credentials and sessions keep their existing SDK locations. Do not run
both clients concurrently; back up data before switching.
Scoop uninstall does not remove this data. No Scoop `persist` directory is needed.

Update with `scoop update` followed by `scoop update pig` or
`scoop update pig-nightly`. Nightly uses a rolling prerelease and Scoop's
`nightly` version: updates re-download it without hash verification. For the
first update from Electrobun to Tauri, close pig and run
`scoop update pig-nightly --force --no-cache` to bypass a same-day cached build.

Scoop manages its own files; the installer updater is disabled for Scoop and
portable ZIPs. Installer updates ask before stopping agents and saving drafts.

### Publish

Development lands on `dev`; `main` holds released code. PRs and pushes to
`main` or `dev` run fast CI, not native release builds. The `Release` workflow
publishes/replaces the `nightly` prerelease from `dev` daily at 19:00 UTC
(04:00 JST), skipping it when the published commit is unchanged. Run `Release`
manually on `dev` to build a portable test artifact without publishing; turn off
`build_only` only to publish. Checks and packaging use one
resolved commit, never a moving branch tip. Scheduled workflows always run the
workflow files on `main`, so workflow changes take effect on the schedule only
after they reach `main`. Both installer feeds use the same increasing Actions
run number for version ordering, independent of the human-readable release tag.
Before publishing, configure `TAURI_SIGNING_PRIVATE_KEY` and its password
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as Actions secrets and the matching public
key contents as repository variable `TAURI_SIGNING_PUBLIC_KEY`. Back up the
private key offline. This updater signature is not Windows Authenticode.
For stable releases, bring only the selected release commits into `main`,
push `main`, then tag the version in `apps/desktop/package.json` on `main`:

```sh
git tag v0.1.0 && git push --tags
```

The workflow uploads `pig-setup.exe`, `pig-windows-x64.zip` and its `.sha256`,
publishes the applicable installer manifests, then commits the
stable Scoop version/hash to `main` using `GITHUB_TOKEN` (`contents: write`).
No Excavator service is needed; checkver/autoupdate metadata is also provided.
Wait for that bucket commit before installing the first stable build, then
merge `main` back into `dev` so the branches do not diverge. See
[bucket maintenance notes](bucket/README.md) for the initial checksum and layout.

## Run

On `dev`, `mise run dev` starts the Windows
[Tauri app](docs/tauri-preview.md) with the existing chat UI and Pi host.

Requires Windows with WebView2, Node 22+, pnpm 10.14, Bun (tested with 1.4.2),
and [mise](https://mise.jdx.dev/) for the pinned type checkers.

Development also requires the Rust MSVC toolchain and Visual C++
Build Tools with a Windows SDK.

```sh
mise install
mise exec -- pnpm install
mise run dev
```

To preview the built-in chat renderers, run `mise run storybook` and open
[Storybook](http://127.0.0.1:6006). Under **ChatRenderer**, each component has
one page with a usage example and its supported states. Add examples in
`apps/desktop/src/stories/chat-renderer`. The catalog renders production
components with sample data; it does not load extensions, local renderer
overrides, or a desktop session.

Add a project folder with **+**, open **Providers** to sign in with an OpenAI
ChatGPT Plus/Pro or Anthropic Claude Pro/Max subscription, then create a chat
with the project's **+**. Enter sends; Shift+Enter inserts a newline. Sending
while pi is running queues a follow-up. Stop aborts the current run. Closing a
chat releases its live SDK session without deleting history.

Launching pig again while it is running opens another window of the same app
instead of a second process. Windows share chats, drafts and approval requests;
an extension terminal is driven by the first window that shows it. Closing the
last window quits the app.

Subscriptions support multiple accounts: press **+** beside the connected provider
to sign in, then optionally rename its nested account with **… → Edit name**.
Choose the account and model together in the model picker. A chat with messages
keeps its account; use the picker's **New chat with…** action to switch accounts.
See [account storage and limits](docs/provider-accounts.md).

Choose **Settings → General → Default model** to set the model for new chats.
This saves pi's shared default; existing chats keep their saved model.
Choose **Automatic** to reset the preference.

For automatic chat titles, install `@pi-archimedes/session-name` from
**Extensions → Marketplace → Supported by pig**. Then choose **Settings → General →
Session title model**, or leave it as **Use the chat model**. The extension sends
part of the first exchange to that model and leaves manually named chats
unchanged. The picker edits `"archimedes.sessionName": { "model": "provider/model-id" }`
in Pi's shared `~/.pi/agent/settings.json` (or `$PI_CODING_AGENT_DIR/settings.json`).
Model choice does not change the extension's prompt or enforce a title language.

Each chat's **…** menu provides Rename, Pin/Unpin, Archive/Restore, Copy link,
and Delete. Rename updates the pi session name; pins and archive flags are
Desktop-only. Archived chats remain available from **Archived chats**. Delete
requires confirmation and permanently removes local history; stop an active
response/command first. Removing a project still never deletes its chats.

Copied `pig://session/<id>` links are local, not cloud shares. Paste a link in
pig outside a text field, or click a Markdown chat link inside pig, to open it.
Only sessions in registered project folders can be opened. pig does not register
OS-level URL activation on Windows/Linux, so links do not launch the app from
other applications.

`mise run dev` runs `pnpm dev` in the foreground, with logs in the current
terminal (including Nushell), just like `mise run storybook`.
Stop it with Ctrl+C before starting another development session.

`pnpm dev` builds the webview and launches the Tauri app. Stop and rerun it
to pick up code changes.

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm --filter @pig/desktop smoke
pnpm build
```

### Checks and CI

`pnpm typecheck` uses `tsrs` locally. CI and Release still use `tsgo` via
`pnpm typecheck:tsgo`. Both are pinned in `mise.toml` and installed locally
with `mise install`. `pnpm typecheck:tsc` remains available for compatibility
comparisons.

| Command | Scope | Automation |
| --- | --- | --- |
| `pnpm test` | Fast source tests, UI style rules and SDK packaging tests | Every PR and `main`/`dev` push; release validation |
| `pnpm test:integration` | Real SDK startup, native processes, large storage/recovery fixtures | Daily and manual `Regression` workflow |
| `pnpm test:ui` | Edge/Chromium drawing and input regressions; missing browser fails | Daily and manual `Regression` workflow |
| `pnpm test:all` | All three maintained suites | Local full verification |

CI also runs Lint, TypeScript and the Tauri Vite webview build. Superseded CI runs
are cancelled. Native packaging runs only for stable tags and scheduled
or manual nightlies, after the same fast checks pass. A release deliberately
rechecks its exact revision rather than assuming a previous CI build covered
it. It does **not** rerun the slow regression suites or wait for their daily run.
Before releases or changes to SDK/storage/UI behavior, run the relevant suites
locally or dispatch `Regression` against the intended revision. UI changes still
require `pnpm test:ui`; separating CI is not permission to skip that validation.

Unit tests run in isolated Bun workers, using the available CPU count up to eight
locally or two on GitHub Actions to limit contention on the Windows runners.
Override the count with `PIG_TEST_WORKERS` (a positive integer) for comparisons or
resource-constrained environments. For example, in PowerShell:

```powershell
$env:PIG_TEST_WORKERS = '4'
mise exec -- pnpm test
Remove-Item Env:PIG_TEST_WORKERS
```

`apps/desktop/scripts/run-tests.ts` owns suite membership; new source tests are
included in the fast suite by default. Existing heavy suites are explicitly
listed, and a test checks that no source test is lost or assigned twice.
Regression suites run serially within each of two independent jobs to avoid
SDK/Edge contention. The workflow runs daily at 18:00 UTC (03:00 JST) on `dev`,
an hour before its nightly, or manually on a selected branch/tag. Release ZIP/checksum artifacts are
also retained for seven days if publishing or the Scoop update fails.

`pnpm build` writes an unsigned Tauri portable bundle to
`apps/desktop/build/tauri-portable/`. Release automation packages this bundle
as a ZIP and builds the signed installer separately.

## Storage and limits

- pi/SDK settings, authentication, extensions, skills, and history use the pi
  SDK's standard locations (`~/.pi/agent` by default, respecting its environment
  overrides). pig does not copy credentials or history into its config folder.
- Desktop-only data is saved under `~/.config/pig` (Windows:
  `%USERPROFILE%\.config\pig`): `projects.json`, `appearance.json`,
  `disabled-models.json`, `settings.json` (language/context display/keybindings),
  and `desktop.json` (pins, archives, chat width, recent models).
  Missing Desktop settings are copied from the legacy Electrobun profile
  under `%LOCALAPPDATA%\dev.pig.desktop` without overwriting existing files.
  Originals remain untouched;
  legacy browser width/recent-model preferences are imported only when unset.
- Extension UI dialogs are not implemented. Only `openai-codex` and `anthropic`
  appear in the model picker.
- OAuth URLs remain visible beside manual-code inputs; the system browser opens
  automatically. Cancel handles both the whole flow and per-prompt cancellation.
- pnpm's normal isolated linker works without a hoisting workaround. Only
  `esbuild` dependency build scripts are approved.

The smoke script creates and disposes an in-memory session without sending a
prompt or initiating login. Automated session/storage tests use scratch files;
real subscription login and model requests still require manual verification.
