import { test } from "bun:test";
import { runCompatibilityFixture } from "./application-compatibility.fixture";

for (const [mode, title] of [
  [
    "known",
    "fixed native manifest survives reopen and fresh builtin closures pass the compatibility gate",
  ],
  [
    "manifests",
    "missing, changed and opaque manifests fail closed and cannot be re-blessed",
  ],
  [
    "dependencies",
    "paged inspection finds pending approvals/delegations without live tasks and rejects unknown schemas",
  ],
  [
    "metadata",
    "metadata inspection creates no documents and invokes no runtime callbacks or factories",
  ],
  [
    "tasks",
    "resume accepts only exact native live task definitions and known tool calls",
  ],
] as const) {
  test(title, () => runCompatibilityFixture(mode), 30_000);
}
