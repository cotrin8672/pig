import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { prepareDesktopConfig } from "./desktop-config";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const scratch = process.env.PI_SCRATCH_DIR;
  if (!scratch || !isAbsolute(scratch))
    throw new Error("PI_SCRATCH_DIR must be absolute.");
  const directory = await mkdtemp(join(scratch, "desktop-config-"));
  directories.push(directory);
  return {
    legacy: join(directory, "legacy"),
    destination: join(directory, "desktop"),
  };
}

test("copies only the four allowed config files and retains every legacy file", async () => {
  const { legacy, destination } = await fixture();
  await mkdir(join(legacy, "sessions"), { recursive: true });
  const allowed = [
    "projects.json",
    "appearance.json",
    "disabled-models.json",
    "settings.json",
  ];
  const excluded = [
    "auth.json",
    "credentials.json",
    "sessions.json",
    "desktop-state.json",
  ];
  for (const name of [...allowed, ...excluded]) {
    await writeFile(join(legacy, name), JSON.stringify({ fixture: name }));
  }
  const history = join(legacy, "sessions", "fixture.jsonl");
  await writeFile(history, "private history\n");

  await prepareDesktopConfig(legacy, destination);

  expect((await readdir(destination)).sort()).toEqual(
    [...allowed, "general"].sort(),
  );
  for (const name of [...allowed, ...excluded]) {
    const content = JSON.stringify({ fixture: name });
    expect(await readFile(join(legacy, name), "utf8")).toBe(content);
    if (allowed.includes(name)) {
      expect(await readFile(join(destination, name), "utf8")).toBe(content);
    }
  }
  expect(await readFile(history, "utf8")).toBe("private history\n");
});

test("does not overwrite desktop settings and tolerates missing legacy files on repeated runs", async () => {
  const { legacy, destination } = await fixture();
  await mkdir(legacy);
  await mkdir(destination);
  await writeFile(join(legacy, "settings.json"), '{"source":"legacy"}');
  await writeFile(join(legacy, "projects.json"), '["fixture"]');
  await writeFile(join(destination, "settings.json"), '{"source":"desktop"}');

  await prepareDesktopConfig(legacy, destination);
  await writeFile(join(legacy, "projects.json"), '["changed"]');
  await prepareDesktopConfig(legacy, destination);

  expect(await readFile(join(destination, "settings.json"), "utf8")).toBe(
    '{"source":"desktop"}',
  );
  expect(await readFile(join(destination, "projects.json"), "utf8")).toBe(
    '["fixture"]',
  );
  expect(await readFile(join(legacy, "settings.json"), "utf8")).toBe(
    '{"source":"legacy"}',
  );
  expect((await readdir(destination)).sort()).toEqual([
    "general",
    "projects.json",
    "settings.json",
  ]);

  const emptyDestination = join(destination, "empty");
  await prepareDesktopConfig(join(legacy, "missing"), emptyDestination);
  expect(await readdir(emptyDestination)).toEqual(["general"]);
  expect(await readdir(join(emptyDestination, "general"))).toEqual([]);
});
