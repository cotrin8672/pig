import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  PairingConnect,
  PairingConnectError,
  PairingDevice,
  PairingHost,
  PairingInvite,
  PairingStatus,
} from "../shared/pairing";
import type { RemoteProject, RemoteQuery } from "../shared/remote-workspace";
import { desktopConfigDir } from "./desktop-config";
import { startRemotePipe } from "./remote-pipe";

/**
 * Pairing page backend. The native `pig-remote` owns keys, invites and the
 * network; this module only runs it and reads its device list. Nothing here
 * creates a key or listens until the user enables or uses Pairing.
 */
const exe = process.env.PIG_REMOTE_BIN;
const dir =
  process.env.PIG_TAURI_PAIRING_DIR ?? join(desktopConfigDir, "pairing");
/** One client identity per host: `pig-remote` pins a single trusted host per directory. */
const hostsDir = join(dir, "hosts");
const enabledFile = join(dir, "enabled");
const disabledFile = join(dir, "disabled");
const KEY = /^[0-9a-f]{64}$/;
const INVITE = /^pig-pair:1:([0-9a-f]{64}):[0-9a-f]{64}$/;
const INVITE_MS = 12 * 60 * 60 * 1000;
const RECHECK_MS = 60_000;

type Dispatch = (
  peer: string,
  request: unknown,
  check: () => void,
  signal: AbortSignal,
) => Promise<unknown>;
let dispatch: Dispatch | undefined;
let stopPipe: (() => Promise<void>) | undefined;
let hostKey: string | undefined;
let changes: Promise<unknown> = Promise.resolve();
function change<T>(action: () => Promise<T>) {
  const result = changes.then(action);
  changes = result.catch(() => {});
  return result;
}
let listener: PairingStatus["listener"];
let generation = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
const seen = new Map<string, number>();
let invite:
  | { code: string; expires: number; digest: Buffer; host: Buffer }
  | undefined;
let connect: PairingConnect | undefined;
let connectId = 0;
const reach = new Map<string, { online?: boolean; checked: number }>();

const available = () => !!exe && existsSync(exe);
let allow =
  !existsSync(disabledFile) &&
  (process.env.PIG_REMOTE_ENABLED === "1" || existsSync(enabledFile));

async function run(
  args: string[],
  input?: string,
  onError?: (line: string) => void,
) {
  if (!exe || !available()) throw new Error("Pairing is not available.");
  const child = Bun.spawn([exe, ...args], {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const errors = (async () => {
    let text = "";
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) {
      const lines = (text + decoder.decode(chunk)).split("\n");
      text = lines.pop() ?? "";
      for (const line of lines) onError?.(line.trim());
      // Keep only the tail for the error message.
      text = text.slice(-2000);
    }
    return text;
  })();
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    errors,
    child.exited,
  ]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}
async function must(args: string[], input?: string) {
  const result = await run(args, input);
  if (!result.ok)
    throw new Error(`pig-remote ${args[0]} failed: ${result.err.slice(-300)}`);
  return result.out;
}
/** Public key of the identity in `profile`, creating it only when none exists. */
async function identity(profile: string) {
  await mkdir(profile, { recursive: true });
  const id = await run(["id", profile]);
  if (id.ok) return id.out;
  // `init` never replaces an existing (even damaged) key, so this cannot clobber one.
  return must(["init", profile]);
}

async function startListening() {
  if (
    stopPipe ||
    listener === "starting" ||
    !exe ||
    !available() ||
    !dispatch ||
    !allow
  )
    return;
  clearTimeout(retry);
  const gen = ++generation;
  listener = "starting";
  const failed = () => {
    if (gen !== generation || !allow) return;
    stopPipe = undefined;
    listener = "failed";
    retry = setTimeout(() => void startListening(), 5000);
    retry.unref();
  };
  try {
    hostKey = await must(["id", dir]); // Never enroll or replace a missing key on startup.
    if (!allow || gen !== generation) return;
    const forward = dispatch;
    stopPipe = startRemotePipe(
      exe,
      dir,
      (peer, request, check, signal) => {
        seen.set(peer, Date.now());
        return forward(peer, request, check, signal);
      },
      () => {
        if (gen === generation) listener = "ready";
      },
      failed,
    );
  } catch {
    failed();
  }
}

/** Called once by the app with the remote chat handler. */
export function initPairing(handler: Dispatch) {
  dispatch = handler;
  void startListening().catch((error) =>
    console.error("Remote Pairing did not start:", error),
  );
}

