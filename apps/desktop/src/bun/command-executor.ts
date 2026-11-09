import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export interface CommandOptions {
  cwd?: string;
  signal?: AbortSignal;
  /** Milliseconds; zero (the default) disables the timeout. */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  /** Maximum captured bytes per stream, default 1 MiB; ignored without capture. */
  maxBuffer?: number;
  input?: string;
  /** Synchronous decoded UTF-8 chunks in pipe arrival order. Throwing stops the command. */
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
  /** Retain output (default true). False streams without buffering and returns empty strings. */
  captureOutput?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function cancelled() {
  const error = new Error("Command execution cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * The only subprocess boundary: argv goes through RTK proxy, never a raw fallback.
 * Output is not filtered or trimmed (including RTK's own diagnostics on stderr).
 * RTK tracks argv: callers must send secret command source through input, not args.
 */
export async function runCommand(
  program: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  if (options.signal?.aborted) throw cancelled();
  const timeout = options.timeout ?? 0;
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  const captureOutput = options.captureOutput !== false;
  if (
    !Number.isFinite(timeout) ||
    timeout < 0 ||
    Number.isNaN(maxBuffer) ||
    maxBuffer < 0
  )
    throw new Error("Invalid command execution limits");

  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    // Proxy is raw; forbid RTK from persisting output, even on command failure.
    RTK_TEE: "0",
    RTK_TELEMETRY_DISABLED: "1",
  };
  const search = { PATH: env.PATH ?? env.Path ?? "", cwd: options.cwd };
  let rtk: string | null;
  try {
    // Resolve once per invocation, using the same environment/cwd as the child.
    rtk = Bun.which("rtk", search);
  } catch {
    throw new Error("RTK is required but could not be resolved");
  }
  if (!rtk) throw new Error("RTK is required but was not found on PATH");
  // Proxy reports child-start errors as an ordinary nonzero status. Check the
  // executable up front so an absent/unlaunchable target is a spawn failure.
  try {
    if (!Bun.which(program, search)) throw new Error();
  } catch {
    throw new Error(
      "Command executable was not found or could not be resolved",
    );
  }
  const executable = rtk;

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, ["proxy", program, ...args], {
        cwd: options.cwd,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      reject(new Error("Failed to start RTK command"));
      return;
    }

    let failure: Error | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outputBytes = { stdout: 0, stderr: 0 };
    const decoders = options.onOutput
      ? { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") }
      : undefined;

    const finish = (error?: Error, exitCode?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: exitCode as number,
        });
    };
    const stop = (error: Error) => {
      if (settled || failure) return;
      failure = error;
      child.stdin?.destroy();
      // Drain/discard until the tree is killed: closing these pipes can make RTK
      // exit before taskkill finds its descendants, leaving the target running.
      if (!child.pid) {
        finish(error);
        return;
      }
      if (process.platform === "win32") {
        // Killing just RTK leaves its command running. Tree cleanup is RTK-routed too.
        try {
          const taskkill = process.env.SystemRoot
            ? join(process.env.SystemRoot, "System32", "taskkill.exe")
            : "taskkill.exe";
          const killer = spawn(
            executable,
            ["proxy", taskkill, "/PID", String(child.pid), "/T", "/F"],
            { env, windowsHide: true, stdio: "ignore" },
          );
          const fallback = setTimeout(() => {
            killer.kill();
            child.kill("SIGKILL");
          }, 5000);
          const done = () => {
            clearTimeout(fallback);
            child.kill("SIGKILL");
          };
          killer.once("error", done);
          killer.once("exit", done);
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const abort = () => stop(cancelled());
    child.once("error", () =>
      finish(failure ?? new Error("Failed to start RTK command")),
    );
    child.once("close", (code, signal) => {
      if (failure) finish(failure);
      else if (signal || code === null)
        finish(new Error("RTK command terminated unexpectedly"));
      else finish(undefined, code);
    });
    const deliver = (stream: "stdout" | "stderr", data: string) => {
      if (failure || settled || !data) return;
      try {
        options.onOutput?.(stream, data);
      } catch {
        stop(new Error("Failed to consume command output"));
      }
    };
    const consume = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (failure || settled) return;
      if (captureOutput) {
        outputBytes[stream] += chunk.length;
        if (outputBytes[stream] > maxBuffer) {
          stop(new Error("Command output exceeded the buffer limit"));
          return;
        }
        (stream === "stdout" ? stdout : stderr).push(chunk);
      }
      if (decoders) deliver(stream, decoders[stream].write(chunk));
    };
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.on("data", (chunk: Buffer) => consume(stream, chunk));
      child[stream]?.once("end", () => {
        if (decoders) deliver(stream, decoders[stream].end());
      });
    }
    child.stdout?.once("error", () =>
      stop(new Error("Failed to read command output")),
    );
    child.stderr?.once("error", () =>
      stop(new Error("Failed to read command output")),
    );
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      // A command may exit without consuming all its input.
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED")
        stop(new Error("Failed to write command input"));
    });
    if (timeout > 0)
      timer = setTimeout(() => {
        const error = new Error("Command execution timed out");
        error.name = "TimeoutError";
        stop(error);
      }, timeout);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    else child.stdin?.end(options.input ?? "");
  });
}
