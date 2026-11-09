import { it } from "bun:test";
import { runDurableHostFixture } from "./durable-host.fixture";

it(
  "native token docs preserve absence/retirement, detached snapshots, stale controller checks and late-watch disposal",
  () => runDurableHostFixture("source"),
  30_000,
);
it(
  "native adapter actions enforce epoch, generation and consumed view revisions",
  () => runDurableHostFixture("action"),
  30_000,
);
