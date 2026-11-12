import { constants } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type {
  PiDataAuthSource,
  PiDataImportResult,
  PiDataReport,
  PiDataState,
} from "../shared/pi-data";
import { desktopConfigDir } from "./desktop-config";
import { withFileLock } from "./file-lock";
import { modelsJsonPath } from "./model-settings";
import {
  agentDir,
  agentDirSource,
  expandHome,
  legacyAgentDir,
} from "./runtime-profile";
import { SettingsManager } from "./sdk";

/* Read-only inventory of where Pi data is resolved from, and what the old
 * private pig profile still holds. Never prints secrets or transcript text.
 * Imports are explicit, copy-only, and never overwrite existing data.
 */

const authPath = () => join(agentDir, "auth.json");
/** v0.2/v0.3 profile first, then the pre-0.2 FileCredentials store. */
const legacyAuthFiles = () => [
  join(legacyAgentDir, "auth.json"),
  join(desktopConfigDir, "auth.json"),
];
const samePath = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

type Read<T> = { state: PiDataState; value?: T; error?: string };
async function readBytes(file: string): Promise<Read<Buffer>> {
  try {
    return { state: "ok", value: await readFile(file) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "missing" };
    return { state: "unreadable", error: code ?? String(error) };
  }
}
type Credentials = Record<string, { type: string } & Record<string, unknown>>;
function parseCredentials(bytes: Buffer): Credentials | undefined {
  try {
    const value: unknown = JSON.parse(
      bytes.toString("utf8").replace(/^\uFEFF/, ""),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const credential of Object.values(value))
      if (
        !credential ||
        typeof credential !== "object" ||
        !["api_key", "oauth"].includes(
          String((credential as { type?: unknown }).type),
        )
      )
        return;
    return value as Credentials;
  } catch {
    return undefined;
  }
}
async function readCredentials(file: string): Promise<Read<Credentials>> {
  const raw = await readBytes(file);
  if (raw.state !== "ok" || !raw.value) return { ...raw, value: undefined };
  const value = parseCredentials(raw.value);
  return value ? { state: "ok", value } : { state: "invalid" };
}

function sessionDirSetting(): {
  dir?: string;
  source: PiDataReport["sessionDirSource"];
} {
  const env = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (env) return { dir: expandHome(env), source: "env" };
  // Global only: per-project settings can still redirect individual projects.
  const dir = SettingsManager.create(homedir(), agentDir, {
    projectTrusted: false,
  }).getSessionDir();
  return dir ? { dir, source: "settings" } : { source: "default" };
}

