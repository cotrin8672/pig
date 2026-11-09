import { it } from "bun:test";
import { runHostControlFixture } from "./durable-host-control.fixture";

it(
  "package mutation seals admission synchronously and releases all initialized scopes",
  () => runHostControlFixture("package-idle"),
  30_000,
);
it(
  "package mutation rejects real native work and kept submissions without pausing or aborting",
  () => runHostControlFixture("package-native"),
  30_000,
);
it(
  "host commands use one native registry, bound sources/controller, confirmation and keymap bridge",
  () => runHostControlFixture("commands"),
  30_000,
);
it(
  "global command and config leases exclude package apply without invalidating admitted controllers",
  () => runHostControlFixture("command-leases"),
  30_000,
);
it(
  "config.reload runs only after command/adapter lease release and exposes failures",
  () => runHostControlFixture("deferred-reload"),
  30_000,
);
it(
  "native UI reconnect awaits hooks without changing draft/epoch or cancelling native work",
  () => runHostControlFixture("reconnect"),
  30_000,
);
it(
  "opening and preflight leases, plus persistent approvals, exclude package commits",
  () => runHostControlFixture("admission-leases"),
  30_000,
);
it(
  "command cancellation stops late-acquired native document watches but not the conversation run",
  () => runHostControlFixture("command-cancellation"),
  30_000,
);
