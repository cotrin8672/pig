import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  defineExtension,
  type ToolHookCall,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import {
  ExecutionError,
  err,
  FileError,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
} from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createBashTool,
  createEditTool,
  createPowerShellTool,
  createReadTool,
  createWriteTool,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import type { Settings } from "../shared/settings";
import { runCommand } from "./command-executor";
import {
  canonicalOperationPath,
  type FinalCommandPlan,
  type NativeToolPolicy,
  type ToolOwner,
} from "./native-tool-policy";
import { resolveGitBash, resolvePowerShell } from "./shell-paths";

export { resolveGitBash, resolvePowerShell, shellCommand } from "./shell-paths";

const UTF8_OUTPUT =
  "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}";
const PS_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
];
export type NativeEnvironmentOptions = {
  cwd: string;
  shell: Settings["shell"];
  policy: NativeToolPolicy;
  /** Explicit app-owned temporary directory, never a project-relative filename. */
  spillDirectory: string;
  shellProgram?: string;
  shellEnv?: NodeJS.ProcessEnv;
  commandPrefix?: string;
  /** Test seam; production must retain the mandatory RTK runner. */
  runner?: typeof runCommand;
  which?: (
    program: string,
    env: Readonly<Record<string, string>>,
    cwd: string,
  ) => string | null;
};
function secondsToMilliseconds(seconds?: number): number {
  if (seconds === undefined) return 0;
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds * 1000 > 2_147_483_647
  )
    throw new ExecutionError("timeout", "Invalid timeout in seconds");
  return seconds * 1000;
}
function shellProgram(shell: Settings["shell"]): string {
  if (shell === "powershell") return resolvePowerShell();
  const program =
    process.platform === "win32" ? resolveGitBash() : Bun.which("bash");
  if (!program)
    throw new Error(
      "Git Bash is selected, but a real bash executable was not found",
    );
  return program;
}

/** Native filesystem/edits remain upstream. Only the process and capability
 * boundaries are app-owned. No super.exec, discovery subprocess, or raw fallback. */
