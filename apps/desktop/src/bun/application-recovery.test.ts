import { test } from "bun:test";
import { runApplicationRecoveryFixture } from "./application-recovery.fixture";

// No native value imports here: each RTK child gets an isolated HOME first.
test(
  "SQLite/process crash before intent preserves the original approval and receipt; explicit reprojection runs one injected effect",
  () => runApplicationRecoveryFixture("before-intent"),
  42_000,
);

test(
  "SQLite/process crash after unsafe write intent saves an interrupted result; stale approval cannot execute the write",
  () => runApplicationRecoveryFixture("unsafe-write"),
  42_000,
);
