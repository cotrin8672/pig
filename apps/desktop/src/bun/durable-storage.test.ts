import { expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  runCrashRecovery,
  runP0Child,
  spawnP0,
} from "../../scripts/durable-p0";
import { durableStoragePath, openDurableStorage } from "./durable-storage";

async function withRoot(use: (root: string) => Promise<void>) {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-durable-test-"),
  );
  try {
    await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("uses only the explicit agent-v2 namespace and rejects path-shaped workspace IDs", async () => {
  await withRoot(async (root) => {
    expect(
      durableStoragePath({ dataRoot: root, workspaceId: "opaque-1" }),
    ).toBe(join(root, "agent-v2", "workspaces", "opaque-1", "state.sqlite"));
    for (const workspaceId of [
      "",
      ".",
      "..",
      "../pi-agent",
      "a/b",
      "a\\b",
      "a:b",
      "a".repeat(129),
    ]) {
      expect(() =>
        durableStoragePath({ dataRoot: root, workspaceId }),
      ).toThrow();
    }
    expect(() =>
      durableStoragePath({ dataRoot: "relative", workspaceId: "a" }),
    ).toThrow();
  });
});

it("refuses racing local writers, isolates workspaces and releases ownership on close", async () => {
  await withRoot(async (root) => {
    const options = { dataRoot: root, workspaceId: "a" };
    const outcomes = await Promise.allSettled([
      openDurableStorage(options),
      openDurableStorage(options),
    ]);
    const won = outcomes.filter((item) => item.status === "fulfilled");
    expect(won).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const other = await openDurableStorage({
      dataRoot: root,
      workspaceId: "b",
    });
    await other.close(BACKGROUND_CONTEXT);
    for (const item of won)
      if (item.status === "fulfilled")
        await item.value.close(BACKGROUND_CONTEXT);
    const reopened = await openDurableStorage(options);
    await reopened.close(BACKGROUND_CONTEXT);
  });
});

it("fails closed on corrupt NEW storage without stranding ownership or touching legacy sentinels", async () => {
  await withRoot(async (root) => {
    const options = { dataRoot: root, workspaceId: "corrupt" };
    const path = durableStoragePath(options);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "deliberately not sqlite");
    const legacy = join(root, "pi-agent");
    await mkdir(legacy);
    const sentinel = join(legacy, "do-not-touch");
    await writeFile(sentinel, "untouched");
    for (let i = 0; i < 2; i++)
      await expect(openDurableStorage(options)).rejects.toThrow(
        "not a database",
      );
    expect(await readFile(sentinel, "utf8")).toBe("untouched");
  });
});

it("rejects a cross-process LIVE owner even with an old lock mtime; OS crash releases ownership", async () => {
  await withRoot(async (root) => {
    const holder = spawnP0("writer-hold", root);
    let pid: number | undefined;
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          pid = Number(await readFile(join(root, "writer-ready"), "utf8"));
          break;
        } catch {
          await Bun.sleep(20);
        }
      }
      if (!pid) throw new Error("writer child did not become ready");
      const lock = `${durableStoragePath({ dataRoot: root, workspaceId: "writer" })}.writer-lock`;
      const old = new Date(Date.now() - 3600_000);
      await utimes(lock, old, old);
      const contender = await runP0Child("writer-once", root);
      expect(contender.exitCode).not.toBe(0);
      expect(contender.stderr).toContain("single-writer lock");
      process.kill(pid, "SIGKILL");
      pid = undefined;
      await holder.exited;
      const recovery = await runP0Child("writer-once", root);
      expect(recovery.exitCode).toBe(0);
      expect(recovery.stderr).toBe("");
    } finally {
      if (pid) process.kill(pid, "SIGKILL");
      holder.kill();
      await holder.exited;
    }
  });
}, 30_000);

it("reopens after unclean process exit without deleting stale lock files", async () => {
  await withRoot(async (root) => {
    expect((await runP0Child("writer-crash", root)).exitCode).toBe(73);
    const reopened = await runP0Child("writer-once", root);
    expect(reopened.exitCode).toBe(0);
    expect(reopened.stdout).toContain("PASS writer");
  });
}, 30_000);

for (const [mode, title] of [
  [
    "harness",
    "native selection/docs/admission/watch and real Harness close-reopen",
  ],
  [
    "wait-race",
    "#11820 failed commit/wait rejects only handled promises (child process)",
  ],
  [
    "resources",
    "#11676 used provider sessions are released on Harness close (child process)",
  ],
]) {
  it(title, async () => {
    await withRoot(async (root) => {
      const result = await runP0Child(mode, root);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("PASS");
    });
  }, 30_000);
}

for (const kind of ["safe", "unsafe"] as const) {
  it(`process kill and reopen: ${kind} tool replay policy`, async () => {
    await withRoot(async (root) => {
      const result = await runCrashRecovery(root, kind);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("PASS");
    });
  }, 30_000);
}
