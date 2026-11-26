// Invoked only by remote-smoke in its disposable profile, across process exits.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

if (
  !process.env.PIG_TAURI_PAIRING_DIR ||
  !process.env.PIG_DESKTOP_CONFIG_DIR ||
  process.env.PIG_TAURI_PAIRING_DIR !==
    join(process.env.PIG_DESKTOP_CONFIG_DIR, "policy-probe")
)
  throw Error("expected isolated fixture");
const {
  setPairingAllowed,
  createPairingInvite,
  pairingStatus,
  cancelPairingInvite,
  initPairing,
} = await import("../src/bun/pairing");
switch (process.argv[2]) {
  case "issue": {
    await setPairingAllowed(true);
    const [a, b] = await Promise.all([
      createPairingInvite(),
      createPairingInvite(),
    ]);
    assert.ok(a.code);
    assert.equal(a.code, b.code);
    break;
  }
  case "cancel": {
    const invite = (await pairingStatus()).invite;
    assert.equal(invite?.code, "");
    assert.ok(invite.expires > Date.now());
    await cancelPairingInvite();
    assert.equal((await pairingStatus()).invite, undefined);
    // Exercise a real native request deadline without sending a prompt to the SDK.
    const expired = Promise.withResolvers<void>();
    initPairing(async (_peer, _q, check, signal) => {
      check();
      await new Promise<void>((done) =>
        signal.addEventListener("abort", () => done(), { once: true }),
      );
      expired.resolve();
      signal.throwIfAborted();
    });
    const dir = process.env.PIG_TAURI_PAIRING_DIR;
    try {
      let addr = "";
      for (let i = 0; i < 200 && !addr; i++) {
        addr = (
          await readFile(join(dir, "loopback"), "utf8").catch(() => "")
        ).trim();
        if (!addr) await Bun.sleep(50);
      }
      assert.match(addr, /^127\.0\.0\.1:\d+$/);
      const env = { ...process.env, PIG_REMOTE_TEST_ADDR: addr };
      const exe = process.env.PIG_REMOTE_BIN;
      assert.ok(exe);
      const client = join(process.env.PIG_DESKTOP_CONFIG_DIR, "probe-client");
      await mkdir(client, { recursive: true });
      const cli = (op: string, input = "") =>
        Bun.spawn([exe, op, client], {
          env,
          stdin: new Blob([input]),
          stdout: "ignore",
          stderr: "inherit",
          timeout: 50000,
        }).exited;
      assert.equal(await cli("init"), 0);
      assert.equal(await cli("pair", (await createPairingInvite()).code), 0);
      assert.notEqual(await cli("call", '{"op":"read"}'), 0);
      await Promise.race([
        expired.promise,
        Bun.sleep(2000).then(() => {
          throw Error("Bun did not observe request deadline");
        }),
      ]);
      assert.equal(await cli("call", '{"op":"ping"}'), 0);
    } finally {
      await setPairingAllowed(false);
    }
    await setPairingAllowed(true);
    await Promise.all([createPairingInvite(), setPairingAllowed(false)]);
    assert.equal((await pairingStatus()).invite, undefined);
    break;
  }
  case "off": {
    assert.equal((await pairingStatus()).allow, false);
    await assert.rejects(createPairingInvite());
    break;
  }
  default:
    throw Error("unknown phase");
}
