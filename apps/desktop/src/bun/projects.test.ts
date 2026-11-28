import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  knownProject,
  validateProjectFlags,
  visibleProjects,
} from "../shared/projects";
import { ClientHub } from "./client-hub";
import { DesktopStateStore } from "./desktop-state";
import { ProjectStore } from "./project-store";

test("project rename/reset, pin and archive persist without changing legacy projects", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "projects-"),
  );
  try {
    const file = join(directory, "desktop.json");
    const legacy = join(directory, "projects.json");
    const projects = ["/work/first", "/work/second", "/work/third"];
    await writeFile(legacy, JSON.stringify(projects));
    const store = new DesktopStateStore(file);
    await store.load();
    await Promise.all([
      store.setProject(projects[0], { name: "  New name  " }),
      store.setProject(projects[1], { pinned: true }),
      store.setProject(projects[2], { archived: true, pinned: true }),
    ]);
    expect(store.value.projects?.[projects[0]]?.name).toBe("New name");
    expect(visibleProjects(projects, store.value.projects)).toEqual([
      projects[1],
      projects[0],
    ]);
    expect(visibleProjects(projects, store.value.projects, true)).toEqual([
      projects[2],
    ]);
    const reloaded = new DesktopStateStore(file);
    await reloaded.load();
    expect(reloaded.value).toEqual(store.value);
    await reloaded.setProject(projects[0], { name: "  " });
    expect(reloaded.value.projects?.[projects[0]]).toBeUndefined();
    await reloaded.setProject(projects[2], { archived: false, pinned: false });
    expect(visibleProjects(projects, reloaded.value.projects)).toEqual([
      projects[1],
      projects[0],
      projects[2],
    ]);
    // Pinned stays first; the rest follow their latest chat.
    expect(
      visibleProjects(projects, reloaded.value.projects, false, {
        [projects[0]]: 1,
        [projects[2]]: 2,
      }),
    ).toEqual([projects[1], projects[2], projects[0]]);
    expect(JSON.parse(await readFile(legacy, "utf8"))).toEqual(projects);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project RPC validation rejects unknown paths and malformed patches", () => {
  for (const cwd of [null, 1, "", "/unknown", "/known\n"])
    expect(() => knownProject(cwd, ["/known"])).toThrow();
  expect(knownProject("/known", ["/known"])).toBe("/known");
  for (const input of [
    null,
    [],
    {},
    { name: 2 },
    { name: "x".repeat(513) },
    { name: "line\nbreak" },
    { pinned: 1 },
    { archived: "true" },
  ])
    expect(() => validateProjectFlags(input)).toThrow();
  expect(validateProjectFlags({ name: "", pinned: false })).toEqual({
    name: "",
    pinned: false,
  });
});

test("project aliases register once; both windows see addition and removal without removing chats or metadata", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "project-remove-"),
  );
  try {
    const file = join(directory, "source.txt");
    const chats = join(directory, "chat.jsonl");
    const list = join(directory, "projects.json");
    const desktop = join(directory, "desktop.json");
    const hub = new ClientHub("test");
    const notifications = [[], []] as string[][][];
    for (const [i, changes] of notifications.entries())
      hub.add(String(i), (type, value) => {
        if (type === "projects" && Array.isArray(value))
          changes.push(value as string[]);
      });
    const projects = new ProjectStore(list, join(directory, "general"), (p) =>
      hub.broadcast("projects", p),
    );
    const alias = `${process.platform === "win32" ? directory.toUpperCase() : directory}${sep}.${sep}`;
    const first = projects.register(directory);
    const same = projects.register(alias);
    const revoked = projects.register(join(directory, "revoked"), () => {
      throw new Error("revoked");
    });
    expect(await Promise.all([first, same])).toEqual([directory, directory]);
    await expect(revoked).rejects.toThrow("revoked");
    expect(projects.value).toEqual([directory]);
    await projects.validateScope(directory);
    await expect(projects.validateScope(alias)).rejects.toThrow();
    await writeFile(file, "keep source");
    await writeFile(chats, "keep chat");
    const store = new DesktopStateStore(desktop);
    await store.setProject(directory, { name: "Keep metadata" });
    await store.setSession("chat", { pinned: true });
    const before = await readFile(desktop, "utf8");
    expect(await projects.remove(directory)).toEqual([]);
    expect(notifications).toEqual([
      [[directory], []],
      [[directory], []],
    ]);
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("keep source");
    expect(await readFile(chats, "utf8")).toBe("keep chat");
    expect(await readFile(desktop, "utf8")).toBe(before);
    await expect(projects.remove("/unknown")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
