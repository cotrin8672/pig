import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "win32")(
  "Tauri Bun host rejects stale epochs and oversized replies without losing the pipe",
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
      const cwd = join(home, "config", "general");
      const sessions = join(home, "sessions");
      await mkdir(sessions, { recursive: true });
      const timestamp = "2026-01-01T00:00:00Z";
      for (const [id, length] of [
        ["normal", 32],
        ["oversize", 22 * 1024 * 1024],
      ] as const) {
        await Bun.write(
          join(sessions, `${id}.jsonl`),
          [
            { type: "session", version: 3, id, cwd, timestamp },
            {
              type: "message",
              id: "entry",
              parentId: null,
              timestamp,
              message: {
                role: "user",
                content: "あ".repeat(length),
                timestamp: 1,
              },
            },
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n",
        );
      }
      const writer = (packet: unknown[]) => {
        child.stdin.write(`${JSON.stringify(packet)}\n`);
        child.stdin.flush();
      };
      let id = "";
      let publication = false;
      const replies: unknown[][] = [];
      const request = (seq: number, name: string, params?: unknown) =>
        writer(["packet", id, 1, ["request", seq, name, params]]);
      const reader = child.stdout
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buf = "";
      while (replies.length < 3) {
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
            request(21, "openSession", {
              cwd,
              id: "normal",
              openId: "normal-open",
              historyOnly: true,
            });
          } else if (frame[0] === "native") {
            writer(["nativeResult", frame[1], true, null]);
          } else if (frame[0] === "packet" && frame[1] === id) {
            expect(frame[2]).toBe(1);
            const packet = frame[3];
            if (packet[0] === "message" && packet[1] === "windowState")
              publication = packet[2].maximized === false;
            else if (packet[0] === "reply") {
              replies.push(packet);
              if (packet[1] === 21) {
                request(22, "openSession", {
                  cwd,
                  id: "oversize",
                  openId: "large-open",
                  historyOnly: true,
                });
              } else if (packet[1] === 22) request(23, "bootstrap");
            }
          }
        }
      }
      expect(publication).toBe(true);
      expect(replies).toHaveLength(3);
      expect(replies[0].slice(0, 3)).toEqual(["reply", 21, true]);
      expect(replies[1]).toEqual([
        "reply",
        22,
        false,
        "The desktop response exceeds the 64 MiB IPC limit.",
      ]);
      expect(replies[2].slice(0, 3)).toEqual(["reply", 23, true]);
      expect(replies[2][3]).toMatchObject({ generalCwd: cwd });
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
