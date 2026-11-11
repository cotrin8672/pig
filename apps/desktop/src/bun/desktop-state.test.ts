import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { DesktopStateStore } from "./desktop-state";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const scratch = process.env.PI_SCRATCH_DIR ?? tmpdir();
  if (!scratch || !isAbsolute(scratch))
    throw new Error("PI_SCRATCH_DIR must be absolute.");
  const directory = await mkdtemp(join(scratch, "desktop-state-"));
  directories.push(directory);
  return join(directory, "settings", "desktop-state.json");
}

test("missing desktop state defaults to empty sessions without creating files", async () => {
  const file = await fixture();
  const store = new DesktopStateStore(file);
  expect(store.value).toEqual({ sessions: {} });
  await store.load();
  expect(store.value).toEqual({ sessions: {} });
  expect(await readdir(dirname(dirname(file)))).toEqual([]);
});

test("queues preference and session merges, persists them, and removes cleared or forgotten flags", async () => {
  const file = await fixture();
  const store = new DesktopStateStore(file);
  await Promise.all([
    store.setUiPreferences({ chatWidth: 900 }),
    store.setSession("first", { pinned: true }),
    store.setUiPreferences({ recentModels: ["provider/model"] }),
    store.setSession("first", { archived: true }),
    store.setSession("second", { pinned: true }),
    store.setSession("first", { pinned: false }),
  ]);
  const expected = {
    chatWidth: 900,
    recentModels: ["provider/model"],
    sessions: { first: { archived: true }, second: { pinned: true } },
  };
  expect(store.value).toEqual(expected);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(expected);
  const reloaded = new DesktopStateStore(file);
  await reloaded.load();
  expect(reloaded.value).toEqual(expected);
  expect(await readdir(dirname(file))).toEqual([basename(file)]);

  await Promise.all([
    store.setSession("first", { archived: false }),
    store.forgetSession("second"),
    store.forgetSession("missing"),
  ]);
  expect(store.value).toEqual({ ...expected, sessions: {} });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(store.value);
});

test("invalid preference patches, flags, and IDs leave memory and disk unchanged", async () => {
  const file = await fixture();
  const store = new DesktopStateStore(file);
  await store.setSession("keep", { pinned: true });
  const previous = store.value;
  const content = await readFile(file, "utf8");

  expect(() => store.setUiPreferences({ chatWidth: "900" })).toThrow();
  expect(() => store.setUiPreferences({ recentModels: [""] })).toThrow();
  expect(() => store.setSession("keep", { pinned: "yes" })).toThrow();
  expect(() => store.setSession("keep", {})).toThrow();
  await expect(
    store.setSession("nested/id", { archived: true }),
  ).rejects.toThrow();
  expect(store.value).toBe(previous);
  expect(await readFile(file, "utf8")).toBe(content);

  await store.setUiPreferences({ chatWidth: 800 });
  expect(store.value).toEqual({
    chatWidth: 800,
    sessions: { keep: { pinned: true } },
  });
});

test("preserves corrupt JSON or invalid state until an explicit valid save makes one backup", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const content of ["{broken JSON", '{"sessions":[]}']) {
      const file = await fixture();
      await mkdir(dirname(file));
      await writeFile(file, content);
      const store = new DesktopStateStore(file);
      await store.load();
      expect(store.value).toEqual({ sessions: {} });
      expect(await readFile(file, "utf8")).toBe(content);
      expect(await readdir(dirname(file))).toEqual([basename(file)]);
      expect(() => store.setUiPreferences({ chatWidth: null })).toThrow();
      expect(await readdir(dirname(file))).toEqual([basename(file)]);

      await store.setUiPreferences({ chatWidth: 850 });
      const backups = (await readdir(dirname(file))).filter((name) =>
        name.startsWith(`${basename(file)}.corrupt-`),
      );
      expect(backups).toHaveLength(1);
      const backup = backups[0];
      if (!backup) throw new Error("Missing corrupt-state backup.");
      expect(await readFile(join(dirname(file), backup), "utf8")).toBe(content);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
        chatWidth: 850,
        sessions: {},
      });
      await store.setSession("saved", { pinned: true });
      expect((await readdir(dirname(file))).sort()).toEqual(
        [basename(file), backup].sort(),
      );
      const reloaded = new DesktopStateStore(file);
      await reloaded.load();
      expect(reloaded.value).toEqual(store.value);
    }
  } finally {
    log.mockRestore();
  }
});

