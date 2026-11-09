import { expect, test } from "bun:test";
import {
  classify,
  npmName,
  packageCompatibility,
  validNpmName,
} from "./packages";

test("classification indicates package content, never UI compatibility", () => {
  expect(
    classify(["pi-package", "extensions", "THEME", "pi-skill", "prompt"]),
  ).toEqual(["extension", "skill", "theme", "prompt"]);
  expect(classify(undefined)).toEqual([]);
  expect(packageCompatibility("popular-on-npm", "1.0.0")).toEqual({
    status: "unverified",
  });
});
test("npm names and pinned configured sources are parsed without accepting URLs as install names", () => {
  expect(npmName("npm:@scope/pkg@^1")).toBe("@scope/pkg");
  expect(npmName("npm:pkg@1.2.3")).toBe("pkg");
  expect(npmName("https://example.com/pkg")).toBeUndefined();
  expect(npmName("npm:../x")).toBeUndefined();
  expect(validNpmName("@scope/pkg")).toBe(true);
  for (const name of [
    "",
    "../../pkg",
    "https://example.com/pkg",
    "pkg@latest",
    "pkg --unsafe",
    "name;command",
    "UPPER",
    "a".repeat(215),
  ])
    expect(validNpmName(name)).toBe(false);
});
