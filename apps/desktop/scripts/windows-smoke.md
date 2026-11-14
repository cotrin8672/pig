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
  Transparent windows use `WS_EX_NOREDIRECTIONBITMAP`; no layered-window or
  GDI brush repair is needed. Windowed WebView2 still requires
  `DwmEnableBlurBehindWindow` with an empty region to enable desktop alpha.
  The composition flag and requested DWM backdrop alone do not enable it.
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

Add `--interactive` to also verify an 80x40-pixel native window move over the
app's actual CSS drag region, drag to the top edge to maximize, and reveal each
auto-hide taskbar after both maximize paths. Taskbar settings are never changed;
when no auto-hide taskbar is registered there, the reveal check is explicitly
reported as NOT TESTED. This briefly uses the foreground window and cursor;
do not interact with the desktop during the test. The probe
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
- caption/resize/Snap style flags, composition flag and DWM backdrop value match
  expectations; `hiddenInset` removes the native caption's layout space;
- maximized client bounds stay inside the monitor work area;
- optional real mouse drag moves the window by the requested offset and
  maximizes it at the top edge; edge hovering reveals registered auto-hide
  taskbars after both direct maximize/activation and drag-to-top.

For `none`, the runner also places a red, then green window behind pig and
samples the actual desktop pixels through a blank part of its sidebar. Both
colors must show through, initially, maximized and after minimize/restore. With
that flat underlay and the toolbar collapsed, the same probe checks the actual
upper-right desktop pixels for unwanted native caption glyphs. Companion
`*.caption.png` crops are saved beside the window captures. This catches opaque
composition and duplicate controls that geometry and PrintWindow checks miss.
It briefly brings the test app to the foreground; do not cover it during the run.

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

## Desktop alpha regression check

The migration's attribute/geometry checks missed disabled desktop alpha. On the
same Windows/WebView2 versions, a minimal two-window probe reproduced an opaque
background before `DwmEnableBlurBehindWindow` and measured red/green transmission
after enabling an empty blur region, without changing brushes or extended styles.
Opacity 0/0.3/1 and all three backdrops were exercised; opacity 1 stayed opaque.

The fixed relocated stable bundle passed all 26 native probes, including the two
new desktop-pixel checks. Artifacts: `%TEMP%/pig-windows-smoke-OvckBv`. Mixed-DPI
and transient animation coverage remain separate manual gates.

## Maximized taskbar regression

Removing `WS_CAPTION` in `windowStyleForBackdrop` made a maximized custom-chrome
window suppress taskbar auto-hide. In an isolated 0.6.0 profile on Windows 11 at
96 DPI, the client filled 1920x1080; edge hovering left the taskbar at y=1078
(hidden). Restoring `WS_CAPTION` revealed it at y=1032, without changing the
client's size. Removing/restoring the style again reproduced/repaired the issue.
Investigation artifacts: `%TEMP%/pig-taskbar-investigation-HWBKNa`.

Keep `WS_CAPTION` and the normal resize/Snap flags. The stock DLL's `hiddenInset`
`WM_NCCALCSIZE` handler hides the caption's layout space; do not remove style bits
to hide it. Unit tests protect the style bits, and the native runner now checks
caption layout and maximized work-area bounds, plus real auto-hide edge hovering
with `--interactive`. Always-visible taskbars and keyboard Snap still need
separate manual coverage when those configurations are unavailable.

The fixed source passed all 39 native probes across none/Acrylic/Mica, including
real drag-to-top maximization, auto-hide taskbar reveal after both maximize paths,
alpha and duplicate-caption pixel checks, activation and clean close. Artifacts:
`%TEMP%/pig-windows-smoke-8mWJnr`. This run used a temporary workspace bundle with
the current Bun entry rebuilt separately and the staged SDK copied with robocopy:
the development app held the repository build lock, and the temporary build's
serial SDK copy exceeded the command timeout. This is runtime validation, not a
completed installer/update-tarball packaging check. The browser `pnpm test:ui`
run was also attempted twice: 11 passed, 1 timed out in the unrelated transcript
scrollbar-geometry fixture; it does not exercise native window styles.

## Duplicate caption controls regression

Keeping `WS_CAPTION` exposed another issue: full-client glass margins (`-1`)
paint native caption buttons underneath the auto-hiding toolbar. Extend only the
outer 1px instead; the existing empty blur region still enables full-view alpha.
Do not disable non-client rendering or remove caption styles to hide the extra
buttons: preserve DWM corners/shadows and taskbar behavior.

An isolated 0.6.0 profile reproduced the duplicate glyphs with full-client glass.
The desktop-pixel regression check fails with those margins and passes with 1px;
Acrylic alpha, maximize/restore/activation and actual auto-hide taskbar reveal
also passed. Artifacts: `%TEMP%/pig-caption-investigation-mi43MY` (fixed) and
`%TEMP%/pig-caption-investigation-aVIuHp` (expected regression failure).

## Remaining release gates

The existing `lazy-routes.test.ts` still fails because it requires Providers,
Settings and Extensions to be dynamically imported, while App.tsx currently
imports them eagerly. This migration does not change that UI loading policy.
The fast `pnpm test` suite includes SDK packaging and post-build metadata checks,
not that unrelated stale test. Real SDK/native/storage regressions now run with
`pnpm test:integration`, and Edge drawing/input regressions with `pnpm test:ui`;
the daily/manual `Regression` workflow runs both. These checks do not launch the
packaged native GUI. The original migration's source suite (690 tests),
packaging/metadata suite (21 tests), typecheck and lint passed.

Before publishing, manually check mixed 100%/150%/200% DPI monitor moves,
Win+Arrow / Snap layouts, real focus switching, opacity 0/1, transient flashes,
Japanese IME, dialogs, clipboard and saved-draft close/cancel. Keep these gates
separate from TypeScript/unit/packaging tests. Do not bring back the old v1 DLL
if a regression appears: reduce it against the pinned v2 source instead.
