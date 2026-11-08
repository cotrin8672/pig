import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSessionScope } from "./session-scope";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("only registered or managed-general cwd is accepted; project-only never permits general", async () => {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR, "session-scope-"),
  );
  directories.push(root);
  const project = join(root, "project");
  const general = join(root, "general");
  const arbitrary = join(root, "arbitrary");
  const file = join(root, "file");
  await Promise.all([project, general, arbitrary].map((dir) => mkdir(dir)));
  await writeFile(file, "not a directory");
  await validateSessionScope(project, [project], general);
  await validateSessionScope(general, [], general);
  await validateSessionScope(project, [project], general, true);
  await expect(
    validateSessionScope(general, [project], general, true),
  ).rejects.toThrow();
  for (const cwd of [arbitrary, root, join(project, "child"), file, ""])
    await expect(
      validateSessionScope(cwd, [project], general),
    ).rejects.toThrow();
  await expect(validateSessionScope(project, [], general)).rejects.toThrow();
  await expect(validateSessionScope(file, [file], general)).rejects.toThrow();
  await rm(general, { recursive: true });
  await expect(validateSessionScope(general, [], general)).rejects.toThrow();
});
