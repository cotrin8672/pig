// Default: debug transport on loopback. --release boots the portable Tauri app.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tauriSmokeProfile } from "./tauri-smoke-profile";

const release = process.argv.includes("--release");
const publicRelay = release || process.argv.includes("--public");
const fixture = await tauriSmokeProfile();
const base = fixture.env.PIG_DESKTOP_CONFIG_DIR;
const host = join(base, "pairing");
const client = join(fixture.env.HOME, "laptop");
const portable = release
  ? resolve(import.meta.dir, "../build/tauri-portable")
  : process.argv.includes("--portable")
    ? resolve(import.meta.dir, "../build/tauri-portable-smoke")
    : undefined;
const exe = portable
  ? join(portable, "pig-remote.exe")
  : resolve(import.meta.dir, "../src-tauri/target/debug/pig-remote.exe");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env))
  if (v && !/API_KEY|TOKEN|SECRET|PASSWORD|PI_|PIG_|PROXY/i.test(k)) env[k] = v;
Object.assign(env, fixture.env, {
  PIG_REMOTE_ENABLED: "1",
  PIG_REMOTE_LOOPBACK: publicRelay ? "" : "1",
  PI_CODING_AGENT_SESSION_DIR: join(base, "sessions"),
});
if (!release) env.PIG_REMOTE_BIN = exe;
const cli = async (
  op: string,
  dir: string,
  input = "",
  arg?: string,
  success = true,
) => {
  const p = Bun.spawn([exe, op, dir, ...(arg ? [arg] : [])], {
    env,
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  });
  const out = await new Response(p.stdout).text();
  assert.equal(
    (await p.exited) === 0,
    success,
    `${op} failed: ${await new Response(p.stderr).text()}`,
  );
  if (!success)
    assert.equal(JSON.parse(out).ok, false, `${op} was not refused`);
  return out.trim();
};
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  await cli("init", host);
  const peer = await cli("init", client);
  const sessions = env.PI_CODING_AGENT_SESSION_DIR;
  await mkdir(sessions, { recursive: true });
  const cwd = join(base, "general"),
    timestamp = new Date().toISOString();
  await Bun.write(
    join(sessions, "fixture.jsonl"),
    [
      { type: "session", version: 3, id: "fixture", cwd, timestamp },
      {
        type: "message",
        id: "first",
        parentId: null,
        timestamp,
        message: { role: "user", content: "fixture history", timestamp: 1 },
      },
    ]
      .map((v) => JSON.stringify(v))
      .concat("")
      .join("\n"),
  );
  await Bun.write(
    join(fixture.env.PI_CODING_AGENT_DIR, "settings.json"),
    JSON.stringify({
      defaultProvider: "pig-smoke",
      defaultModel: "pig-smoke-model",
    }),
  );
  child = Bun.spawn(
    release && portable
      ? [join(portable, "pig.exe")]
      : [
          portable ? join(portable, "host/bin/bun.exe") : process.execPath,
          "--no-env-file",
          portable
            ? join(portable, "host/app/bun/tauri-host.js")
            : resolve(import.meta.dir, "../src/bun/tauri-host.ts"),
        ],
    {
      env,
      cwd: portable && !release ? join(portable, "host/app") : fixture.env.HOME,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  void new Response(child.stdout as ReadableStream<Uint8Array>).arrayBuffer();
  const addr = join(host, "loopback");
  for (
    let i = 0;
    !publicRelay && i < 450 && !(await Bun.file(addr).exists());
    i++
  ) {
    if (child.exitCode !== null)
      throw new Error(`Bun host exited ${child.exitCode}`);
    await Bun.sleep(100);
  }
  if (!publicRelay)
    env.PIG_REMOTE_TEST_ADDR = (await Bun.file(addr).text()).trim();
  else await Bun.sleep(15000); // Allow initial relay registration and address publication.
  const invite = await cli("invite", host);
  await cli("pair", client, invite);
  await cli("pair", client, invite, undefined, false);
  const call = async (q: unknown, ok = true) =>
    JSON.parse(await cli("call", client, JSON.stringify(q), undefined, ok))
      .value;
  const { chats } = await call({ op: "list" });
  const { view, messages } = await call({ op: "open", chat: chats[0].chat });
  assert.equal(messages[0].text, "fixture history");
  await call({ op: "send", view, id: "no", text: "/reload" }, false);
  const send = { op: "send", view, id: "one", text: "hello mock" };
  await call(send);
  await call(send);
  assert.equal(
    (await call({ op: "receipt", view, id: "one" })).state,
    "accepted",
  );
  let found = false;
  let last: unknown;
  for (let i = 0; i < 60 && !found; i++) {
    const result = await call({ op: "read", view });
    last = result;
    found = result.messages.some(
      (m: { text: string }) => m.text === "Windows Tauri smoke reply",
    );
    if (!found) await Bun.sleep(200);
  }
  assert.ok(
    found,
    `fixture calls=${fixture.requests()} last=${JSON.stringify(last).slice(0, 1000)}`,
  );
  assert.equal(fixture.requests(), 1);
  await cli("revoke", host, "", peer);
  await call({ op: "read", view }, false);
  console.log(
    "PASS: paired, opened persisted chat, denied command, submitted twice / model ran once, read reply, revoked",
  );
} finally {
  if (child) {
    child.kill();
    await child.exited;
  }
  await fixture.dispose();
}
