import { expect, test } from "bun:test";
import { classifyShellCommand } from "./shell-command";

test("classifies allowlisted commands without retaining literal arguments", () => {
  expect(classifyShellCommand("bash", " \tgit status --short ")).toBe(
    "git status",
  );
  expect(classifyShellCommand("bash", 'git diff -- "src/sub dir/a.ts"')).toBe(
    "git diff",
  );
  expect(classifyShellCommand("bash", "pnpm test --runInBand")).toBe(
    "pnpm test",
  );
  expect(classifyShellCommand("bash", "rg 'literal|$name' .")).toBe("rg");
  expect(
    classifyShellCommand(
      "powershell",
      "get-childitem -Path 'C:\\Program Files'",
    ),
  ).toBe("Get-ChildItem");
  expect(classifyShellCommand("powershell", "GIT status")).toBe("git status");
  expect(classifyShellCommand("bash", "GIT status")).toBe("unclassified");
  expect(classifyShellCommand("bash", "Get-ChildItem")).toBe("unclassified");
});

test("leaves unknown, complex, and malformed commands unclassified", () => {
  for (const command of [
    undefined,
    { command: "git status" },
    "",
    "SECRET-executable status",
    "./git status",
    "git log",
    "git status && pnpm test",
    "git status; pnpm test",
    "git status\npnpm test",
    "git status\n",
    "git status | rg foo",
    "git status > secret.txt",
    "git status # comment",
    "git status\0",
    "rg '$name",
    'rg "$name"',
    "rg `command`",
    "rg $(command)",
    "rg *.txt",
    "rg @args",
    "rg --% $args",
    "rg 'foo’ ; Get-ChildItem ’bar'",
    `rg ${"a".repeat(4096)}`,
  ]) {
    for (const shell of ["bash", "powershell"] as const) {
      expect(classifyShellCommand(shell, command)).toBe("unclassified");
    }
  }
});
