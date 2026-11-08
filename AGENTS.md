# AGENTS.md

## Toolchain

pnpm, bun and node are installed via [mise](https://mise.jdx.dev/) (global config), not on the
default PATH of non-interactive shells. Prefix commands with `mise exec --`:

```powershell
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm test
```
