import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchProjectPaths } from "./project-files";

test("bounded ranking returns exactly the top 50 of a full sort, including ties", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-files-rank-"));
  const names: string[] = [];
  for (let i = 0; i < 40; i++) {
    await mkdir(join(root, `dir${i % 7}`), { recursive: true });
    for (const name of [`item${i}.ts`, `x-item-${i}.md`, `ITEM_${i}`]) {
      await writeFile(join(root, `dir${i % 7}`, name), "");
      names.push(`dir${i % 7}/${name}`);
    }
  }
  const query = "item";
  const rank = (path: string) => {
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    return base.startsWith(query) ? 0 : base.includes(query) ? 2 : 4;
  };
  const expected = names
    .map((path) => [rank(path), path] as const)
    .sort(
      ([a, x], [b, y]) => a - b || x.length - y.length || x.localeCompare(y),
    )
    .slice(0, 50)
    .map(([, path]) => path);
  const actual = await searchProjectPaths(root, query);
  expect(actual.map((item) => item.path)).toEqual(expected);
  const [first, second] = await Promise.all([
    searchProjectPaths(root, "dir1"),
    searchProjectPaths(root, "dir1"),
  ]);
  expect(second).toEqual(first);
});

test("lists project paths relative to the folder and ranks name matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-files-"));
  await mkdir(join(root, "src", "deep"), { recursive: true });
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "README.md"), "");
  await writeFile(join(root, "src", "app.ts"), "");
  await writeFile(join(root, "src", "deep", "mapper.ts"), "");
  await writeFile(join(root, "node_modules", "x", "app.ts"), "");

  expect(await searchProjectPaths(root, "")).toEqual([
    { path: "src", directory: true },
    { path: "README.md", directory: false },
  ]);
  const app = await searchProjectPaths(root, "app");
  expect(app[0]).toEqual({ path: "src/app.ts", directory: false });
  expect(app.some((item) => item.path.includes("node_modules"))).toBe(false);
  expect((await searchProjectPaths(root, "src\\deep"))[0]).toEqual({
    path: "src/deep",
    directory: true,
  });
  expect((await searchProjectPaths(root, "sdm")).map((i) => i.path)).toEqual([
    "src/deep/mapper.ts",
  ]);
});
