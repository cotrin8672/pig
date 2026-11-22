import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "win32")(
  "Tauri Bun host accepts page epochs and answers bootstrap over private pipes",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "pig-bun-wire-"));
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        join(import.meta.dir, "tauri-host.ts"),
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PIG_DESKTOP_CONFIG_DIR: join(home, "config"),
          PI_CODING_AGENT_DIR: join(home, "agent"),
          PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"),
          PI_OFFLINE: "1",
        },
        timeout: 12_000,
      },
    );
    try {
      const writer = (packet: unknown[]) => {
        child.stdin.write(`${JSON.stringify(packet)}\n`);
        child.stdin.flush();
      };
      let id = "";
      let publication = false;
      let reply: unknown;
      const reader = child.stdout
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buf = "";
      while (!reply) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        let end = buf.indexOf("\n");
        while (end !== -1) {
          const line = buf.slice(0, end);
          buf = buf.slice(end + 1);
          end = buf.indexOf("\n");
          if (!line.startsWith("\x1e")) continue;
          const frame = JSON.parse(line.slice(1));
          if (frame[0] === "create") {
            id = frame[1];
            writer([
              "attach",
              id,
              1,
              { handle: 1, maximized: false, minimized: false, focused: true },
            ]);
            writer(["packet", id, 0, ["request", 20, "bootstrap"]]);
            writer(["packet", id, 1, ["request", 21, "bootstrap"]]);
          } else if (frame[0] === "native") {
            writer(["nativeResult", frame[1], true, null]);
          } else if (frame[0] === "packet" && frame[1] === id) {
            expect(frame[2]).toBe(1);
            const packet = frame[3];
            if (packet[0] === "message" && packet[1] === "windowState")
              publication = packet[2].maximized === false;
            else if (packet[0] === "reply") {
              expect(packet.slice(0, 3)).toEqual(["reply", 21, true]);
              reply = packet[3];
            }
          }
        }
      }
      expect(publication).toBe(true);
      expect(reply).toMatchObject({
        generalCwd: join(home, "config", "general"),
      });
    } finally {
      child.kill();
      await child.exited;
      await rm(home, {
        force: true,
        recursive: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
  15_000,
);
