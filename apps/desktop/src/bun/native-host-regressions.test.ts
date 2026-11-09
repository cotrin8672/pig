import { test } from "bun:test";
import { runNativeHostRegression } from "./native-host-regressions.fixture";

// Other migrated contracts already have real-Harness coverage in durable-host,
// durable-projector, durable-send-receipts, durable-adapter-source and native-tools.
for (const [mode, title] of [
  [
    "models",
    "native fork and metadata-only restart retain model/effort; hidden models never dispatch",
  ],
  [
    "transitions",
    "native config transitions reject mutations and retain drafts on failure and success",
  ],
  [
    "deletion",
    "empty native delete rejects wrong scope/missing IDs and unsupported physical deletion retains originals",
  ],
  [
    "dialogs",
    "native ordinary dialogs fail closed on Root lease expiry without aborting native work",
  ],
]) {
  test(title, () => runNativeHostRegression(mode), 30_000);
}
