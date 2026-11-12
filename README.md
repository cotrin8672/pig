# pig

pig (pi on gui) is a thin GUI client for the pi agent harness.
Electrobun **2.0.6**, Bun, React 19, Vite, Tailwind v4, and zustand.

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
Both builds use the identifier `dev.pig.desktop` and channel
`stable`. Desktop settings/projects live in `~/.config/pig`; pi credentials and
sessions keep their existing SDK locations. The WebView profile/cache remains
under `%LOCALAPPDATA%/dev.pig.desktop/stable`. Do not run both clients
concurrently; back up data before switching.
Scoop uninstall does not remove this data. No Scoop `persist` directory is needed.

Update with `scoop update` followed by `scoop update pig` or
`scoop update pig-nightly`. Nightly uses a rolling prerelease and Scoop's
`nightly` version: updates re-download it without hash verification.

Stable builds can also update from **Settings → About & updates** (Windows x64).
The app checks the latest stable GitHub release, verifies the ZIP checksum, then
replaces the installation after the app exits: Scoop installs run
`scoop update pig`, portable installs replace their own folder and restore the
old one if the swap fails. Nightly, development, and unverified installations
never self-update; use the Scoop CLI for those. The update stops running agents
and terminals, so drafts are saved before closing and the restart can be
cancelled. A failed update is reported on the next launch.

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

Requires Windows with WebView2, Node 22+, pnpm 10.14, and Bun (tested with 1.4.2).

Builds use Electrobun's stock Windows native binaries; no local C++ build is
required. `dev`, `build`, and `typecheck` first run `electrobun sync` to generate
`apps/desktop/.hutch/devkit`. Hutch downloads its pinned SDK/toolchains into
`~/.hutch`; application code continues to run on Bun (bundled 1.4.4).
See [Windows migration checks](apps/desktop/scripts/windows-smoke.md) for the
native regression test and remaining manual release gates.

```sh
mise exec -- pnpm install
mise run dev
```

To preview the built-in chat renderers, run `mise run storybook` and open
[Storybook](http://127.0.0.1:6006). Open **Chat → Overview → All Components**
to compare every example on one page, or choose **Chat → Tools** or **Chat → Items** for individual stories.
Changes to the desktop components, styles, and fixtures appear on save. Add
examples in `apps/desktop/src/stories`. The gallery uses sample data and does
not load pi-lens, local renderer overrides, or a desktop session.

Add a project folder with **+**, open **Providers** to sign in with an OpenAI
ChatGPT Plus/Pro or Anthropic Claude Pro/Max subscription, then create a chat
with the project's **+**. Enter sends; Shift+Enter inserts a newline. Sending
while pi is running queues a follow-up. Stop aborts the current run. Closing a
chat releases its live SDK session without deleting history.

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

On Windows, `mise run dev` focuses the running development app, or starts
`pnpm dev` in the background. Logs are written to `%TEMP%/pig-dev.stdout.log`
and `%TEMP%/pig-dev.stderr.log`. Close the development app before a fresh launch.
For foreground logs, use `mise exec -- pnpm dev` instead.

`pnpm dev` builds the webview, starts Vite with HMR, and launches the app.
Main-process changes automatically restart the app; do not launch a second Vite
server or development app.

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm --filter @pig/desktop smoke
pnpm build
```

`pnpm build` writes an unsigned development bundle under
`apps/desktop/build/dev-win-x64/`. Release automation builds the `stable` channel
and packages a portable ZIP instead.

## Storage and limits

- pi/SDK settings, authentication, extensions, skills, and history use the pi
  SDK's standard locations (`~/.pi/agent` by default, respecting its environment
  overrides). pig does not copy credentials or history into its config folder.
- Desktop-only data is saved under `~/.config/pig` (Windows:
  `%USERPROFILE%\.config\pig`): `projects.json`, `appearance.json`,
  `disabled-models.json`, `settings.json` (language/context display/keybindings),
  and `desktop.json` (pins, archives, chat width, recent models).
  First startup copies the known legacy Desktop files from Electrobun userData
  without overwriting existing destination files. Originals remain untouched;
  legacy browser width/recent-model preferences are imported only when unset.
- Extension UI dialogs are not implemented. Only `openai-codex` and `anthropic`
  appear in the model picker.
- OAuth URLs remain visible beside manual-code inputs; the system browser opens
  automatically. Cancel handles both the whole flow and per-prompt cancellation.
- The Windows folder picker uses an RPC **message**, not a request, to avoid
  Electrobun #156. Both RPC endpoints allow ten-minute requests.
- Electrobun types and Vite aliases come from the generated `.hutch/devkit`.
  No upstream type-suppression or native DLL patch is applied. Do not edit the
  generated SDK or Hutch's shared store.
- pnpm's normal isolated linker works without a hoisting workaround. Only
  electrobun/esbuild dependency build scripts are approved.

The smoke script creates and disposes an in-memory session without sending a
prompt or initiating login. Automated session/storage tests use scratch files;
real subscription login and model requests still require manual verification.
