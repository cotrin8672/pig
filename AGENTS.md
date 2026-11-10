# AGENTS.md

## Launching the app (Windows)

Use `mise run dev`. It focuses the existing development window without rebuilding,
or starts `pnpm dev` in the background if the app is not running. Startup logs are
in `%TEMP%/piris-dev.stdout.log` and `%TEMP%/piris-dev.stderr.log`.
Do not start another `pnpm dev` while the development app is running.

## Toolchain

pnpm, bun and node are installed via [mise](https://mise.jdx.dev/) (global config), not on the
default PATH of non-interactive shells. Prefix commands with `mise exec --`:

```powershell
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm test
```
