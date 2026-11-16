import { expect, test } from "bun:test";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import "./bun-package-manager";

type Internals = {
  getNpmCommand(): { command: string; args: string[] };
  getLatestNpmVersion(spec: string): Promise<string>;
  spawnCaptureCommand(command: string, args: string[]): never;
};

function manager(npmCommand?: string[]) {
  const pm = new DefaultPackageManager({
    cwd: import.meta.dir,
    agentDir: import.meta.dir,
    settingsManager: SettingsManager.inMemory({ npmCommand }),
  });
  // SAFETY: Internals lists private SDK 1.5.2 members; the patch module throws at import if they are missing.
  return pm as unknown as Internals;
}

// Records the spawned args and stops before any network access.
async function versionArgs(pm: Internals) {
  let seen: string[] = [];
  pm.spawnCaptureCommand = (_command, args) => {
    seen = args;
    throw new Error("stop");
  };
  await expect(pm.getLatestNpmVersion("x")).rejects.toThrow("stop");
  return seen;
}

test("packages default to the running Bun runtime", () => {
  expect(manager().getNpmCommand()).toEqual({
    command: process.execPath,
    args: [],
  });
});

test("a configured npmCommand is kept", () => {
  expect(manager(["pnpm"]).getNpmCommand()).toEqual({
    command: "pnpm",
    args: [],
  });
});

test("bun update checks use info instead of view", async () => {
  expect(await versionArgs(manager())).toEqual([
    "info",
    "x",
    "version",
    "--json",
  ]);
  expect(await versionArgs(manager(["npm"]))).toEqual([
    "view",
    "x",
    "version",
    "--json",
  ]);
});
