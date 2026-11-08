import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "../shared/rpc-schema";
import {
  assertSessionDeletable,
  listStoredSessions,
  removeStoredSession,
  renameStoredSession,
  sessionName,
} from "./session-files";

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
  const directory = await mkdtemp(join(scratch, "session-files-"));
  directories.push(directory);
  const cwd = join(directory, "project");
  await mkdir(cwd);
  const manager = SessionManager.create(cwd, join(directory, "sessions"));
  const message = {
    role: "user" as const,
    content: "fixture",
    timestamp: Date.now(),
  };
  manager.appendMessage(message);
  manager.appendSessionInfo("Original title");
  const path = manager.getSessionFile();
  if (!path) throw new Error("Expected an offline SDK session file.");
  const info: SessionInfo = {
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    path,
    title: "Original title",
    modified: Date.now(),
  };
  return { info, path, message };
}

test("filters stored history by normalized header cwd even when SDK directories collide", async () => {
  const { info, path } = await fixture();
  const [stored] = await SessionManager.list(info.cwd, dirname(path));
  const differentlyCased = {
    ...stored,
    id: "same-project-case",
    cwd: info.cwd.toUpperCase(),
  };
  const listing = spyOn(SessionManager, "list").mockResolvedValue([
    stored,
    { ...stored, id: "other-project", cwd: `${info.cwd}-other` },
    differentlyCased,
  ]);
  try {
    const found = await listStoredSessions(join(info.cwd, "nested", ".."));
    expect(found.map((session) => session.id)).toEqual([
      info.id,
      ...(process.platform === "win32" ? [differentlyCased.id] : []),
    ]);
  } finally {
    listing.mockRestore();
  }
});

test("sanitizes chat names and rejects non-strings, empty names, or names over 512 characters", () => {
  expect(sessionName("  A\r\nnew\nchat  ")).toBe("A new chat");
  expect(sessionName("x".repeat(512))).toBe("x".repeat(512));
  for (const invalid of [
    null,
    undefined,
    42,
    {},
    "",
    " \r\n\t ",
    "x".repeat(513),
  ]) {
    expect(() => sessionName(invalid)).toThrow();
  }
});

test("offline SDK rename appends a sanitized title and preserves the persisted conversation", async () => {
  const { info, path, message } = await fixture();
  const original = await readFile(path, "utf8");
  const before = SessionManager.open(path).getEntries();

  expect(renameStoredSession(info, "  Renamed\r\nchat  ")).toBe("Renamed chat");

  const reopened = SessionManager.open(path);
  expect(reopened.getSessionName()).toBe("Renamed chat");
  expect(reopened.getSessionId()).toBe(info.id);
  expect(reopened.getCwd()).toBe(info.cwd);
  expect(reopened.buildSessionContext().messages).toEqual([message]);
  expect(reopened.getEntries().slice(0, -1)).toEqual(before);
  expect(reopened.getEntries().at(-1)).toMatchObject({
    type: "session_info",
    name: "Renamed chat",
  });
  expect((await readFile(path, "utf8")).startsWith(original)).toBe(true);
});

test("stale IDs or cwd, invalid titles, and unavailable history cannot mutate a stored session", async () => {
  const { info, path } = await fixture();
  const original = await readFile(path, "utf8");
  expect(() =>
    renameStoredSession({ ...info, id: "stale-id" }, "New title"),
  ).toThrow("Chat history changed");
  expect(() =>
    renameStoredSession({ ...info, cwd: `${info.cwd}-stale` }, "New title"),
  ).toThrow("Chat history changed");
  expect(() =>
    renameStoredSession({ ...info, path: undefined }, "New title"),
  ).toThrow("Chat history is unavailable");
  for (const name of ["", " \r\n ", "x".repeat(513)]) {
    expect(() => renameStoredSession(info, name)).toThrow();
  }
  expect(await readFile(path, "utf8")).toBe(original);
  expect(SessionManager.open(path).getSessionName()).toBe("Original title");
});

test("deletion requires idle state, no running bash, and no pending prompt even after manager closure", () => {
  for (const session of [
    { isIdle: false, isBashRunning: false },
    { isIdle: true, isBashRunning: true },
    { isIdle: false, isBashRunning: true },
  ]) {
    expect(() => assertSessionDeletable(session)).toThrow(
      "Stop the current response",
    );
  }
  expect(() => assertSessionDeletable(undefined, true)).toThrow(
    "Stop the current response",
  );
  expect(() =>
    assertSessionDeletable({ isIdle: true, isBashRunning: false }, true),
  ).toThrow();
  expect(() => assertSessionDeletable()).not.toThrow();
  expect(() =>
    assertSessionDeletable({ isIdle: true, isBashRunning: false }),
  ).not.toThrow();
});

test("deletes only the selected history file and tolerates missing or unavailable files", async () => {
  const { info, path } = await fixture();
  const sibling = join(dirname(path), "keep.jsonl");
  await writeFile(sibling, "keep this history\n");

  await removeStoredSession(info);

  await expect(readFile(path, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(sibling, "utf8")).toBe("keep this history\n");
  await expect(removeStoredSession(info)).resolves.toBeUndefined();
  await expect(
    removeStoredSession({ ...info, path: undefined }),
  ).resolves.toBeUndefined();
  expect(await readFile(sibling, "utf8")).toBe("keep this history\n");
});

test("refuses to recursively delete a directory passed as a session path", async () => {
  const { info, path } = await fixture();
  const original = await readFile(path, "utf8");
  const directory = join(dirname(path), "directory.jsonl");
  await mkdir(directory);
  const child = join(directory, "keep.jsonl");
  await writeFile(child, "keep child history\n");

  await expect(
    removeStoredSession({ ...info, path: directory }),
  ).rejects.toThrow();

  expect(await readFile(child, "utf8")).toBe("keep child history\n");
  expect(await readFile(path, "utf8")).toBe(original);
});
