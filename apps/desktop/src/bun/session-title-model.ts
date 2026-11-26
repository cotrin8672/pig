import {
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { modelKey } from "../shared/models";
import type { DefaultModel } from "../shared/rpc-schema";
import { validateSettingsModel } from "./default-model";
import { generalCwd } from "./desktop-config";
import { agentDir } from "./runtime-profile";

const namespace = "archimedes.sessionName";

function readObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new Error("Expected a JSON object");
}

function parseConfig(raw: string, file: string) {
  try {
    // Archimedes reads strict JSON. Don't discard comments or replace malformed settings.
    const settings = readObject(JSON.parse(raw.replace(/^\uFEFF/, "")));
    const section = settings[namespace];
    return {
      settings,
      config: section === undefined ? {} : readObject(section),
    };
  } catch (error) {
    throw new Error(
      `Cannot use ${file}: check the JSON and "${namespace}" object.`,
      { cause: error },
    );
  }
}

export async function readSessionTitleModel(directory = agentDir) {
  const file = join(directory, "settings.json");
  const raw = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (raw === undefined) return null;
  const { config } = parseConfig(raw, file);
  return typeof config.model === "string" ? config.model.trim() || null : null;
}

export async function writeSessionTitleModel(
  model: DefaultModel,
  enabledModels: readonly Exclude<DefaultModel, null>[],
  directory = agentDir,
) {
  validateSettingsModel(model, enabledModels);
  const reference = model ? modelKey(model) : null;
  const file = join(directory, "settings.json");
  // shortcut: SDK 1.5.2's settings lock is private; recheck on SDK upgrades.
  const { FileSettingsStorage } = (await import(
    new URL(
      "./core/settings-manager.js",
      import.meta.resolve("@earendil-works/pi-coding-agent"),
    ).href
  )) as {
    FileSettingsStorage: new (
      cwd: string,
      dir: string,
    ) => {
      withLock(
        scope: "global",
        fn: (raw: string | undefined) => undefined,
      ): void;
    };
  };
  new FileSettingsStorage(generalCwd, directory).withLock("global", (raw) => {
    if (raw === undefined) {
      if (reference !== null)
        throw new Error("Install the session-name extension first.");
      return undefined;
    }
    const { settings, config } = parseConfig(raw, file);
    if (reference === null) {
      if (!Object.hasOwn(config, "model")) return undefined;
      delete config.model;
    } else {
      if (reference === config.model) return undefined;
      config.model = reference;
    }
    if (Object.keys(config).length) settings[namespace] = config;
    else delete settings[namespace];

    // Replace the link's destination atomically while holding the same lock as Pi.
    const target = realpathSync(file);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      // An external editor may not take Pi's lock.
      if (realpathSync(file) !== target || readFileSync(file, "utf8") !== raw)
        throw new Error(`${file} changed on disk; reload and retry.`);
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
    return undefined;
  });
  return reference;
}
