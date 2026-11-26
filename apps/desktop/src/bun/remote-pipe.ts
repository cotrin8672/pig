import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

/** Only the native transport owns the network. EOF on parent exit stops its endpoint. */
export function startRemotePipe(
  exe: string,
  dir: string,
  dispatch: (peer: string, q: unknown, check: () => void) => Promise<unknown>,
) {
  const child = Bun.spawn([exe, "serve", dir], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    windowsHide: true,
  });
  let db: Database | undefined;
  let active = 0;
  const lines = createInterface({
    input: Readable.from(child.stdout as AsyncIterable<Uint8Array>),
    crlfDelay: Infinity,
  });
  lines.on("line", (line) => {
    void (async () => {
      const [seq, host, peer, request] = JSON.parse(line);
      const check = () => {
        if (!/^[a-f0-9]{64}$/.test(host) || !/^[a-f0-9]{64}$/.test(peer))
          throw new Error("invalid key");
        db ??= new Database(join(dir, "paired.sqlite"), { readonly: true });
        if (
          !db
            .query("SELECT 1 FROM device WHERE host=? AND peer=?")
            .get(Buffer.from(host, "hex"), Buffer.from(peer, "hex"))
        )
          throw new Error("revoked");
      };
      let reply: { ok: true; value: unknown } | { ok: false; error: string };
      if (active >= 8) reply = { ok: false, error: "busy" };
      else {
        active++;
        try {
          const value = await dispatch(peer, request, check);
          check();
          reply = { ok: true, value };
        } catch {
          reply = {
            ok: false,
            error:
              "Unavailable, stale or invalid operation; check receipt before retrying a send",
          };
        } finally {
          active--;
        }
      }
      child.stdin.write(`${JSON.stringify([seq, reply])}\n`);
      await child.stdin.flush();
    })().catch(() => console.error("Remote transport pipe failed"));
  });
  const stop = () => child.kill();
  process.once("exit", stop);
  void child.exited.then((code) => {
    process.off("exit", stop);
    db?.close();
    if (code) console.error("Remote transport stopped", code);
  });
}
