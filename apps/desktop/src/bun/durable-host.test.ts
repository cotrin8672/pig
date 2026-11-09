import { it } from "bun:test";
import { runDurableHostFixture } from "./durable-host.fixture";

it(
  "native Close detaches, Stop aborts; epochs/openId/draft/connection lease remain app-owned",
  () => runDurableHostFixture("lifecycle"),
  30_000,
);
it(
  "native durable acceptance precedes draft CAS clear; receipts survive detach and host restart",
  () => runDurableHostFixture("send"),
  30_000,
);
it(
  "regenerate uses the preceding inclusive native boundary or a fresh first-input conversation; original retained",
  () => runDurableHostFixture("fork"),
  30_000,
);
it(
  "native Harness closure fails closed and failed reopen releases the writer",
  () => runDurableHostFixture("failure"),
  30_000,
);
it(
  "Stop cancels pending preflight and queued sends without clearing drafts or silently admitting them",
  () => runDurableHostFixture("stop-preflight"),
  30_000,
);
it(
  "shutdown closes every native workspace even when UI cleanup and transport callbacks fail",
  () => runDurableHostFixture("shutdown-failure"),
  30_000,
);
