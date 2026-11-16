import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";

// shortcut: patches private SDK 1.5.2 methods; recheck on SDK upgrades.
// Users should not need Node.js: without an explicit npmCommand, pi packages
// are managed by the Bun runtime that already runs this app.
type NpmCommand = { command: string; args: string[] };
type Internals = {
  settingsManager: { getNpmCommand(): string[] | undefined };
  getNpmCommand(): NpmCommand;
  getPackageManagerName(): string;
  runCommandCapture(
    command: string,
    args: string[],
    options: unknown,
  ): Promise<string>;
};

// Fail at startup if an SDK upgrade renames the private members we patch.
function hasInternals(value: unknown): value is Internals {
  const members = new Map(
    Object.entries(Object.getOwnPropertyDescriptors(value)).map(
      ([key, descriptor]) => [key, descriptor.value],
    ),
  );
  return ["getNpmCommand", "getPackageManagerName", "runCommandCapture"].every(
    (key) => typeof members.get(key) === "function",
  );
}
const proto: unknown = DefaultPackageManager.prototype;
if (!hasInternals(proto))
  throw new Error("Unsupported pi SDK: package manager internals changed");
const getNpmCommand = proto.getNpmCommand;
const runCommandCapture = proto.runCommandCapture;

export function bunNpmCommand(
  configured: string[] | undefined,
  fallback: NpmCommand,
  execPath = process.execPath,
  isBun = Boolean(process.versions.bun),
): NpmCommand {
  return configured?.length || !isBun
    ? fallback
    : { command: execPath, args: [] };
}

proto.getNpmCommand = function (this: Internals) {
  return bunNpmCommand(
    this.settingsManager.getNpmCommand(),
    getNpmCommand.call(this),
  );
};

// Bun has no `view`; `bun info <spec> version --json` prints the same JSON.
proto.runCommandCapture = function (this: Internals, command, args, options) {
  const { args: prefix } = this.getNpmCommand();
  const next = [...args];
  if (next[prefix.length] === "view" && this.getPackageManagerName() === "bun")
    next[prefix.length] = "info";
  return runCommandCapture.call(this, command, next, options);
};