export class DesktopExecutionEnv extends NodeExecutionEnv {
  private readonly config: NativeEnvironmentOptions;
  private readonly program: string;
  private readonly active = new Map<AbortController, Promise<unknown>>();
  private closed = false;
  constructor(options: NativeEnvironmentOptions) {
    super({ cwd: options.cwd });
    this.program = options.shellProgram ?? shellProgram(options.shell);
    this.config = { ...options, shellEnv: { ...options.shellEnv } };
  }
  /** Also used by beforeTool, before native execute intent. */
  async plan(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    owner: ToolOwner,
  ): Promise<FinalCommandPlan> {
    const cwd = await canonicalOperationPath(options?.cwd ?? this.cwd);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      ...(options?.inheritEnv === false
        ? {}
        : { ...process.env, ...this.config.shellEnv }),
      ...options?.env,
      RTK_TEE: "0",
      RTK_TELEMETRY_DISABLED: "1",
    }))
      if (value !== undefined) env[key] = value;
    const argv =
      typeof command === "string"
        ? this.config.shell === "powershell"
          ? [this.program, ...PS_ARGS, command]
          : [this.program, "-c", command]
        : [...command];
    if (!argv.length || !argv[0])
      throw new ExecutionError("spawn_error", "Empty command");
    const resolveProgram =
      this.config.which ??
      ((name, environment, directory) =>
        Bun.which(name, {
          PATH: environment.PATH ?? environment.Path ?? "",
          cwd: directory,
        }));
    const program = resolveProgram(argv[0], env, cwd);
    if (!program)
      throw new ExecutionError(
        "shell_unavailable",
        "Command executable is unavailable",
      );
    return Object.freeze({
      kind: "exec",
      transport: "rtk-proxy",
      program,
      args: Object.freeze(argv.slice(1)),
      script:
        typeof command === "string"
          ? command
          : argv.includes("-Command")
            ? (argv.at(-1) ?? null)
            : null,
      cwd,
      env: Object.freeze(env),
      timeoutMs: secondsToMilliseconds(options?.timeout),
      policyRevision: owner.policyRevision,
    });
  }
  async planTool(
    call: ToolHookCall,
    owner: ToolOwner,
  ): Promise<FinalCommandPlan | undefined> {
    if (call.name !== "bash" && call.name !== "powershell") return;
    if (
      call.name !== (this.config.shell === "powershell" ? "powershell" : "bash")
    )
      throw new Error("Shell tool does not match the selected environment");
    if (typeof call.arguments.command !== "string")
      throw new Error("Invalid shell command");
    const command = this.config.commandPrefix
      ? `${this.config.commandPrefix}\n${call.arguments.command}`
      : call.arguments.command;
    const invocation =
      call.name === "powershell"
        ? [this.program, ...PS_ARGS, `${UTF8_OUTPUT}\n${command}`]
        : command;
    return this.plan(
      invocation,
      {
        cwd: this.cwd,
        env: {},
        inheritEnv: true,
        timeout: call.arguments.timeout as number | undefined,
      },
      owner,
    );
  }
  override async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    let spillPath: string | undefined;
    let fd: number | undefined;
    let callbackFailure: unknown;
    const controller = new AbortController();
    const abort = () => controller.abort();
    try {
      if (this.closed || context.abortSignal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      const owner = this.config.policy.currentOwner();
      // Capture mutable caller options BEFORE awaiting authorization.
      const output = options?.onOutput;
      const spill = options?.spill && { ...options.spill };
      const final = await this.plan(command, options, owner);
      await this.config.policy.path(final.cwd, final.cwd, context);
      const lease = await this.config.policy.authorize(final, context);
      if (
        (await this.config.policy.path(final.cwd, final.cwd, context)) !==
        final.cwd
      )
        throw new Error("Command cwd changed after authorization");
      if (this.closed || context.abortSignal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      context.abortSignal?.addEventListener("abort", abort, { once: true });
      // Synchronous disk writes provide bounded backpressure: the runner's callback
      // cannot queue an unbounded async spill. Native api.output owns the retained
      // window and LIVE progress pacing; deliver every chunk, never completion-only.
      const prefix: Buffer[] = [];
      let bytes = 0,
        newlines = 0,
        endsWithNewline = true;
      if (
        spill &&
        (!Number.isFinite(spill.afterBytes) ||
          spill.afterBytes < 0 ||
          !Number.isFinite(spill.afterLines) ||
          spill.afterLines < 0)
      )
        throw new ExecutionError("unknown", "Invalid spill limits");
      const runner = this.config.runner ?? runCommand;
      lease(); // Last synchronous revocation/expiry/UI check, immediately before RTK spawn.
      const pending = runner(final.program, final.args, {
        cwd: final.cwd,
        env: final.env,
        timeout: final.timeoutMs,
        signal: controller.signal,
        maxBuffer: 0,
        captureOutput: false,
        onOutput: (stream, text) => {
          try {
            if (spill) {
              const chunk = Buffer.from(text);
              bytes += chunk.length;
              for (
                let i = text.indexOf("\n");
                i !== -1;
                i = text.indexOf("\n", i + 1)
              )
                newlines++;
              if (text) endsWithNewline = text.endsWith("\n");
              if (
                fd === undefined &&
                (bytes > Math.min(spill.afterBytes, 1024 * 1024) ||
                  newlines + (endsWithNewline ? 0 : 1) > spill.afterLines)
              ) {
                spillPath = join(
                  this.config.spillDirectory,
                  `pig-shell-${randomUUID()}.log`,
                );
                fd = openSync(spillPath, "wx", 0o600);
                for (const saved of prefix) writeSync(fd, saved);
                prefix.length = 0;
              }
              if (fd === undefined) prefix.push(chunk);
              else writeSync(fd, chunk);
            }
            output?.(text, context, { stream });
          } catch (error) {
            callbackFailure = error;
            throw error;
          }
        },
      });
      this.active.set(controller, pending);
      const result = await pending;
      return ok({
        exitCode: result.exitCode,
        ...(spillPath ? { spillPath } : {}),
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const failure =
        cause instanceof ExecutionError
          ? cause
          : new ExecutionError(
              callbackFailure
                ? "callback_error"
                : error.name === "AbortError"
                  ? "aborted"
                  : error.name === "TimeoutError"
                    ? "timeout"
                    : "spawn_error",
              error.message,
              error,
            );
      failure.spillPath = spillPath;
      return err(failure);
    } finally {
      context.abortSignal?.removeEventListener("abort", abort);
      this.active.delete(controller);
      if (fd !== undefined) closeSync(fd);
    }
  }
  override async cleanup(_context: Context): Promise<void> {
    this.closed = true;
    for (const controller of this.active.keys()) controller.abort();
    await Promise.allSettled(this.active.values());
  }
  private async file<T>(
    path: string,
    context: Context,
    action: (
      canonical: string,
      destination?: string,
    ) => Promise<Result<T, FileError>>,
    mutation?: {
      action: string;
      content?: string | Uint8Array;
      other?: string;
    },
  ): Promise<Result<T, FileError>> {
    try {
      const absolute = await super.absolutePath(path, context);
      if (!absolute.ok) return absolute;
      const canonical = await this.config.policy.path(
        absolute.value,
        this.cwd,
        context,
        !!mutation,
      );
      let destination: string | undefined;
      if (mutation) {
        const paths = [canonical];
        if (mutation.other) {
          destination = await this.config.policy.path(
            mutation.other,
            this.cwd,
            context,
            true,
          );
          paths.push(destination);
        }
        const lease = await this.config.policy.authorize(
          Object.freeze({
            kind: "file",
            action: mutation.action,
            paths: Object.freeze(paths),
            contentHash:
              mutation.content === undefined
                ? null
                : createHash("sha256").update(mutation.content).digest("hex"),
            policyRevision: this.config.policy.currentOwner().policyRevision,
          }),
          context,
        );
        // Recheck links and policy after an arbitrarily long approval wait.
        if (
          (await this.config.policy.path(
            absolute.value,
            this.cwd,
            context,
            true,
          )) !== canonical
        )
          throw new Error("File path changed after authorization");
        if (
          mutation.other &&
          (await this.config.policy.path(
            mutation.other,
            this.cwd,
            context,
            true,
          )) !== destination
        )
          throw new Error("Destination path changed after authorization");
        lease();
      }
      return await action(canonical, destination);
    } catch (cause) {
      return err(
        new FileError(
          context.abortSignal?.aborted ? "aborted" : "permission_denied",
          cause instanceof Error ? cause.message : String(cause),
          path,
        ),
      );
    }
  }
  override openBinaryReader(
    path: string,
    options: Parameters<NodeExecutionEnv["openBinaryReader"]>[1],
    context: Context,
  ) {
    return this.file(path, context, (p) =>
      super.openBinaryReader(p, options, context),
    );
  }
  override openTextLineReader(path: string, context: Context) {
    return this.file(path, context, (p) =>
      super.openTextLineReader(p, context),
    );
  }
  override readTextFile(path: string, context: Context) {
    return this.file(path, context, (p) => super.readTextFile(p, context));
  }
  override readTextLines(
    path: string,
    options: Parameters<NodeExecutionEnv["readTextLines"]>[1],
    context: Context,
  ) {
    return this.file(path, context, (p) =>
      super.readTextLines(p, options, context),
    );
  }
  override readBinaryFile(path: string, context: Context) {
    return this.file(path, context, (p) => super.readBinaryFile(p, context));
  }
  override fileInfo(path: string, context: Context) {
    return this.file(path, context, (p) => super.fileInfo(p, context));
  }
  override listDir(path: string, context: Context) {
    return this.file(path, context, (p) => super.listDir(p, context));
  }
  override openDirReader(path: string, context: Context) {
    return this.file(path, context, (p) => super.openDirReader(p, context));
  }
  override canonicalPath(path: string, context: Context) {
    return this.file(path, context, (p) => super.canonicalPath(p, context));
  }
  override exists(path: string, context: Context) {
    return this.file(path, context, (p) => super.exists(p, context));
  }
  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ) {
    const captured =
      typeof content === "string" ? content : new Uint8Array(content);
    return this.file(
      path,
      context,
      (p) => super.writeFile(p, captured, context),
      { action: "write", content: captured },
    );
  }
  override appendFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ) {
    const captured =
      typeof content === "string" ? content : new Uint8Array(content);
    return this.file(
      path,
      context,
      (p) => super.appendFile(p, captured, context),
      { action: "append", content: captured },
    );
  }
  override truncateFile(path: string, size: number, context: Context) {
    return this.file(
      path,
      context,
      (p) => super.truncateFile(p, size, context),
      { action: "truncate", content: String(size) },
    );
  }
  override flushFile(path: string, context: Context) {
    return this.file(path, context, (p) => super.flushFile(p, context), {
      action: "flush",
    });
  }
  override renameFile(source: string, destination: string, context: Context) {
    return this.file<void>(
      source,
      context,
      (p, target) =>
        target
          ? super.renameFile(p, target, context)
          : Promise.resolve(
              err(new FileError("invalid", "Missing destination")),
            ),
      { action: "rename", other: destination },
    );
  }
  override createDir(
    path: string,
    options: Parameters<NodeExecutionEnv["createDir"]>[1],
    context: Context,
  ) {
    const captured = { ...options };
    return this.file(
      path,
      context,
      (p) => super.createDir(p, captured, context),
      { action: "mkdir", content: JSON.stringify(captured) },
    );
  }
  override remove(
    path: string,
    options: Parameters<NodeExecutionEnv["remove"]>[1],
    context: Context,
  ) {
    const captured = { ...options };
    return this.file(path, context, (p) => super.remove(p, captured, context), {
      action: "remove",
      content: JSON.stringify(captured),
    });
  }
  override async watch(
    targets: Parameters<NodeExecutionEnv["watch"]>[0],
    onChange: Parameters<NodeExecutionEnv["watch"]>[1],
    context: Context,
  ): ReturnType<NodeExecutionEnv["watch"]> {
    try {
      const checked = await Promise.all(
        targets.map(async (target) => ({
          ...target,
          path: await this.config.policy.path(target.path, this.cwd, context),
        })),
      );
      return super.watch(checked, onChange, context);
    } catch {
      return err(
        new FileError("permission_denied", "Watch outside authorized roots"),
      );
    }
  }
  override async createTempDir(
    _prefix: string | undefined,
    _context: Context,
  ): Promise<Result<string, FileError>> {
    return err(
      new FileError(
        "permission_denied",
        "Use an authorized project path; arbitrary temporary writes are disabled",
      ),
    );
  }
  override async createTempFile(
    _options: Parameters<NodeExecutionEnv["createTempFile"]>[0],
    _context: Context,
  ): Promise<Result<string, FileError>> {
    return err(
      new FileError(
        "permission_denied",
        "Use an authorized project path; arbitrary temporary writes are disabled",
      ),
    );
  }
}

export function desktopShellTool(
  options: Pick<
    NativeEnvironmentOptions,
    "shell" | "shellProgram" | "commandPrefix"
  >,
) {
  return options.shell === "powershell"
    ? createPowerShellTool({
        programs: [options.shellProgram ?? shellProgram(options.shell)],
        commandPrefix: options.commandPrefix,
      })
    : createBashTool({ commandPrefix: options.commandPrefix });
}
/** Read-only selection excludes write/edit/shell AND delegation, including nested
 * calls. These tools still require the mandatory policy/image wrappers. */
export function createDesktopTools(options: {
  shell: Settings["shell"];
  shellProgram?: string;
  commandPrefix?: string;
  images: ImageProcessor;
  readOnly?: boolean;
}) {
  const read = createReadTool({ images: options.images });
  const tools: ToolRegistration[] = options.readOnly
    ? [read]
    : [read, createWriteTool(), createEditTool(), desktopShellTool(options)];
  return { tools, extension: defineExtension({ name: "pig.tools", tools }) };
}
