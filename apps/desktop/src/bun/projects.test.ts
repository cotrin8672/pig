import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knownProject,
  validateProjectFlags,
  visibleProjects,
  withoutProject,
} from "../shared/projects";
import { DesktopStateStore } from "./desktop-state";

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

test("removing a project only updates the list, leaving its files, chats and metadata intact", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "project-remove-"),
  );
  try {
    const file = join(directory, "source.txt");
    const chats = join(directory, "chat.jsonl");
    const list = join(directory, "projects.json");
    const desktop = join(directory, "desktop.json");
    await writeFile(file, "keep source");
    await writeFile(chats, "keep chat");
    const store = new DesktopStateStore(desktop);
    await store.setProject(directory, { name: "Keep metadata" });
    await store.setSession("chat", { pinned: true });
    const before = await readFile(desktop, "utf8");
    await writeFile(
      list,
      JSON.stringify(withoutProject([directory, "/other"], directory)),
    );
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual(["/other"]);
    expect(await readFile(file, "utf8")).toBe("keep source");
    expect(await readFile(chats, "utf8")).toBe("keep chat");
    expect(await readFile(desktop, "utf8")).toBe(before);
    expect(() => withoutProject([directory], "/unknown")).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