type SessionPlan = {
  from: string;
  to: string;
  status: "missing" | "same" | "conflict";
};
async function sessionFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    // Never follow links out of the profile.
    if (entry.isDirectory()) out.push(...(await sessionFiles(path, depth + 1)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}
async function validHeader(file: string) {
  const text = (await readFile(file, "utf8")).slice(0, 1 << 20);
  const first = text.split("\n", 1)[0] ?? "";
  try {
    const header = JSON.parse(first);
    return (
      header?.type === "session" &&
      typeof header.id === "string" &&
      typeof header.cwd === "string"
    );
  } catch {
    return false;
  }
}
async function planSessions(): Promise<
  Read<SessionPlan[]> & { invalid: number }
> {
  const legacy = join(legacyAgentDir, "sessions");
  try {
    await stat(legacy);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { state: "missing", invalid: 0 }
      : { state: "unreadable", error: code, invalid: 0 };
  }
  const { dir } = sessionDirSetting();
  const plans: SessionPlan[] = [];
  let invalid = 0;
  try {
    for (const from of await sessionFiles(legacy)) {
      if (!(await validHeader(from))) {
        invalid++;
        continue;
      }
      // Default layout groups by encoded cwd exactly like the SDK; a custom
      // session dir is flat, as SessionManager.create writes it.
      const to = dir
        ? join(dir, from.slice(dirname(from).length + 1))
        : join(agentDir, "sessions", relative(legacy, from));
      const existing = await readBytes(to);
      plans.push({
        from,
        to,
        status:
          existing.state === "missing"
            ? "missing"
            : existing.value?.equals(await readFile(from))
              ? "same"
              : "conflict",
      });
    }
  } catch (error) {
    return {
      state: "unreadable",
      error: (error as NodeJS.ErrnoException).code ?? String(error),
      invalid,
    };
  }
  return { state: "ok", value: plans, invalid };
}

export async function piDataReport(): Promise<PiDataReport> {
  const session = sessionDirSetting();
  const standard = await readCredentials(authPath());
  const separate = !samePath(agentDir, legacyAgentDir);
  const auth: PiDataAuthSource[] = [];
  if (separate)
    for (const file of legacyAuthFiles()) {
      const legacy = await readCredentials(file);
      const source: PiDataAuthSource = {
        file,
        state: legacy.state,
        error: legacy.error,
        missing: [],
        same: [],
        conflict: [],
      };
      for (const [id, credential] of Object.entries(legacy.value ?? {})) {
        const current = standard.value?.[id];
        if (!current) source.missing.push(id);
        else if (JSON.stringify(current) === JSON.stringify(credential))
          source.same.push(id);
        else source.conflict.push(id);
      }
      if (legacy.state !== "missing") auth.push(source);
    }
  const sessions = separate ? await planSessions() : undefined;
  const count = (status: SessionPlan["status"]) =>
    sessions?.value?.filter((plan) => plan.status === status).length ?? 0;
  const exists = async (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );
  return {
    agentDir,
    agentDirSource,
    authFile: authPath(),
    authState: standard.state,
    modelsFile: modelsJsonPath(),
    sessionDir: session.dir ?? join(agentDir, "sessions"),
    sessionDirSource: session.source,
    legacyDir: separate ? legacyAgentDir : undefined,
    legacyAuth: auth,
    legacySessions: sessions && {
      state: sessions.state,
      error: sessions.error,
      missing: count("missing"),
      same: count("same"),
      conflict: count("conflict"),
      invalid: sessions.invalid,
    },
    legacyModels:
      separate && (await exists(join(legacyAgentDir, "models.json"))),
    legacyDurable: await exists(join(desktopConfigDir, "durable")),
  };
}

/** Adds only providers absent from the standard store, under Pi's auth lock. */
export async function importLegacyAuth(
  file: string,
  providers: readonly string[],
): Promise<PiDataImportResult> {
  if (!legacyAuthFiles().some((known) => samePath(known, file)))
    throw new Error("Unknown legacy credential file");
  const legacy = await readCredentials(file);
  if (legacy.state !== "ok" || !legacy.value)
    throw new Error(`Legacy credentials are ${legacy.state}`);
  const target = authPath();
  return withFileLock(target, undefined, async () => {
    const current = await readCredentials(target);
    if (current.state === "unreadable" || current.state === "invalid")
      throw new Error(`${target} is ${current.state}; nothing was changed`);
    const next = { ...(current.value ?? {}) };
    const result: PiDataImportResult = { copied: 0, skipped: 0 };
    for (const id of providers) {
      const credential = legacy.value?.[id];
      if (!credential || next[id]) {
        result.skipped++;
        continue;
      }
      next[id] = credential;
      result.copied++;
    }
    if (!result.copied) return result;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, target);
    return result;
  });
}

/** Copies sessions that do not exist yet; conflicts keep both originals. */
export async function importLegacySessions(): Promise<PiDataImportResult> {
  const plans = await planSessions();
  if (plans.state !== "ok" || !plans.value)
    throw new Error(`Legacy sessions are ${plans.state}`);
  const result: PiDataImportResult = { copied: 0, skipped: 0 };
  for (const plan of plans.value) {
    if (plan.status !== "missing") {
      result.skipped++;
      continue;
    }
    await mkdir(dirname(plan.to), { recursive: true });
    const temporary = `${plan.to}.${crypto.randomUUID()}.tmp`;
    await copyFile(plan.from, temporary, constants.COPYFILE_EXCL);
    try {
      // link() refuses to replace a file created meanwhile (rename would not).
      await link(temporary, plan.to);
      result.copied++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      result.skipped++;
    } finally {
      await unlink(temporary);
    }
  }
  return result;
}
