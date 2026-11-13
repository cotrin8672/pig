import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { UsageError } from "./contracts";

/** .cmd shims require cmd.exe on Windows; only fixed, safely quoted arguments are accepted. */
export function usageInvocation(
  path: string,
  args: readonly string[],
  platform = process.platform,
) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(path))
    return { command: path, args: [...args], verbatim: false };
  if ([path, ...args].some((value) => /[&|<>^%!\r\n"]/u.test(value)))
    throw new UsageError("unavailable");
  const line = [path, ...args].map((value) => `"${value}"`).join(" ");
  return {
    command: join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "cmd.exe",
    ),
    args: ["/d", "/s", "/c", `"${line}"`],
    verbatim: true,
  };
}
/** Executes an owned process tree, with no shell except the guarded Windows shim adapter. */
export function usageProcess(
  path: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
) {
  const invocation = usageInvocation(path, args);
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      bytes = 0,
      done = false;
    let failure: UsageError | undefined;
    const decoder = new StringDecoder("utf8");
    const finish = (error?: UsageError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(output + decoder.end());
    };
    const stop = (error: UsageError) => {
      if (failure || done) return;
      failure = error;
      if (process.platform === "win32" && child.pid) {
        const kill = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/pid", String(child.pid), "/t", "/f"],
          { windowsHide: true, stdio: "ignore" },
        );
        kill.once("error", () => child.kill());
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill();
    };
    const abort = () => stop(new UsageError("unavailable"));
    const timer = setTimeout(() => stop(new UsageError("unavailable")), 15_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout?.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > 256 * 1024) stop(new UsageError("format"));
      else output += decoder.write(data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > 256 * 1024) stop(new UsageError("format"));
    });
    child.once("error", () => finish(new UsageError("unavailable")));
    child.once("close", (code) =>
      finish(
        failure ?? (code === 0 ? undefined : new UsageError("unavailable")),
      ),
    );
  });
}