test("failed filesystem writes preserve the committed value and do not poison the queue", async () => {
  const file = await fixture();
  const store = new DesktopStateStore(file);
  await store.setUiPreferences({ chatWidth: 900 });
  const previous = store.value;
  const blocker = dirname(file);
  const saved = join(dirname(blocker), "saved-settings");
  await rename(blocker, saved);
  await writeFile(blocker, "not a directory");

  await expect(store.setSession("failed", { pinned: true })).rejects.toThrow();
  expect(store.value).toBe(previous);
  expect(
    JSON.parse(await readFile(join(saved, basename(file)), "utf8")),
  ).toEqual(previous);

  await rm(blocker);
  await store.setSession("recovered", { archived: true });
  expect(store.value).toEqual({
    chatWidth: 900,
    sessions: { recovered: { archived: true } },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(store.value);
});

test("completion persists, merges flags, emits committed states and rejects stale read ACKs", async () => {
  const file = await fixture();
  const emitted: unknown[] = [];
  const store = new DesktopStateStore(file, (state) => emitted.push(state));
  await store.setSession("chat", { pinned: true });
  await store.completeSession("chat", "success");
  const first = store.value.sessions.chat.completion?.id;
  if (!first) throw new Error("missing completion");
  await store.markSessionRead("chat", first);
  expect(store.value.sessions.chat.readCompletionId).toBe(first);
  await Promise.all([
    store.completeSession("chat", "error"),
    store.markSessionRead("chat", first),
    store.setSession("chat", {
      archived: true,
      completion: { id: "forged", outcome: "success" },
    }),
  ]);
  const flags = store.value.sessions.chat;
  expect(flags.completion?.outcome).toBe("error");
  expect(flags.completion?.id).not.toBe(first);
  expect(flags.completion?.id).not.toBe("forged");
  expect(flags.readCompletionId).toBe(first);
  expect(flags.pinned).toBe(true);
  expect(flags.archived).toBe(true);
  const reloaded = new DesktopStateStore(file);
  await reloaded.load();
  expect(reloaded.value).toEqual(store.value);
  expect(emitted.at(-1)).toBe(store.value);
  await store.clearCompletion("chat");
  expect(store.value.sessions.chat).toEqual({ pinned: true, archived: true });
  await store.markSessionRead("chat", first);
  expect(store.value.sessions.chat).toEqual({ pinned: true, archived: true });
  await store.completeSession("chat", "success");
  await store.forgetSession("chat");
  expect(store.value.sessions.chat).toBeUndefined();
});

test("Durable numeric string IDs persist pins and archive state independently", async () => {
  const file = await fixture();
  const store = new DesktopStateStore(file);
  await store.setSession("1", { pinned: true });
  await store.setSession("2", { archived: true });
  const reopened = new DesktopStateStore(file);
  await reopened.load();
  expect(reopened.value.sessions["1"]).toEqual({ pinned: true });
  expect(reopened.value.sessions["2"]).toEqual({ archived: true });
  await reopened.forgetSession("1");
  expect(reopened.value.sessions["2"]).toEqual({ archived: true });
});

test("unchanged desktop updates do not write, rename or notify, including queued completion races", async () => {
  const file = await fixture();
  const emitted: unknown[] = [];
  const store = new DesktopStateStore(file, (state) => emitted.push(state));
  const writes = spyOn(fs, "writeFile");
  const renames = spyOn(fs, "rename");
  try {
    const original = store.value;
    await Promise.all(
      Array.from({ length: 100 }, () => store.clearCompletion("chat")),
    );
    expect(store.value).toBe(original);
    expect(writes).not.toHaveBeenCalled();
    expect(renames).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);

    await Promise.all([
      store.completeSession("chat", "success"),
      store.clearCompletion("chat"),
      store.setSession("chat", { pinned: true }),
      store.completeSession("chat", "error"),
      store.setSession("chat", { archived: true }),
      store.clearCompletion("chat"),
      ...Array.from({ length: 100 }, () => store.clearCompletion("chat")),
    ]);
    expect(store.value.sessions.chat).toEqual({ pinned: true, archived: true });
    expect(writes).toHaveBeenCalledTimes(6);
    expect(renames).toHaveBeenCalledTimes(6);
    expect(emitted).toHaveLength(6);

    await store.setProject("fixture", { name: "Fixture", pinned: true });
    await store.setUiPreferences({
      chatWidth: 900,
      recentModels: ["provider/model"],
    });
    await store.completeSession("chat", "success");
    const completion = store.value.sessions.chat.completion?.id;
    if (!completion) throw new Error("Missing completion");
    await store.markSessionRead("chat", completion);
    const committed = store.value;
    const saved = writes.mock.calls.length;
    await Promise.all([
      store.setProject("fixture", { name: "Fixture", pinned: true }),
      store.setSession("chat", { pinned: true, archived: true }),
      store.setUiPreferences({
        chatWidth: 900,
        recentModels: ["provider/model"],
      }),
      store.markSessionRead("chat", completion),
      store.markSessionRead("chat", "stale"),
      store.forgetSession("missing"),
    ]);
    expect(store.value).toBe(committed);
    expect(writes).toHaveBeenCalledTimes(saved);
    expect(renames).toHaveBeenCalledTimes(saved);
    expect(emitted).toHaveLength(saved);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(committed);
  } finally {
    writes.mockRestore();
    renames.mockRestore();
  }
});
