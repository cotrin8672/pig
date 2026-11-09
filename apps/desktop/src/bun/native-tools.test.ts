import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BACKGROUND_CONTEXT as ctx,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { OutputBuffer } from "@earendil-works/chord/output";
import {
  type Agent,
  defineTool,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import {
  createBashTool,
  createEditTool,
  createPowerShellTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import type { CommandOptions, runCommand } from "./command-executor";
import {
  createNativeToolPolicy,
  type FinalCommandPlan,
  operationHash,
  type ToolOwner,
} from "./native-tool-policy";
import {
  createDesktopTools,
  DesktopExecutionEnv,
  resolveGitBash,
  resolvePowerShell,
  shellCommand,
} from "./shell-tools";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture(
  runner: typeof runCommand,
  shell: "git-bash" | "powershell" = "git-bash",
  authorize?: (plan: FinalCommandPlan) => void,
) {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const cwd = await mkdtemp(join(process.env.PI_SCRATCH_DIR, "native-tools-"));
  directories.push(cwd);
  const policy = createNativeToolPolicy({
    resolveOwner: async (identity) => ({
      ...identity,
      profileId: "fixture",
      policyRevision: 1,
      readOnly: false,
      roots: [cwd],
      tools: ["bash", "powershell", "read", "write", "edit", "probe"],
    }),
    authorize: async (_owner, operation) => {
      if (operation.kind === "exec") authorize?.(operation);
      return undefined;
    },
  });
  const env = new DesktopExecutionEnv({
    cwd,
    shell,
    shellProgram: "fixture-shell",
    spillDirectory: cwd,
    policy,
    runner,
    which: (name) => name,
  });
  const output = new OutputBuffer({
    maxBytes: 64,
    maxLines: 3,
    retain: "tail",
  });
  const api = {
    taskId: 1,
    conversationId: 1,
    callId: "fixture",
    env,
    agent: async () => ({}) as Agent,
    models: { getModel: () => undefined },
    output: (text: string | Uint8Array) => {
      output.push(text);
    },
    retainedOutput: () => {
      const value = output.snapshot();
      return {
        text: value.text,
        truncated: value.droppedBytes > 0 || value.droppedLines > 0,
      };
    },
    outputWindow: {
      maxBytes: 64,
      maxLines: 3,
      minIntervalMs: 1,
      bytesPerSecond: 1024,
    },
    diagnostic: () => {},
    details: async () => {},
  } as unknown as ToolExecutionApi;
  return {
    cwd,
    env,
    policy,
    api,
    output,
    execute: (tool: ToolRegistration, args: object) =>
      policy.wrap(tool).execute(args, api, ctx),
  };
}
test("Git Bash resolves real usr/bin from PATH, per-user and system installs", () => {
  const bash = "D:\\PortableGit\\usr\\bin\\bash.exe";
  for (const git of [
    "D:\\PortableGit\\cmd\\git.exe",
    "D:\\PortableGit\\bin\\git.exe",
    "D:\\PortableGit\\mingw64\\bin\\git.exe",
  ])
    expect(resolveGitBash({}, git, (path) => path === bash)).toBe(bash);
  const local = "C:\\Users\\test\\AppData\\Local",
    userBash = `${local}\\Programs\\Git\\usr\\bin\\bash.exe`;
  expect(
    resolveGitBash({ LOCALAPPDATA: local }, null, (path) => path === userBash),
  ).toBe(userBash);
  const system = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
  expect(
    resolveGitBash(
      { ProgramFiles: "C:\\Program Files" },
      null,
      (path) => path === system,
    ),
  ).toBe(system);
  expect(resolveGitBash({}, null, () => false)).toBeUndefined();
});
test("PowerShell resolution and argv remain truthful and distinct", () => {
  expect(resolvePowerShell((name) => `C:/${name}`)).toBe("C:/pwsh.exe");
  expect(
    resolvePowerShell((name) =>
      name === "powershell.exe" ? "C:/powershell.exe" : null,
    ),
  ).toBe("C:/powershell.exe");
  expect(() => resolvePowerShell(() => null)).toThrow(
    "neither pwsh.exe nor powershell.exe",
  );
  expect(shellCommand("powershell", "pwsh.exe", "Write-Output hi")).toEqual([
    "pwsh.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Write-Output hi",
  ]);
  expect(shellCommand("git-bash", "bash.exe", "echo hi")).toEqual([
    "bash.exe",
    "-c",
    "echo hi",
  ]);
});
test("native Bash and PowerShell authorize the unchanged final plan and keep live bounded output/spill", async () => {
  for (const shell of ["git-bash", "powershell"] as const) {
    let plan: FinalCommandPlan | undefined;
    let finished = false,
      live = false;
    const f = await fixture(
      async (program, args, options = {}) => {
        expect(plan).toBeDefined();
        if (!plan) throw new Error("Final plan missing");
        expect(Object.isFrozen(plan)).toBe(true);
        expect(Object.isFrozen(plan?.args)).toBe(true);
        expect(Object.isFrozen(plan?.env)).toBe(true);
        expect(program).toBe(plan.program);
        expect(args).toBe(plan.args);
        expect(options.env).toBe(plan?.env);
        expect(options.captureOutput).toBe(false);
        expect(options.maxBuffer).toBe(0);
        expect(options.timeout).toBe(50);
        options.onOutput?.("stdout", "first\n");
        live = f.output.snapshot().text.includes("first") && !finished;
        await new Promise((resolve) => setTimeout(resolve, 2));
        for (let i = 0; i < 3000; i++)
          options.onOutput?.(
            i % 2 ? "stderr" : "stdout",
            `${i} payload-payload\n`,
          );
        options.onOutput?.("stdout", "終わり\n");
        finished = true;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      shell,
      (value) => {
        plan = value;
      },
    );
    const tool =
      shell === "powershell"
        ? createPowerShellTool({ programs: ["fixture-shell"] })
        : createBashTool();
    const owner: ToolOwner = {
      taskId: f.api.taskId,
      conversationId: f.api.conversationId,
      callId: "fixture",
      toolName: tool.name,
      profileId: "fixture",
      policyRevision: 1,
      roots: [f.cwd],
      tools: [tool.name],
      readOnly: false,
    };
    const preview = await f.env.planTool(
      {
        id: "fixture",
        type: "toolCall",
        name: tool.name,
        arguments: { command: "echo fixture", timeout: 0.05 },
      },
      owner,
    );
    const result = await f.execute(tool, {
      command: "echo fixture",
      timeout: 0.05,
    });
    expect(live).toBe(true);
    expect(operationHash(plan)).toBe(operationHash(preview));
    expect(result.isError).not.toBe(true);
    expect(f.output.storedBytes).toBeLessThan(1024);
    const structured = result.structuredOutput as {
      output: string;
      truncated: boolean;
      fullOutputPath: string;
    };
    expect(structured.output).toContain("終わり");
    expect(structured.truncated).toBe(true);
    const spill = await readFile(structured.fullOutputPath, "utf8");
    expect(spill.startsWith("first\n")).toBe(true);
    expect(spill.endsWith("終わり\n")).toBe(true);
    if (shell === "powershell")
      expect(plan?.args).toContain("-ExecutionPolicy");
  }
});

test("changed/denied final command spawns zero; direct env.exec without a wrapped owner is denied", async () => {
  let spawned = 0;
  const f = await fixture(
    async () => {
      spawned++;
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    "git-bash",
    () => {
      throw new Error("final rewrite denied");
    },
  );
  await expect(
    f.execute(createBashTool(), { command: "changed" }),
  ).rejects.toThrow("final rewrite denied");
  expect((await f.env.exec("direct", undefined, ctx)).ok).toBe(false);
  expect(spawned).toBe(0);
});

test("timeout/cancel/callback failures remain native Result errors and retain spill diagnostics", async () => {
  for (const mode of ["timeout", "cancel", "callback"] as const) {
    let optionsSeen: CommandOptions | undefined;
    const f = await fixture(async (_program, _args, options = {}) => {
      optionsSeen = options;
      options.onOutput?.("stdout", "large output\n");
      if (mode === "callback") return { stdout: "", stderr: "", exitCode: 0 };
      if (mode === "timeout") {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      }
      await new Promise<void>((_resolve, reject) =>
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        ),
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const controller = new AbortController();
    const probe = defineTool({
      name: "probe",
      description: "fixture",
      parameters: {},
      async execute(_args, api, context) {
        if (!api.env) throw new Error("Fixture environment missing");
        const result = await api.env.exec(
          "fixture",
          {
            timeout: 0.02,
            spill: { afterBytes: 1, afterLines: 1 },
            onOutput:
              mode === "callback"
                ? () => {
                    throw new Error("consumer failed");
                  }
                : undefined,
          },
          context,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(
            mode === "cancel"
              ? "aborted"
              : mode === "callback"
                ? "callback_error"
                : "timeout",
          );
          expect(result.error.spillPath).toBeDefined();
        }
        return {};
      },
    });
    const pending = f.policy
      .wrap(probe)
      .execute({}, f.api, withAbortSignal(controller.signal, ctx));
    if (mode === "cancel") {
      while (!optionsSeen)
        await new Promise((resolve) => setTimeout(resolve, 1));
      controller.abort();
    }
    await pending;
    expect(optionsSeen?.timeout).toBe(20);
  }
});

test("native read/write/edit behavior is retained; standard tools do not advertise safe replay", async () => {
  const f = await fixture(async () => {
    throw new Error("no shell expected");
  });
  await f.execute(createWriteTool(), {
    path: "test.txt",
    content: "one\ntwo\n",
  });
  const edit = await f.execute(createEditTool(), {
    path: "test.txt",
    edits: [{ oldText: "two", newText: "three" }],
  });
  expect(JSON.stringify(edit)).toContain("three");
  const result = await f.execute(createReadTool(), {
    path: "test.txt",
    offset: 2,
    limit: 1,
  });
  expect(result.structuredOutput).toBe("three");
  await expect(
    f.execute(createEditTool(), {
      path: "test.txt",
      edits: [{ oldText: "missing", newText: "bad" }],
    }),
  ).rejects.toThrow();
  expect(await readFile(join(f.cwd, "test.txt"), "utf8")).toBe("one\nthree\n");
  const selected = createDesktopTools({
    shell: "git-bash",
    images: { prepare: async () => undefined },
    readOnly: true,
  });
  expect(selected.tools.map((tool) => tool.name)).toEqual(["read"]);
  for (const tool of [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
    createPowerShellTool(),
  ])
    expect(tool.replay).toBeUndefined();
});
