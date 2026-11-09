import { it } from "bun:test";
import { runDurableHostFixture } from "./durable-host.fixture";

it(
  "native workspaces isolate Harness/Models/Registry and persist immutable membership/title/profile across restart",
  () => runDurableHostFixture("workspace"),
  30_000,
);
it(
  "runtime reload preserves last-good for active/background/pending deps and unknown task/doc compatibility",
  () => runDurableHostFixture("reload"),
  30_000,
);
it(
  "ConfigLoader commits only after workspace apply and preserves the native generation on invalid reload",
  () => runDurableHostFixture("config-loader"),
  30_000,
);
