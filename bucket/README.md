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
- Nightly: fixed `nightly` prerelease tag, moved to the built `dev` commit, with
  assets replaced by scheduled daily builds (19:00 UTC) or manual `Release`
  runs on `dev`. Scheduled runs skip unchanged commits; a push runs fast CI
  only. Stable tags must point to a commit on `main`.
  `version: "nightly"` intentionally omits a hash: Scoop updates re-download the
  rolling ZIP without integrity checking. The release body includes the base
  version, UTC date and short commit SHA.
- Both are built with `tauri:package` and use the identifier
  `dev.pig.tauri`. Quit before switching/updating, and
  back up the shared profile before testing nightly.

The packaging script preserves the existing shim target and keeps Tauri's host
resources beside the executable. Do not package the NSIS installer for Scoop:

```text
pig-windows-x64.zip
  bin/launcher.exe
  bin/pig-remote.exe
  bin/host/bin/bun.exe
  bin/host/app/ (+ SDK and Bun host)
```

See the root README for installer signing secrets. The stable
bucket commit needs write access to `main`; branch protection/rules can block
it. If it fails, commit the version/URL and the published `.sha256` value
manually, then push `main`. Do not copy a hash from an installer or local build.
A token-generated bucket commit does not trigger another Actions run.

