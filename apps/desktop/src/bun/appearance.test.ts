import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAppearance, toggleBackdrop } from "../shared/appearance";
import {
  applyBackdrop,
  loadAppearance,
  saveAppearance,
  validateAppearance,
  windowStyleForBackdrop,
} from "./appearance";

test("backdrop rejects a missing Windows HWND before calling native APIs", () => {
  if (process.platform === "win32")
    expect(() => applyBackdrop(null, defaultAppearance)).toThrow(
      "closed window",
    );
});

test("appearance validates backdrop and clamps finite opacity", () => {
  expect(validateAppearance({ backdrop: "none", opacity: -1 })).toEqual({
    backdrop: "none",
    opacity: { none: 0, acrylic: 0, mica: 0 },
    effect: "acrylic",
  });
  expect(validateAppearance({ backdrop: "mica", opacity: 2 })).toEqual({
    backdrop: "mica",
    opacity: { none: 1, acrylic: 1, mica: 1 },
    effect: "mica",
  });
  for (const opacity of [0, 0.01, 0.29, 1])
    expect(validateAppearance({ backdrop: "none", opacity }).opacity.none).toBe(
      opacity,
    );
  for (const value of [
    null,
    [],
    { backdrop: "image", opacity: 1 },
    { backdrop: "acrylic", opacity: Number.NaN },
    { backdrop: "none", opacity: "0.5" },
  ])
    expect(() => validateAppearance(value)).toThrow();
});

test("backdrop removes native caption buttons but preserves resize and Snap", () => {
  expect(windowStyleForBackdrop(0x16c40000)).toBe(0x140f0000);
  expect(windowStyleForBackdrop(0x37c40000)).toBe(0x350f0000);
  expect(windowStyleForBackdrop(0x140f0000)).toBe(0x140f0000);
  for (const style of [0x16c40000, 0x37c40000, 0x14cf0000]) {
    const next = windowStyleForBackdrop(style);
    expect(next & 0x00c00000).toBe(0);
    expect(next & 0x02000000).toBe(0);
    expect(next & 0x000f0000).toBe(0x000f0000);
  }
});

test("corrupt appearance remains untouched until an explicit valid save", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-appearance-"),
  );
  const file = join(directory, "appearance.json");
  try {
    expect(await loadAppearance(file)).toEqual(defaultAppearance);
    await writeFile(file, "{broken");
    expect(await loadAppearance(file)).toEqual(defaultAppearance);
    expect(await readFile(file, "utf8")).toBe("{broken");
    const next = validateAppearance({ backdrop: "mica", opacity: 0 });
    await saveAppearance(file, next);
    expect(await loadAppearance(file)).toEqual(next);
    await writeFile(file, JSON.stringify({ backdrop: "mica", opacity: 0.4 }));
    const migrated = await loadAppearance(file);
    expect(migrated).toEqual({
      backdrop: "mica",
      effect: "mica",
      opacity: { none: 0.4, acrylic: 0.4, mica: 0.4 },
    });
    await saveAppearance(file, migrated);
    expect(await loadAppearance(file)).toEqual(migrated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("independent opacity values clamp and toggle remembers the effect", () => {
  const appearance = validateAppearance({
    backdrop: "mica",
    effect: "mica",
    opacity: { none: -1, acrylic: 0.4, mica: 2 },
  });
  expect(appearance.opacity).toEqual({ none: 0, acrylic: 0.4, mica: 1 });
  const off = toggleBackdrop(appearance);
  expect(off.backdrop).toBe("none");
  expect(off.effect).toBe("mica");
  expect(toggleBackdrop(off)).toEqual(appearance);
  expect(() =>
    validateAppearance({ ...appearance, opacity: { none: 0 } }),
  ).toThrow();
});
