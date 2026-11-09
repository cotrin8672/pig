import { expect, test } from "bun:test";
import { isExactPackageVersion, npmName, parsePackageSource } from "./packages";

test("manual npm names, scoped private names, specs and website URLs normalize without discovery", () => {
  for (const input of [
    "example",
    "npm:example",
    "https://www.npmjs.com/package/example",
    "https://npmjs.com/package/example",
    "https://www.npmjs.com/package/example/",
  ]) {
    expect(parsePackageSource(input)).toEqual({
      kind: "npm",
      name: "example",
      selector: undefined,
      source: "npm:example",
      request: "npm:example",
    });
  }
  expect(parsePackageSource("npm:@personal/private@^1.2.0")).toMatchObject({
    name: "@personal/private",
    selector: "^1.2.0",
    source: "npm:@personal/private",
  });
  expect(
    parsePackageSource(
      "https://www.npmjs.com/package/@personal/private/v/1.2.3",
    ),
  ).toMatchObject({ request: "npm:@personal/private@1.2.3" });
  expect(
    parsePackageSource("https://npmjs.com/package/@personal/private/v/1.2.3/"),
  ).toMatchObject({ request: "npm:@personal/private@1.2.3" });
  expect(
    parsePackageSource("https://www.npmjs.com/package/%40personal%2Fprivate"),
  ).toMatchObject({ name: "@personal/private" });
  expect(parsePackageSource("npm:example@next")).toMatchObject({
    selector: "next",
  });
  expect(isExactPackageVersion("1.2.3-beta.1+build.1")).toBe(true);
  expect(isExactPackageVersion("^1.2.3")).toBe(false);
});

test("canonical public/personal/private GitHub HTTPS and credential-helper SSH sources accept refs", () => {
  expect(
    parsePackageSource("https://github.com/Personal/Private.git#feature/one"),
  ).toEqual({
    kind: "github",
    url: "https://github.com/personal/private.git",
    source: "https://github.com/personal/private.git",
    ref: "feature/one",
    request: "https://github.com/personal/private.git#feature/one",
  });
  for (const input of [
    "git@github.com:personal/private.git",
    "git@github.com/personal/private.git",
    "ssh://git@github.com/personal/private",
    "ssh://git@github.com/personal/private.git",
  ]) {
    expect(parsePackageSource(input)).toMatchObject({
      kind: "github",
      source: "ssh://git@github.com/personal/private.git",
      ref: undefined,
    });
  }
  const commit = "a".repeat(40);
  expect(
    parsePackageSource(`git@github.com:personal/private.git#${commit}`),
  ).toMatchObject({ ref: commit });
  expect(
    parsePackageSource("https://github.com/a/b#refs/tags/v1.0.0"),
  ).toMatchObject({ ref: "refs/tags/v1.0.0" });
});

test("untrusted and ambiguous forms are rejected without echoing secrets", () => {
  for (const input of [
    null,
    "",
    "x".repeat(513),
    "Uppercase",
    "-x",
    "../x",
    "./x",
    "npm:../x",
    "file:x",
    "npm:x@npm:y",
    "npm:x@https://example.com/x",
    "npm:x@1 --ignore-scripts=false",
    "npm:x@>=1",
    "npm:x\n",
    "x\\y",
    "github:a/b",
    "git:https://github.com/a/b",
    "git+https://github.com/a/b",
    "https://github.com.evil/a/b",
    "https://gitlab.com/a/b",
    "http://github.com/a/b",
    "https://secret@github.com/a/b",
    "https://user:secret@github.com/a/b",
    "ssh://secret@github.com/a/b",
    "ssh://git@github.com:22/a/b",
    "git@github.com:a/b.git;evil",
    "https://github.com/a/b?token=secret",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/../b",
    "https://github.com/a/%2e%2e",
    "https://github.com/a/b#-evil",
    "https://github.com/a/b#main:other",
    "https://github.com/a/b#foo/../bar",
    "https://github.com/a/b#foo.lock",
    "https://github.com/a/b#foo//bar",
    "https://github.com/a/b#foo@{1}",
    "https://github.com/a/b#foo/",
    "https://www.npmjs.com/package/x?token=secret",
    "https://npmjs.com.evil/package/x",
    "https://npmjs.com/package/x//",
    "https://npmjs.com/package/x?token=secret/",
    "https://npmjs.com/package/x%2F%2F",
    "https://npmjs.com/package/x#secret",
    "https://www.npmjs.com/package/x/v/1.2.3//",
    "https://www.npmjs.com/package/../x",
    "https://www.npmjs.com/package/%252e%252e",
    "https://secret@www.npmjs.com/package/x",
    "https://www.npmjs.com/package/x/v/latest",
    "https://www.npmjs.com/package/x@latest",
  ]) {
    expect(() => parsePackageSource(input)).toThrow("Invalid package source");
    try {
      parsePackageSource(input);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  }
});

test("npmName remains usable for unchanged Marketplace operation matching", () => {
  expect(npmName("npm:pi-mcp-adapter")).toBe("pi-mcp-adapter");
  expect(npmName("npm:pi-mcp-adapter@7.0.1")).toBe("pi-mcp-adapter");
  expect(npmName("npm:@scope/pkg@^1.2")).toBe("@scope/pkg");
  expect(npmName("npm:@scope/pkg")).toBe("@scope/pkg");
  expect(npmName("https://github.com/a/b")).toBeUndefined();
  expect(npmName("npm:../x")).toBeUndefined();
  expect(npmName("./local")).toBeUndefined();
});
