import { Database } from "bun:sqlite";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCommand } from "./command-executor";

const directories: string[] = [];
afterEach(async () => {
  mock.restore();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function boundary() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  let input = "";
  child.stdin.on("data", (chunk) => {
    input += chunk.toString();
  });
  const which = spyOn(Bun, "which").mockReturnValue("rtk-fixture");
  const spawn = spyOn(childProcess, "spawn").mockReturnValue(
    child as unknown as childProcess.ChildProcess,
  );
  return { child, which, spawn, input: () => input };
}

async function directory() {
  const path = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-rtk-"),
  );
  directories.push(path);
  return path;
}

test("runCommand binds unchanged argv/cwd/env/input to RTK proxy and preserves raw streams", async () => {
  const fixture = boundary();
  const args = Object.freeze(["a b", '"quoted"', "&&", "", "--flag"]);
  const pending = runCommand("fixture-program", args, {
    cwd: "fixture-cwd",
    env: { PATH: "fixture-path", FIXTURE: "kept", RTK_TEE: "always" },
    input: "source on stdin\n",
  });
  expect(fixture.which.mock.calls).toEqual([
    ["rtk", { PATH: "fixture-path", cwd: "fixture-cwd" }],
    ["fixture-program", { PATH: "fixture-path", cwd: "fixture-cwd" }],
  ]);
  expect(fixture.spawn.mock.calls).toEqual([
    [
      "rtk-fixture",
      ["proxy", "fixture-program", ...args],
      {
        cwd: "fixture-cwd",
        env: {
          PATH: "fixture-path",
          FIXTURE: "kept",
          RTK_TEE: "0",
          RTK_TELEMETRY_DISABLED: "1",
        },
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ],
  ]);
  expect(fixture.input()).toBe("source on stdin\n");
  const bytes = Buffer.from("  \u001b[31m雪\r\n\n");
  fixture.child.stdout.emit("data", bytes.subarray(0, 9));
  fixture.child.stdout.emit("data", bytes.subarray(9));
  fixture.child.stderr.emit("data", Buffer.from(" raw stderr\r\n"));
  fixture.child.emit("close", 23, null);
  expect(await pending).toEqual({
    stdout: bytes.toString(),
    stderr: " raw stderr\r\n",
    exitCode: 23,
  });
});

test("live chunks retain interleaved arrival order and independently decode split UTF-8", async () => {
  const fixture = boundary();
  const output: [string, string][] = [];
  const pending = runCommand("fixture", [], {
    onOutput: (stream, data) => output.push([stream, data]),
  });
  const stdout = Buffer.from("雪");
  const stderr = Buffer.from("🙂");
  fixture.child.stdout.emit("data", stdout.subarray(0, 1));
  fixture.child.stderr.emit("data", Buffer.from("e1\n"));
  fixture.child.stdout.emit("data", stdout.subarray(1));
  fixture.child.stderr.emit("data", stderr.subarray(0, 2));
  fixture.child.stdout.emit("data", Buffer.from("o2\n"));
  fixture.child.stderr.emit("data", stderr.subarray(2));
  fixture.child.stdout.emit("data", Buffer.from([0xe2, 0x82]));
  fixture.child.stderr.emit("data", Buffer.from("e3\n"));
  // Delivery occurs before exit, without waiting for complete lines or both streams.
  expect(output).toEqual([
    ["stderr", "e1\n"],
    ["stdout", "雪"],
    ["stdout", "o2\n"],
    ["stderr", "🙂"],
    ["stderr", "e3\n"],
  ]);
  fixture.child.stdout.emit("end");
  fixture.child.stderr.emit("end");
  expect(output.at(-1)).toEqual(["stdout", "�"]);
  fixture.child.emit("close", 0, null);
  expect(await pending).toEqual({
    stdout: "雪o2\n�",
    stderr: "e1\n🙂e3\n",
    exitCode: 0,
  });
});

test("captureOutput false streams beyond maxBuffer without retaining output", async () => {
  const fixture = boundary();
  const bytes = { stdout: 0, stderr: 0 };
  const pending = runCommand("fixture", [], {
    captureOutput: false,
    maxBuffer: 1,
    onOutput: (stream, data) => {
      bytes[stream] += Buffer.byteLength(data);
    },
  });
  const chunk = Buffer.alloc(256 * 1024, "x");
  for (let index = 0; index < 8; index++) {
    fixture.child.stdout.emit("data", chunk);
    fixture.child.stderr.emit("data", chunk);
  }
  expect(bytes).toEqual({ stdout: 2 * 1024 * 1024, stderr: 2 * 1024 * 1024 });
  fixture.child.emit("close", 7, null);
  expect(await pending).toEqual({ stdout: "", stderr: "", exitCode: 7 });
});

test("maxBuffer zero still limits default capture, even with a streaming sink", async () => {
  const fixture = boundary();
  const sink = mock(() => {});
  const pending = runCommand("fixture", [], { maxBuffer: 0, onOutput: sink });
  fixture.child.stdout.emit("data", Buffer.from("x"));
  await expect(pending).rejects.toThrow(
    "Command output exceeded the buffer limit",
  );
  expect(sink).not.toHaveBeenCalled();
});

test("sink exceptions reject sanitized and stop all subsequent delivery", async () => {
  const fixture = boundary();
  const sink = mock(() => {
    throw new Error("private-sink-source private-output");
  });
  const pending = runCommand("private-program", [], {
    captureOutput: false,
    onOutput: sink,
  });
  fixture.child.stdout.emit("data", Buffer.from("private-output"));
  fixture.child.stderr.emit("data", Buffer.from("private-stderr"));
  const error = await pending.catch((value: Error) => value);
  expect((error as Error).message).toBe("Failed to consume command output");
  expect((error as Error).cause).toBeUndefined();
  expect(Bun.inspect(error)).not.toContain("private-");
  expect(sink).toHaveBeenCalledTimes(1);
});

test("missing RTK fails closed without starting the target or a fallback", async () => {
  const fixture = boundary();
  fixture.which.mockReturnValue(null);
  await expect(runCommand("do-not-run", ["private-argument"])).rejects.toThrow(
    "RTK is required",
  );
  expect(fixture.which).toHaveBeenCalledTimes(1);
  expect(fixture.spawn).not.toHaveBeenCalled();
});

test("a missing target is a sanitized spawn failure, not an exit code", async () => {
  const fixture = boundary();
  fixture.which.mockReturnValueOnce("rtk-fixture").mockReturnValueOnce(null);
  await expect(runCommand("private-missing-program", [])).rejects.toThrow(
    "Command executable was not found or could not be resolved",
  );
  expect(fixture.spawn).not.toHaveBeenCalled();
});

test("RTK is resolved anew per call and lookup failures are sanitized", async () => {
  const fixture = boundary();
  fixture.which.mockReturnValueOnce(null).mockImplementationOnce(() => {
    throw new Error("private-resolver-source");
  });
  await expect(runCommand("fixture", [])).rejects.toThrow("not found on PATH");
  await expect(runCommand("fixture", [])).rejects.toThrow(
    "RTK is required but could not be resolved",
  );
  expect(fixture.which).toHaveBeenCalledTimes(2);
  expect(fixture.spawn).not.toHaveBeenCalled();
});

test("spawn failure has no command/output/cause attached", async () => {
  const fixture = boundary();
  const pending = runCommand("private-program", ["private-argument"]);
  fixture.child.emit(
    "error",
    Object.assign(new Error("private-output"), {
      spawnargs: ["private-source"],
    }),
  );
  const error = await pending.catch((value: Error) => value);
  expect(error).toBeInstanceOf(Error);
  expect(Bun.inspect(error)).not.toContain("private-");
  expect((error as Error).cause).toBeUndefined();
});

test("pre-cancellation starts nothing and does not expose the abort reason", async () => {
  const fixture = boundary();
  const controller = new AbortController();
  controller.abort(new Error("private-abort-reason"));
  await expect(
    runCommand("private-program", [], { signal: controller.signal }),
  ).rejects.toThrow("Command execution cancelled");
  expect(fixture.which).not.toHaveBeenCalled();
  expect(fixture.spawn).not.toHaveBeenCalled();
});

test("mid-command cancellation and timeout reject rather than returning exit codes", async () => {
  const fixture = boundary();
  const controller = new AbortController();
  const pending = runCommand("fixture", [], { signal: controller.signal });
  fixture.child.stdout.emit("data", Buffer.from("private-output"));
  controller.abort("private-abort-reason");
  const error = await pending.catch((value: Error) => value);
  expect((error as Error).name).toBe("AbortError");
  expect(Bun.inspect(error)).not.toContain("private-");
  await expect(runCommand("fixture", [], { timeout: 1 })).rejects.toThrow(
    "Command execution timed out",
  );
});

test("buffer overflow and synchronous spawn errors never echo source/output", async () => {
  const fixture = boundary();
  const pending = runCommand("private-program", [], { maxBuffer: 2 });
  fixture.child.stdout.emit("data", Buffer.from("private-output"));
  await expect(pending).rejects.toThrow(
    "Command output exceeded the buffer limit",
  );
  fixture.spawn.mockImplementationOnce(() => {
    throw new Error("private-source");
  });
  await expect(runCommand("private-program", [])).rejects.toThrow(
    "Failed to start RTK command",
  );
});

test("real RTK proxy preserves argv, cwd, stdin and nonzero exit without filtering", async () => {
  const cwd = await directory();
  const database = join(cwd, "history.db");
  const args = ["a b", "quote\"and'", "&&", "", "雪"];
  const script = `
    const input = await Bun.stdin.text();
    process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), input, env: process.env.FIXTURE, tee: process.env.RTK_TEE }));
    process.stderr.write('  raw-stderr\\r\\n');
    process.exit(17);
  `;
  const result = await runCommand(
    process.execPath,
    ["--eval", script, ...args],
    {
      cwd,
      input: "  raw-input\r\n雪\n",
      env: { ...process.env, FIXTURE: "kept", RTK_DB_PATH: database },
    },
  );
  expect(result.exitCode).toBe(17);
  expect(JSON.parse(result.stdout)).toEqual({
    args,
    cwd,
    input: "  raw-input\r\n雪\n",
    env: "kept",
    tee: "0",
  });
  expect(result.stderr.endsWith("  raw-stderr\r\n")).toBe(true);
  const db = new Database(database, { readonly: true });
  try {
    const rows = db.query("SELECT rtk_cmd FROM commands").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain("rtk proxy");
  } finally {
    db.close();
  }
}, 10_000);

test("real RTK delivers live interleaved Unicode to a spill sink without capture", async () => {
  const cwd = await directory();
  const spill = join(cwd, "spill.txt");
  const stdoutAck = join(cwd, "stdout-ack");
  const stderrAck = join(cwd, "stderr-ack");
  const script = `
    import { existsSync } from 'node:fs';
    async function waitFor(path) {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (existsSync(path)) return;
        await Bun.sleep(10);
      }
      process.exit(2);
    }
    const out = Buffer.from('live-雪\\n');
    process.stdout.write(out.subarray(0, 6));
    await Bun.sleep(25);
    process.stdout.write(out.subarray(6));
    await waitFor(${JSON.stringify(stdoutAck)});
    const err = Buffer.from('err-🙂\\n');
    process.stderr.write(err.subarray(0, 6));
    await Bun.sleep(25);
    process.stderr.write(err.subarray(6));
    await waitFor(${JSON.stringify(stderrAck)});
    for (let index = 0; index < 20; index++)
      await new Promise(resolve => process.stdout.write('x'.repeat(65536), resolve));
  `;
  const delivered = { stdout: "", stderr: "" };
  const order: string[] = [];
  let bytes = 0;
  const result = await runCommand(process.execPath, ["--eval", script], {
    cwd,
    captureOutput: false,
    maxBuffer: 64,
    timeout: 10_000,
    env: { ...process.env, RTK_DB_PATH: join(cwd, "history.db") },
    onOutput: (stream, data) => {
      appendFileSync(spill, data);
      bytes += Buffer.byteLength(data);
      const ack = stream === "stdout" ? stdoutAck : stderrAck;
      const marker = stream === "stdout" ? "live-雪\n" : "err-🙂\n";
      if (!existsSync(ack)) {
        delivered[stream] += data;
        if (delivered[stream].includes(marker)) {
          order.push(stream);
          appendFileSync(ack, "");
        }
      }
    },
  });
  // Each acknowledgement must reach a still-running child before it can continue.
  expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(order).toEqual(["stdout", "stderr"]);
  expect(bytes).toBeGreaterThan(1024 * 1024);
  expect(statSync(spill).size).toBe(bytes);
}, 15_000);

test("a failing live sink terminates the real RTK target tree without leaking its error", async () => {
  const cwd = await directory();
  const marker = join(cwd, "child-pid");
  const script = `
    await Bun.write(${JSON.stringify(marker)}, String(process.pid));
    setInterval(() => process.stdout.write('sink-trigger\\n'), 10);
  `;
  let received = "";
  const error = await runCommand(process.execPath, ["--eval", script], {
    captureOutput: false,
    timeout: 8000,
    env: { ...process.env, RTK_DB_PATH: join(cwd, "history.db") },
    onOutput: (stream, data) => {
      if (stream !== "stdout") return;
      received += data;
      if (received.includes("sink-trigger"))
        throw new Error("private-sink-source private-output");
    },
  }).catch((value: Error) => value);
  expect((error as Error).message).toBe("Failed to consume command output");
  expect((error as Error).cause).toBeUndefined();
  expect(Bun.inspect(error)).not.toContain("private-");
  expect(existsSync(marker)).toBe(true);
  const pid = Number(readFileSync(marker, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}, 12_000);

test("a supplied PATH without RTK never borrows ambient RTK", async () => {
  const cwd = await directory();
  await expect(
    runCommand(process.execPath, [], { cwd, env: { PATH: cwd } }),
  ).rejects.toThrow("RTK is required but was not found on PATH");
});

for (const mode of ["timeout", "cancel"] as const)
  test(`real RTK ${mode} terminates the command tree`, async () => {
    const cwd = await directory();
    const marker = join(cwd, "child-pid");
    const script = `await Bun.write(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 10000);`;
    const controller = new AbortController();
    const pending = runCommand(process.execPath, ["--eval", script], {
      timeout: mode === "timeout" ? 2000 : 8000,
      signal: controller.signal,
      env: { ...process.env, RTK_DB_PATH: join(cwd, "history.db") },
    }).catch((error: Error) => error);
    if (mode === "cancel") {
      for (let attempt = 0; !existsSync(marker) && attempt < 100; attempt++)
        await Bun.sleep(20);
      controller.abort("private-abort-reason");
    }
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      mode === "cancel"
        ? "Command execution cancelled"
        : "Command execution timed out",
    );
    expect(existsSync(marker)).toBe(true);
    const pid = Number(readFileSync(marker, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 12_000);
