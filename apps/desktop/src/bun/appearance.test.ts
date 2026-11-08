import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAppearance,
  saveAppearance,
  validateAppearance,
} from "./appearance";

test("appearance validates backdrop and clamps finite opacity", () => {
  expect(validateAppearance({ backdrop: "none", opacity: -1 })).toEqual({
    backdrop: "none",
    opacity: 0.3,
  });
  expect(validateAppearance({ backdrop: "mica", opacity: 2 })).toEqual({
    backdrop: "mica",
    opacity: 1,
  });
  for (const value of [
    null,
    [],
    { backdrop: "image", opacity: 1 },
    { backdrop: "acrylic", opacity: Number.NaN },
    { backdrop: "none", opacity: "0.5" },
  ])
    expect(() => validateAppearance(value)).toThrow();
});

test("corrupt appearance remains untouched until an explicit valid save", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piris-appearance-"));
  const file = join(directory, "appearance.json");
  try {
    await writeFile(file, "{broken");
    expect(await loadAppearance(file)).toEqual({
      backdrop: "acrylic",
      opacity: 0.78,
    });
    expect(await readFile(file, "utf8")).toBe("{broken");
    const next = validateAppearance({ backdrop: "mica", opacity: 0.6 });
    await saveAppearance(file, next);
    expect(await loadAppearance(file)).toEqual(next);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
