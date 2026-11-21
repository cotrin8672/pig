# Pi SDK MCP host hook

`@earendil-works__pi-coding-agent@1.5.2.patch` adds the synchronous
`McpExtensionOptions.onToolResult` host hook missing from SDK 1.5.2.
It is a local compatibility patch, not an upstream API or a claim of full MCP Apps support.

- Supplies the executing tool call ID, original tool metadata, error flag and a
  resource reader using the existing authenticated connection.
- Returned lightweight details are host-only. They do not enter model content or
  codemode `structuredContent`; the SDK still strips result `_meta`.
- Observer failures do not fail an otherwise successful tool.
- The reader rejects after disconnect, reconnect, tool-list refresh, replacement,
  hide/disable or shutdown. It does not initialize another client.
- The desktop bridge binds the reader to the declared `ui://` URI and calling
  session, limits concurrency/size/lifetime, and does not render raw HTML.

pnpm applies the patch at install using `pnpm-workspace.yaml` and the lockfile.
The release staging script copies those installed production bytes without
modifying them, so the patch is included in the packaged SDK.

On an SDK upgrade, check for an upstream equivalent before rebasing or removing
the patch. Run `mcp-apps-sdk.test.ts`, `mcp-apps.test.ts`, the session lifecycle
tests and `sdk-runtime-assets.test.ts`. Never edit the installed package directly.
For edits, use `pnpm patch` / `pnpm patch-commit` through `mise exec --`.

## Pi SDK model retry policy

`@earendil-works__pi-ai@1.5.2.patch` makes both the provider HTTP and assistant
retry paths stop on rate limits (including HTTP 429) and exhausted quotas.
Transient network and server failures remain retryable. On upgrade, run
`session-host-model-error.test.ts`.