function readDb<T>(read: (db: Database) => T, fallback: T): T {
  const file = join(dir, "paired.sqlite");
  if (!existsSync(file)) return fallback;
  const db = new Database(file, { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
function devices(): PairingDevice[] {
  return readDb(
    (db) =>
      (
        db
          .query("SELECT * FROM device WHERE host=?")
          .all(Buffer.from(hostKey ?? "", "hex")) as {
          peer: Uint8Array;
          name?: string;
          added?: number;
        }[]
      ).map((row) => {
        const id = Buffer.from(row.peer).toString("hex");
        return {
          id,
          name: row.name || `PC ${id.slice(0, 8)}`,
          added: (row.added ?? 0) * 1000,
          lastSeen: seen.get(id),
        };
      }),
    [],
  );
}
function currentInvite(): PairingInvite | undefined {
  if (!hostKey) return;
  const host = Buffer.from(hostKey, "hex");
  return readDb((db) => {
    const row = db
      .query(
        "SELECT digest, expires FROM invite WHERE host=? AND expires>unixepoch()",
      )
      .get(host) as { digest: Uint8Array; expires: number } | null;
    if (row)
      return {
        code: invite?.digest.equals(row.digest) ? invite.code : "",
        expires: row.expires * 1000,
      };
    if (!invite || Date.now() > invite.expires) return;
    const { digest, expires } = invite;
    const device = db
      .query(
        "SELECT name, hex(peer) AS peer FROM device WHERE host=? AND redeemed=?",
      )
      .get(host, digest) as { name: string; peer: string } | null;
    return device
      ? {
          code: "",
          expires,
          pairedWith: device.name || `PC ${device.peer.slice(0, 8)}`,
        }
      : undefined;
  }, undefined);
}

async function checkHost(id: string) {
  const entry = reach.get(id) ?? { checked: 0 };
  if (Date.now() - entry.checked < RECHECK_MS) return;
  entry.checked = Date.now();
  reach.set(id, entry);
  const result = await run(
    ["call", join(hostsDir, id)],
    JSON.stringify({ op: "ping" }),
  );
  entry.online = result.ok;
  if (result.ok)
    await writeFile(join(hostsDir, id, "last-seen"), "").catch(() => {});
}
export async function hosts(): Promise<PairingHost[]> {
  if (!available()) return [];
  const names = await readdir(hostsDir).catch(() => [] as string[]);
  const list: PairingHost[] = [];
  for (const id of names) {
    if (!KEY.test(id)) continue;
    const profile = join(hostsDir, id);
    if (!existsSync(join(profile, "trusted-host"))) continue;
    const name = (
      await readFile(join(profile, "host-name"), "utf8").catch(() => "")
    ).trim();
    const seenAt = await stat(join(profile, "last-seen")).then(
      (s) => s.mtimeMs,
      () => undefined,
    );
    void checkHost(id).catch(() => {});
    list.push({
      id,
      name: name || `PC ${id.slice(0, 8)}`,
      lastSeen: seenAt,
      online: reach.get(id)?.online,
      projects: await readFile(join(profile, "sidebar.json"), "utf8")
        .then((text) => checkedProjects(JSON.parse(text)))
        .catch((e) => {
          if (e.code !== "ENOENT")
            console.warn("Remote sidebar settings unavailable for", id);
          return [];
        }),
    });
  }
  return list;
}

function checkedProjects(value: unknown): RemoteProject[] {
  if (
    !Array.isArray(value) ||
    value.length > 512 ||
    !value.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        KEY.test(p.id) &&
        typeof p.name === "string" &&
        p.name.length <= 512,
    )
  )
    throw Error("Invalid project selection");
  return value.map(({ id, name }) => ({ id, name }));
}
async function pinned(id: string) {
  if (typeof id !== "string" || !KEY.test(id)) throw Error("Invalid host");
  const path = join(hostsDir, id);
  if ((await readFile(join(path, "trusted-host"), "utf8")).trim() !== id)
    throw Error("Unknown host");
  return path;
}
export async function saveRemoteProjects(
  id: string,
  projects: RemoteProject[],
) {
  const path = join(await pinned(id), "sidebar.json");
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(checkedProjects(projects)));
  await rename(temp, path);
  return true;
}
export async function remoteWorkspace(
  id: string,
  query: RemoteQuery,
): Promise<unknown> {
  if (
    !query ||
    ![
      "projects",
      "folders",
      "addFolder",
      "list",
      "open",
      "new",
      "read",
      "history",
      "send",
      "receipt",
    ].includes(query.op)
  )
    throw Error("Invalid operation");
  const path = await pinned(id);
  const text = JSON.stringify(query);
  if (Buffer.byteLength(text) > 65536) throw Error("Request too large");
  const result = await run(["call", path], text);
  if (!result.ok) throw Error("接続先のPCで操作を確認できませんでした。");
  const reply = JSON.parse(result.out);
  if (reply.ok !== true) throw Error("接続先のPCが操作を拒否しました。");
  return reply.value;
}

export async function pairingStatus(): Promise<PairingStatus> {
  if (!available())
    return { available: false, allow: false, devices: [], hosts: [] };
  if (!hostKey && existsSync(join(dir, "pairing-identity.dpapi")))
    hostKey = await must(["id", dir]);
  const list = devices();
  return {
    available: true,
    allow,
    listener,
    devices: list,
    hosts: await hosts(),
    invite: currentInvite(),
    connect,
  };
}

export function setPairingAllowed(next: boolean) {
  return change(async () => {
    if (next) {
      hostKey = await identity(dir);
      if (existsSync(disabledFile) && existsSync(join(dir, "paired.sqlite")))
        await cancelInvite();
      await writeFile(enabledFile, "");
      await rm(disabledFile, { force: true });
      allow = true;
      await startListening();
      return;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(disabledFile, "");
    allow = false;
    generation++;
    clearTimeout(retry);
    listener = undefined;
    await stopPipe?.();
    stopPipe = undefined;
    await rm(enabledFile, { force: true });
    if (existsSync(join(dir, "paired.sqlite"))) await cancelInvite();
  });
}

/** Reuses the open invite; a new one replaces any previous invite. */
export function createPairingInvite(): Promise<PairingInvite> {
  return change(async () => {
    if (!allow) throw new Error("Allow connections from other PCs first.");
    const open = currentInvite();
    if (open?.code) return open;
    await identity(dir);
    await startListening();
    const code = await must(["invite", dir]);
    const [, , host, token] = code.split(":");
    invite = {
      code,
      expires: Date.now() + INVITE_MS,
      host: Buffer.from(host, "hex"),
      digest: createHash("sha256").update(Buffer.from(token, "hex")).digest(),
    };
    return { code, expires: invite.expires };
  });
}

async function cancelInvite() {
  await must(["cancel", dir]);
  invite = undefined;
}
export function cancelPairingInvite() {
  return change(cancelInvite);
}

export async function revokePairingDevice(id: string) {
  if (!KEY.test(id)) throw new Error("Invalid device.");
  await must(["revoke", dir, id]);
  seen.delete(id);
}

export async function removePairingHost(id: string) {
  if (!KEY.test(id)) throw new Error("Invalid PC.");
  await rm(join(hostsDir, id), { recursive: true, force: true });
  reach.delete(id);
}

/** Starts pairing with an invite; progress is read through `pairingStatus`. */
export function connectPairing(code: string) {
  if (connect?.state === "connecting") throw new Error("Already connecting.");
  const job: PairingConnect = { id: ++connectId, step: 0, state: "connecting" };
  connect = job;
  const fail = (error: PairingConnectError) => {
    job.state = "error";
    job.error = error;
  };
  void (async () => {
    const host = INVITE.exec(code.trim())?.[1];
    if (!host) return fail("invalid");
    const own = existsSync(join(dir, "pairing-identity.dpapi"))
      ? (await run(["id", dir])).out
      : "";
    if (host === own) return fail("self");
    job.step = 1;
    const profile = join(hostsDir, host);
    try {
      await identity(profile);
    } catch {
      return fail("storage");
    }
    const progress = (line: string) => {
      if (line === "pig-remote: connected") job.step = 2;
      if (line === "pig-remote: registering") job.step = 3;
    };
    const result = await run(["pair", profile], code.trim(), progress);
    if (
      !result.ok &&
      !(await run(["recover", profile, host], undefined, progress)).ok
    ) {
      if (job.step === 3) return fail("storage");
      return fail(
        result.out.includes('"ok":false') ? "rejected" : "unreachable",
      );
    }
    job.step = 3;
    await writeFile(join(profile, "last-seen"), "").catch(() => {});
    reach.set(host, { online: true, checked: Date.now() });
    job.host = (
      await readFile(join(profile, "host-name"), "utf8").catch(() => "")
    ).trim();
    job.step = 4;
    job.hostId = host;
    job.state = "connected";
  })().catch((error) => {
    console.error("Pairing failed:", error);
    fail("unreachable");
  });
  return { id: job.id };
}
