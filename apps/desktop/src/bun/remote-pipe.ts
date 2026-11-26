import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

/**
 * Only the native transport owns the network. EOF on parent exit stops its endpoint.
 * Returns a function that stops listening.
 */
export function startRemotePipe(
  exe: string,
  dir: string,
  dispatch: (
    peer: string,
    q: unknown,
    check: () => void,
    signal: AbortSignal,
  ) => Promise<unknown>,
  ready: () => void,
  exited: () => void,
) {
  const child = Bun.spawn([exe, "serve", dir], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    windowsHide: true,
  });
  let db: Database | undefined;
  const active = new Map<number, AbortController>();
  const lines = createInterface({
    input: Readable.from(child.stdout as AsyncIterable<Uint8Array>),
    crlfDelay: Infinity,
  });
  lines.on("line", (line) => {
    void (async () => {
      const [seq, host, peer, request, deadline] = JSON.parse(line);
      if (seq === "cancel") {
        active.get(host)?.abort();
        return;
      }
      if (seq === "ready") {
        if (!stopped) ready();
        return;
      }
      const controller = new AbortController();
      const check = () => {
        controller.signal.throwIfAborted();
        if (!Number.isSafeInteger(deadline) || Date.now() >= deadline)
          throw new Error("Request expired");
        if (stopped) throw new Error("Remote listener stopped");
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
      if (active.size >= 8) reply = { ok: false, error: "busy" };
      else {
        active.set(seq, controller);
        const timer = setTimeout(
          () => controller.abort(),
          Math.max(0, deadline - Date.now()),
        );
        try {
          const value = await dispatch(peer, request, check, controller.signal);
          check();
          reply = { ok: true, value };
        } catch {
          reply = {
            ok: false,
            error:
              "Unavailable, stale or invalid operation; check receipt before retrying a send",
          };
        } finally {
          clearTimeout(timer);
          active.delete(seq);
        }
      }
      child.stdin.write(`${JSON.stringify([seq, reply])}\n`);
      await child.stdin.flush();
    })().catch(() => console.error("Remote transport pipe failed"));
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const c of active.values()) c.abort();
    child.kill();
  };
  process.once("exit", stop);
  void child.exited.then((code) => {
    process.off("exit", stop);
    db?.close();
    if (!stopped) {
      stopped = true;
      for (const c of active.values()) c.abort();
      console.error("Remote transport stopped", code);
      exited();
    }
  });
  return async () => {
    stop();
    await child.exited;
  };
}
