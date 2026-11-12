# Electrobun 2 Windows validation

## Migration decision

Pinned: Electrobun **2.0.6**, paired Hutch **0.29.0**, bundled Bun **1.4.4**.
The npm dependency bootstraps Hutch; `electrobun sync` projects the SDK into
`.hutch/devkit` before TypeScript or Vite runs. Do not patch the generated SDK.

We use the stock DLL, not the 1.18.1 native backport:

- WebView2 non-client drag regions are enabled upstream.
- Upstream initial bounds and `WM_SIZE` own full-window view resizing. The old
  `GetClientRect` -> `resizeWebview` FFI shim also became incorrect: that API
  now converts DIP inputs to physical pixels.
- Keep the app's Win32 caption/Snap style adjustment and DWM backdrop selection.
  Transparent windows now use `WS_EX_NOREDIRECTIONBITMAP`; remove the old
  layered-window/GDI brush/empty-blur-region repairs.
- The old `WM_NCACTIVATE` patch is not upstream. Before deciding to omit it,
  the stock DLL was run with repeated non-client activation messages, normal
  and maximized windows, and the resulting screenshots were inspected.
  This is a tested migration decision on the environment below, not proof
  that every Windows/GPU/DPI configuration is unaffected.
- Hutch embeds icons into both launcher.exe and bun.exe; no rcedit hook remains.
- Keep the Windows process-tree restart in dev.ts. Hutch's native watch waits
  for the user to close the running Windows app rather than automatically
  stopping its runtime child.

## Run the opt-in native check

Build a stable-channel bundle, then extract its **update tarball**, not the
installer executable. For example, from the repository root in PowerShell:

```powershell
mise exec -- pnpm build
mise exec -- pnpm --filter @pig/desktop exec electrobun build --env=stable
$stage = Join-Path $env:TEMP ('pig-native-check-' + [guid]::NewGuid())
New-Item -ItemType Directory $stage | Out-Null
7z x apps/desktop/artifacts/stable-win-x64-pig.tar.zst "-o$stage" -y
7z x "$stage/stable-win-x64-pig.tar" "-o$stage" -y
mise exec -- bun apps/desktop/scripts/windows-smoke.ts "$stage/pig"
```

Add `--interactive` to also move the mouse over the app's actual CSS drag region
and verify an 80x40-pixel native window move. This briefly uses the foreground
window and cursor; do not interact with the desktop during the test. The probe
verifies process identity and foreground ownership and restores the cursor.

The runner creates fresh HOME/USERPROFILE/APPDATA/LOCALAPPDATA directories,
removes common credential environment variables, and launches only the supplied
bundle. It never opens the normal pig profile. This is profile isolation, **not
an OS security sandbox**. It closes only its own process tree, leaving test logs,
JSON measurements and window-only screenshots under the printed temporary path.
No subscription login, agent prompt, or self-update is performed.

Checks for each of none, Acrylic and Mica:

- actual relocated packaged app starts and displays its bundled React view;
- native client and WebView2 child bounds agree after resize/maximize/restore;
- minimize/restore, non-client activation and native close work;
- resize/Snap style flags, absence of native caption, composition flag and DWM
  backdrop value match expectations;
- optional real mouse drag moves the window by the requested offset.

Screenshots must be reviewed separately: successful assertions alone do not
prove correct transparent composition, transient animation or content rendering.
The script intentionally does not rely on CDP: on the tested WebView2 runtime,
`--remote-debugging-port` reached the browser command line but no listener opened.
It does not claim end-to-end RPC, IME, keyboard Snap or mixed-DPI coverage.

## Recorded migration run

- Windows 11 Home **10.0.26300**, x64, **96 DPI**.
- WebView2 **157.0.4341.46**; bundled Bun 1.4.4.
- Stock `libNativeWrapper.dll` SHA-256:
  `c0fb7e9e429ea6c2d6ebe66faf419f48deb41bff90bd9d86f7f1b3b99545c52c`.
- Extracted the stable update tarball outside the repository and ran all three
  backdrop cases. 27 geometry/state/drag probes passed; each app closed with
  exit code 0. Normal client 1266x833, resized 946x693, maximized 1920x1028.
- Screenshot review: bundled UI rendered; no standard caption reappeared after
  activation/restore in the inspected captures. PrintWindow captures are not
  recordings of the compositor and cannot rule out a one-frame flash.
- Artifacts from this run: `%TEMP%/pig-windows-smoke-MaimLR`; earlier screenshot
  inspection: `%TEMP%/pig-windows-smoke-a5dp36`. These are local evidence, not
  checked-in assets or permanent CI artifacts.
- The normal `package.ps1` ZIP/checksum flow also completed; `7z t` passed.
  After extracting that ZIP outside the repository, the 24 non-interactive
  state/geometry probes passed again, with clean exits for all three modes
  (artifacts: `%TEMP%/pig-windows-smoke-IruZAW`).

## Remaining release gates

The existing `lazy-routes.test.ts` still fails because it requires Providers,
Settings and Extensions to be dynamically imported, while App.tsx currently
imports them eagerly. This migration does not change that UI loading policy.
CI adds the SDK packaging and post-build metadata suites explicitly, not that
unrelated stale test. The normal source suite (690 tests), packaging/metadata
suite (21 tests), typecheck and lint passed.

Before publishing, manually check mixed 100%/150%/200% DPI monitor moves,
Win+Arrow / Snap layouts, real focus switching, opacity 0/1, transient flashes,
Japanese IME, dialogs, clipboard and saved-draft close/cancel. Keep these gates
separate from TypeScript/unit/packaging tests. Do not bring back the old v1 DLL
if a regression appears: reduce it against the pinned v2 source instead.
