import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blockedImageNote,
  decodeImageNote,
  preparePromptImages,
  scrubImages,
} from "./image-policy";
import { createBashTool, createPowerShellTool } from "./sdk";
import { resolveGitBash, resolvePowerShell, shellCommand } from "./shell-tools";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("Git Bash resolves real usr/bin from PATH, per-user and system installs", () => {
  const bash = "D:\\PortableGit\\usr\\bin\\bash.exe";
  for (const git of [
    "D:\\PortableGit\\cmd\\git.exe",
    "D:\\PortableGit\\bin\\git.exe",
    "D:\\PortableGit\\mingw64\\bin\\git.exe",
  ])
    expect(resolveGitBash({}, git, (path) => path === bash)).toBe(bash);
  const local = "C:\\Users\\test\\AppData\\Local",
    userBash = `${local}\\Programs\\Git\\usr\\bin\\bash.exe`;
  expect(
    resolveGitBash({ LOCALAPPDATA: local }, null, (path) => path === userBash),
  ).toBe(userBash);
  const system = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
  expect(
    resolveGitBash(
      { ProgramFiles: "C:\\Program Files" },
      null,
      (path) => path === system,
    ),
  ).toBe(system);
  expect(resolveGitBash({}, null, () => false)).toBeUndefined();
});
test("PowerShell resolution and argv remain truthful and distinct", () => {
  expect(resolvePowerShell((name) => `C:/${name}`)).toBe("C:/pwsh.exe");
  expect(
    resolvePowerShell((name) =>
      name === "powershell.exe" ? "C:/powershell.exe" : null,
    ),
  ).toBe("C:/powershell.exe");
  expect(() => resolvePowerShell(() => null)).toThrow(
    "neither pwsh.exe nor powershell.exe",
  );
  expect(shellCommand("powershell", "pwsh.exe", "Write-Output hi")).toEqual([
    "pwsh.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Write-Output hi",
  ]);
  expect(shellCommand("git-bash", "bash.exe", "echo hi")).toEqual([
    "bash.exe",
    "-c",
    "echo hi",
  ]);
});
test("SDK Bash executes in cwd, times out, and honors cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pig-sdk-shell-"));
  directories.push(cwd);
  const tool = createBashTool(cwd, {
    shellPath: process.platform === "win32" ? resolveGitBash() : undefined,
  });
  const result = await tool.execute("ok", {
    command: "printf sdk-shell-ok",
    timeout: 10,
  });
  expect(JSON.stringify(result.content)).toContain("sdk-shell-ok");
  await expect(
    tool.execute("timeout", { command: "sleep 5", timeout: 0.05 }),
  ).rejects.toThrow();
  const controller = new AbortController();
  const pending = tool.execute(
    "abort",
    { command: "sleep 5", timeout: 10 },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toThrow();
}, 15_000);
test.skipIf(process.platform !== "win32")(
  "SDK PowerShell factory runs PowerShell with timeout/cancel",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pig-sdk-ps-"));
    directories.push(cwd);
    const tool = createPowerShellTool(cwd);
    expect(tool.name).toBe("powershell");
    expect(tool.description).toContain("PowerShell");
    expect(
      JSON.stringify(
        (
          await tool.execute("ps", {
            command: "Write-Output sdk-ps-ok",
            timeout: 10,
          })
        ).content,
      ),
    ).toContain("sdk-ps-ok");
    await expect(
      tool.execute("timeout", {
        command: "Start-Sleep -Seconds 5",
        timeout: 0.05,
      }),
    ).rejects.toThrow();
    const controller = new AbortController();
    const pending = tool.execute(
      "abort",
      { command: "Start-Sleep -Seconds 5", timeout: 10 },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
  },
  15_000,
);
test("queued image policy normalizes once and preserves blocked/decode hint fallback", async () => {
  const bytes = Buffer.alloc(58);
  bytes.write("BM");
  bytes.writeUInt32LE(58, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(1, 18);
  bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(4, 34);
  const image = {
    type: "image" as const,
    mimeType: "image/bmp",
    data: bytes.toString("base64"),
  };
  const options = {
    queued: true,
    blockImages: false,
    provider: "fixture",
    modelId: "image",
  };
  const prepared = await preparePromptImages([image], options, {
    maxWidth: 1,
    maxHeight: 1,
  });
  expect(prepared.images).toHaveLength(1);
  expect(
    (await preparePromptImages([image], { ...options, queued: false }))
      .images[0],
  ).toBe(image);
  expect(
    await preparePromptImages([image], { ...options, blockImages: true }),
  ).toEqual({ images: [], hints: [blockedImageNote] });
  expect(
    (await preparePromptImages([{ ...image, data: "broken" }], options)).hints,
  ).toEqual([decodeImageNote]);
  expect(
    JSON.stringify(
      scrubImages({ history: [{ custom: { content: [image] } }] }),
    ),
  ).not.toContain('"type":"image"');
}, 15_000);
