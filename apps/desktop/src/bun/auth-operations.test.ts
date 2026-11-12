import { expect, test } from "bun:test";
import { AuthOperations } from "./auth-operations";

test("logout cancels active and queued login, waits for completion and cannot be undone", async () => {
  const ops = new AuthOperations();
  const active = new AbortController(),
    queued = new AbortController();
  let release!: () => void;
  let ready!: () => void;
  const started = new Promise<void>((r) => {
    ready = r;
  });
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  const events: string[] = [];
  const first = ops.login("one", active, async () => {
    ready();
    await blocked;
    events.push("late-login-save");
  });
  await started;
  const second = ops
    .login("one", queued, async () => {
      events.push("queued-save");
    })
    .catch(() => {});
  const logout = ops.logout("one", async () => {
    events.push("logout");
  });
  expect(active.signal.aborted).toBe(true);
  expect(queued.signal.aborted).toBe(true);
  await ops.login("other", new AbortController(), async () => {
    events.push("other");
  });
  expect(events).toEqual(["other"]);
  release();
  await Promise.all([first, second, logout]);
  expect(events).toEqual(["other", "late-login-save", "logout"]);
  await ops.login("one", new AbortController(), async () => {
    events.push("new-login");
  });
  expect(events.at(-1)).toBe("new-login");
});

test("accounts share a provider login queue but logout cancels only its target", async () => {
  const ops = new AuthOperations();
  const work = new AbortController(),
    personal = new AbortController();
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const events: string[] = [];
  const first = ops.login(
    "work",
    work,
    async () => {
      started.resolve();
      await release.promise;
      events.push("work");
    },
    "codex",
  );
  await started.promise;
  const second = ops.login(
    "private",
    personal,
    async () => {
      events.push("private");
    },
    "codex",
  );
  const logout = ops.logout(
    "work",
    async () => {
      events.push("work logout");
    },
    "codex",
  );
  expect(work.signal.aborted).toBe(true);
  expect(personal.signal.aborted).toBe(false);
  expect(events).toEqual([]);
  release.resolve();
  await Promise.all([first, second, logout]);
  expect(events).toEqual(["work", "private", "work logout"]);
});

test("logins for the same provider execute in request order even after failure", async () => {
  const ops = new AuthOperations();
  const events: number[] = [];
  const first = ops
    .login("one", new AbortController(), async () => {
      events.push(1);
      throw new Error("failed");
    })
    .catch(() => {});
  const second = ops.login("one", new AbortController(), async () => {
    events.push(2);
  });
  await Promise.all([first, second]);
  expect(events).toEqual([1, 2]);
});
