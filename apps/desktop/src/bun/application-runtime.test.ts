import { test } from "bun:test";
import { runApplicationFixture } from "./application-runtime.fixture";

for (const [mode, title] of [
  [
    "assembly",
    "lazy native assembly owns models/registry/storage per workspace and selects only an explicit profile",
  ],
  [
    "approvals",
    "native final RTK plan uses immutable roots; detach preserves approval; base selections cannot drop policy",
  ],
  [
    "shellPreference",
    "live shell preferences intersect native callers, revoke old plans and preserve SQLite chats/signatures across reload and restart",
  ],
  [
    "shellSelection",
    "custom native tool/model selections stay intersections; inactive nested shell is denied without making modelTools an allowlist",
  ],
  [
    "images",
    "idle and queued admission strip blocked images while durable receipts hash original input",
  ],
  [
    "resources",
    "only explicit resources load after project trust; prompt expansion uses approved bytes",
  ],
  [
    "reload",
    "native last-good reload rejects unknown compatibility, invalid candidates and reused providers",
  ],
  [
    "lifecycle",
    "async UI readiness errors reject prompt; late attachment cleanup and disposal are idempotent",
  ],
  [
    "auth",
    "application credentials are authoritative; ambient keys and CLI auth are denied without network",
  ],
  [
    "delegation",
    "explicit research model enables a bounded task-owned native read-only child",
  ],
  [
    "reconnect",
    "disconnect and lease expiry restore the same durable approval without abort, resend, draft loss or live-Root dialog rotation",
  ],
  [
    "reconnectFailure",
    "reconnect surfaces projection failure and disposes late watch/port completion safely",
  ],
  [
    "inheritResearch",
    "research inherits the current GUI-selected parent model per call; missing model creates no child or dispatch",
  ],
  [
    "configuredBoundaries",
    "configured providers are fresh per workspace and resource changes retain the initialized selection",
  ],
  [
    "toolPermissions",
    "native document tool permission denial commits no changes and approval permits one operation",
  ],
] as const) {
  test(title, () => runApplicationFixture(mode), 30_000);
}
