import { expect, test } from "bun:test";
import { resolveGitBash, resolvePowerShell, shellCommand } from "./shell-paths";

test("SDK-free Git Bash resolver supports portable, per-user and system layouts", () => {
  const bash = "D:\\PortableGit\\usr\\bin\\bash.exe";
  for (const git of [
    "D:\\PortableGit\\cmd\\git.exe",
    "D:\\PortableGit\\bin\\git.exe",
    "D:\\PortableGit\\mingw64\\bin\\git.exe",
  ])
    expect(resolveGitBash({}, git, (path) => path === bash)).toBe(bash);
  const local = "C:\\Users\\fixture\\AppData\\Local";
  const userBash = `${local}\\Programs\\Git\\usr\\bin\\bash.exe`;
  expect(
    resolveGitBash({ LOCALAPPDATA: local }, null, (path) => path === userBash),
  ).toBe(userBash);
  for (const key of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const systemBash = "D:\\Applications\\Git\\usr\\bin\\bash.exe";
    expect(
      resolveGitBash(
        { [key]: "D:\\Applications" },
        null,
        (path) => path === systemBash,
      ),
    ).toBe(systemBash);
  }
  expect(resolveGitBash({}, null, () => false)).toBeUndefined();
});

test("PATH Git wins over other installs and the Windows wrapper is never selected", () => {
  const paths: string[] = [];
  const resolved = resolveGitBash(
    { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" },
    "D:\\PortableGit\\cmd\\git.exe",
    (path) => {
      paths.push(path);
      return path === "D:\\PortableGit\\usr\\bin\\bash.exe";
    },
  );
  expect(resolved).toBe("D:\\PortableGit\\usr\\bin\\bash.exe");
  expect(paths).toEqual(["D:\\PortableGit\\usr\\bin\\bash.exe"]);
});

test("PowerShell resolution and shell argv preserve their separate dialects", () => {
  expect(resolvePowerShell((name) => `C:/${name}`)).toBe("C:/pwsh.exe");
  expect(
    resolvePowerShell((name) =>
      name === "powershell.exe" ? "C:/powershell.exe" : null,
    ),
  ).toBe("C:/powershell.exe");
  expect(() => resolvePowerShell(() => null)).toThrow(
    "neither pwsh.exe nor powershell.exe",
  );
  const command = 'echo "$a" && printf "%s" "a b"';
  expect(shellCommand("powershell", "pwsh.exe", command)).toEqual([
    "pwsh.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command,
  ]);
  expect(shellCommand("git-bash", "bash.exe", command)).toEqual([
    "bash.exe",
    "-c",
    command,
  ]);
});
