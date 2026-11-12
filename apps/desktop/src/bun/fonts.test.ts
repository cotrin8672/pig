import { expect, test } from "bun:test";
import { listFontFamilies, parseFontFamilies } from "./fonts";

test("font enumeration normalizes, sorts, and deduplicates localized family names", () => {
  expect(
    parseFontFamilies("\uFEFF游ゴシック\r\nArial\r\n Arial \n\n游ゴシック\n"),
  ).toEqual(["Arial", "游ゴシック"].sort((a, b) => a.localeCompare(b)));
  expect(parseFontFamilies("Consolas\n")).toEqual(["Consolas"]);
  expect(parseFontFamilies("")).toEqual([]);
  expect(() => parseFontFamilies(null as unknown as string)).toThrow(
    "Could not read installed font names.",
  );
});

test.skipIf(process.platform !== "win32")(
  "reads the installed Windows fonts",
  async () => {
    const fonts = await listFontFamilies();
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts).toContain("Segoe UI");
    expect(fonts).toEqual(
      [...new Set(fonts)].sort((a, b) => a.localeCompare(b)),
    );
  },
  20_000,
);
