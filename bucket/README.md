# pig Scoop bucket

See the root [Install section](../README.md#install) for installation, updates,
and switching between stable and nightly. Both manifests require Windows x64
and WebView2, expose `bin/launcher.exe` as `pig`, and create a `pig` shortcut.
Neither relocates the AppData profile or uses Scoop `persist`.

## Release contract

- Stable: `vX.Y.Z`, ZIP plus `pig-windows-x64.zip.sha256`. The release workflow
  commits the published version, URL and actual SHA256 to `bucket/pig.json` on
  `main`. GitHub checkver selects the latest non-prerelease; autoupdate can also
  read the checksum sidecar. These fields alone do not schedule bucket updates.
- The initial `0.1.0` hash is from a locally validated bootstrap ZIP, **not a
  published release**. The first stable release job replaces it with the CI
  artifact's hash. Wait for the workflow's bucket commit before installing.
- Nightly: fixed `nightly` prerelease tag, moved to the built `main` commit, with
  assets replaced on every successful main build or manual Release run.
  `version: "nightly"` intentionally omits a hash: Scoop updates re-download the
  rolling ZIP without integrity checking. The release body includes the base
  version, UTC date and short commit SHA.
- Both are built with `electrobun build --env=stable` and use the
  identifier `dev.pig.desktop`, so their WebView profiles share
  `%LOCALAPPDATA%/dev.pig.desktop/stable`. Quit before switching/updating, and
  back up the shared profile before testing nightly.

Electrobun 1.18.1 replaces `build/stable-win-x64/pig/` with a self-extracting
bundle. Do **not** ZIP that folder or use the Setup ZIP for Scoop. The packaging
script extracts `artifacts/stable-win-x64-pig.tar.zst`, which contains the
original runnable folder, and zips its contents without a wrapping `pig/`:

```text
pig-windows-x64.zip
  bin/launcher.exe
  bin/bun.exe (+ runtime DLLs and helpers)
  Resources/app/ (+ bundled main process and webview)
  Resources/version.json
  Resources/build.json
  Resources/main.js
  Info.plist
```

No GitHub secrets beyond the built-in `GITHUB_TOKEN` are needed. The stable
bucket commit needs write access to `main`; branch protection/rules can block
it. If it fails, commit the version/URL and the published `.sha256` value
manually, then push `main`. Do not copy a hash from an installer or local build.
A token-generated bucket commit does not trigger another Actions run.

