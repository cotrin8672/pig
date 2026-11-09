import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isolatedP0Env } from "../../scripts/durable-p0";
import type { Settings } from "../shared/settings";
import type {
  ApplicationRuntime,
  ApplicationRuntimeOptions,
} from "./application-runtime";
import { runCommand } from "./command-executor";

/** Native modules load only AFTER the RTK child has temporary HOME/USERPROFILE. */
export async function runApplicationFixture(mode: string): Promise<void> {
  assert(process.env.PI_SCRATCH_DIR, "PI_SCRATCH_DIR required");
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR, "pig-application-"),
  );
  try {
    const result = await runCommand(
      process.execPath,
      [import.meta.path, mode],
      {
        cwd: root,
        env: isolatedP0Env(root),
        timeout: 25_000,
      },
    );
    assert.equal(
      result.exitCode,
      0,
      `${mode}\n${result.stdout}\n${result.stderr}`,
    );
    assert(result.stdout.includes(`PASS ${mode}`), result.stdout);
    assert(!result.stderr.includes("Unhandled"), result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function fixture(
  overrides: Partial<ApplicationRuntimeOptions> = {},
  shell: Settings["shell"] = "powershell",
) {
  const root = process.env.PIG_P0_ROOT;
  assert(
    root && process.env.HOME === root && process.env.USERPROFILE === root,
    "temporary HOME required",
  );
  const [
    ai,
    d,
    { BACKGROUND_CONTEXT: ctx },
    { createApplicationRuntime },
    { FileCredentials },
    { defaultSettings },
    { NativeApprovals },
    { Todos, Delegations },
  ] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
    import("./application-runtime"),
    import("./credentials"),
    import("../shared/settings"),
    import("./native-approvals"),
    import("./builtin-extensions"),
  ]);
  const cwd = join(root, "project"),
    other = join(root, "other"),
    modelDirectory = join(root, "models");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(other, { recursive: true }),
    mkdir(modelDirectory, { recursive: true }),
  ]);
  let network = 0,
    modelCreations = 0,
    spawns = 0;
  globalThis.fetch = Object.assign(
    () => {
      network++;
      throw new Error("Unexpected fixture network");
    },
    { preconnect: fetch.preconnect },
  ) as typeof fetch;
  const credentials = new FileCredentials(join(modelDirectory, "auth.json"));
  const providers = new Map<string, ReturnType<typeof ai.fauxProvider>>();
  const unused = d.defineExtension({
    name: "fixture.unselected",
    tools: [
      d.defineTool({
        name: "unselected",
        description: "Not selected",
        parameters: {},
        execute: async () => {
          throw new Error("Unselected tool ran");
        },
      }),
    ],
  });
  const settings = {
    ...defaultSettings,
    shell,
    blockImages: true,
  };
  const executions: {
    program: string;
    args: readonly string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }[] = [];
  const options: ApplicationRuntimeOptions = {
    dataRoot: join(root, "data"),
    modelDirectory,
    credentials,
    config: { apiVersion: 2, runtime: { extensions: [unused] } },
    settings: () => settings,
    emit: () => {},
    emitUI: () => {},
    defaultModel: { provider: "fixture", modelId: "fake" },
    harnessSettings: {
      retry: { enabled: false },
      compaction: { enabled: false },
    },
    createModels: async (identity) => {
      modelCreations++;
      const provider = ai.fauxProvider({
        provider: "fixture",
        models: [{ id: "fake" }, { id: "later" }],
        tokensPerSecond: Infinity,
      });
      const models = ai.createModels();
      models.setProvider(provider.provider);
      providers.set(identity.key, provider);
      return models;
    },
    execution: {
      shellProgram: "fixture-shell",
      which: (program) => program,
      runner: async (program, args, input = {}) => {
        spawns++;
        executions.push({
          program,
          args,
          cwd: input.cwd,
          env: input.env,
          timeout: input.timeout,
        });
        input.onOutput?.("stdout", "ordinary live output\n");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
    ...overrides,
  };
  const app = createApplicationRuntime(options);
  return {
    root,
    cwd,
    other,
    options,
    settings,
    app,
    ai,
    d,
    ctx,
    NativeApprovals,
    Todos,
    Delegations,
    createApplicationRuntime,
    credentials,
    providers,
    executions,
    network: () => network,
    modelCreations: () => modelCreations,
    spawns: () => spawns,
    async open(openId = "first") {
      await app.connect({ clientId: "fixture" });
      const snapshot = await app.host.open({ cwd, openId });
      const workspace = await app.host.workspace(cwd);
      const conversation = await workspace.conversation(snapshot.info.id);
      const provider = providers.get(workspace.identity.key);
      assert(provider);
      return { snapshot, workspace, conversation, provider };
    },
  };
}
async function until(
  check: () => boolean | Promise<boolean>,
  evidence?: () => Promise<unknown>,
) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    assert(
      Date.now() < deadline,
      `fixture condition timed out: ${JSON.stringify(await evidence?.())}`,
    );
    await Bun.sleep(5);
  }
}
async function assembly() {
  const f = await fixture();
  let explicit: ApplicationRuntime | undefined;
  try {
    assert.equal(f.modelCreations(), 0);
    await assert.rejects(readdir(f.options.dataRoot), /ENOENT/);
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    const b = await f.app.host.open({ cwd: f.other, openId: "other" });
    await f.app.ready(b.address);
    const wb = await f.app.host.workspace(f.other);
    assert.notEqual(wb.harness, a.workspace.harness);
    assert.notEqual(wb.models, a.workspace.models);
    assert.notEqual(wb.registry, a.workspace.registry);
    assert.match(a.snapshot.info.id, /^d2_[a-f0-9]{32}_[1-9][0-9]*$/);
    assert(a.workspace.registry.snapshot().extension("fixture.unselected"));
    const agent = await a.conversation.agent(f.ctx);
    assert(
      !agent.extensions.some(
        (extension) => extension.name === "fixture.unselected",
      ),
    );
    assert.deepEqual(
      agent.tools.map((tool) => tool.name),
      ["read", "write", "edit", "powershell", "todos"],
    );
    assert(agent.tools.every((tool) => tool.replay === "unsafe"));
    assert.equal(
      a.workspace.registry.snapshot().extension("pig.delegation"),
      undefined,
    );
    assert.deepEqual(
      agent.extensions.slice(-3).map((extension) => extension.name),
      ["pig.approvals", "pig.image-policy", "pig.tool-policy"],
    );
    assert.equal(
      (await a.workspace.harness.snapshot(f.Todos, a.conversation.id, f.ctx))
        ?.revision,
      0,
    );
    explicit = f.createApplicationRuntime({
      ...f.options,
      dataRoot: join(f.root, "explicit-data"),
      config: {
        apiVersion: 2,
        runtime: {
          profiles: { empty: { extensions: [], tools: [] } },
          defaultProfile: "empty",
        },
      },
    });
    const empty = await explicit.host.open({ cwd: f.cwd, openId: "empty" });
    await explicit.ready(empty.address);
    const ws = await explicit.host.workspace(f.cwd);
    assert.deepEqual(
      (await (await ws.conversation(empty.info.id)).agent(f.ctx)).tools,
      [],
    );
    assert.equal(f.spawns(), 0);
    assert.equal(f.network(), 0);
  } finally {
    await f.app.dispose();
    await explicit?.dispose();
  }
}
function assertShellOffer(
  tools: readonly { name: string }[],
  shell: "bash" | "powershell",
) {
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["read", "write", "edit", shell, "todos"].sort(),
  );
}
async function shellPreference() {
  const f = await fixture({ config: { apiVersion: 2 } }, "git-bash");
  const { BuiltinRuntimeManifest } = await import(
    "./application-compatibility"
  );
  const { operationHash } = await import("./native-tool-policy");
  const { durableStoragePath } = await import("./durable-storage");
  assert(f.options.execution);
  f.options.execution.commandPrefix = "fixture prefix";
  let app = f.app;
  let fresh: ApplicationRuntime | undefined;
  try {
    let a = await f.open();
    await app.ready(a.snapshot.address);
    await app.host.setModel({
      ...a.snapshot.address,
      provider: "fixture",
      id: "later",
    });
    await a.conversation.configure(
      { thinkingLevel: "high", cwd: f.other },
      f.ctx,
    );
    const state = await a.workspace.harness.snapshot(
      f.d.AgentDoc,
      a.conversation.id,
      f.ctx,
    );
    const registry = a.workspace.registry.snapshot();
    const manifest = await a.workspace.harness.snapshot(
      BuiltinRuntimeManifest,
      f.ctx,
    );
    assert(manifest?.signature);
    assert.equal(manifest.opaque, false);
    assert.equal(
      (
        await readFile(
          durableStoragePath({
            dataRoot: f.options.dataRoot,
            workspaceId: a.workspace.identity.key,
          }),
        )
      )
        .subarray(0, 16)
        .toString(),
      "SQLite format 3\0",
    );
    assert.deepEqual(
      registry.extension("pig.tools")?.tools?.map((tool) => tool.name),
      ["read", "write", "edit", "bash", "powershell"],
    );
    const run = async (
      name: "bash" | "powershell",
      id: string,
      changeDuringApproval?: Settings["shell"],
    ) => {
      const command = `${name} fixture only ${id}`;
      a.provider.setResponses([
        (context) => {
          assertShellOffer(f.ai.getCurrentTools(context.messages), name);
          return f.ai.fauxAssistantMessage(
            [f.ai.fauxToolCall(name, { command, timeout: 0.25 }, { id })],
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          assertShellOffer(
            f.ai.getCurrentTools(context.messages),
            f.settings.shell === "powershell" ? "powershell" : "bash",
          );
          return f.ai.fauxAssistantMessage(`done ${id}`);
        },
      ]);
      const input = {
        ...a.snapshot.address,
        requestId: id,
        text: `fixture ${id}`,
        draftRevision: app.host.drafts.read(a.snapshot.address).revision,
      };
      const before = f.spawns();
      await app.host.prompt(input);
      await until(
        () =>
          app.host.broker
            .pending()
            .some((request) => request.kind === "confirm"),
        () => a.workspace.entries(a.conversation),
      );
      const request = app.host.broker
        .pending()
        .find((entry) => entry.kind === "confirm");
      assert(request);
      const intent = Object.values(
        (
          await a.workspace.harness.snapshot(
            f.NativeApprovals,
            a.conversation.id,
            f.ctx,
          )
        )?.requests ?? {},
      ).find((entry) => entry.callId === id);
      assert(intent);
      assert.equal(intent.stage, "before-intent");
      assert.equal(intent.operationKind, "exec");
      assert.equal(f.spawns(), before);
      if (changeDuringApproval) f.settings.shell = changeDuringApproval;
      await app.resolveUI({ ...request, kind: "confirm", value: true });
      await a.conversation.waitForIdle(f.ctx);
      assert.equal(f.spawns(), before + (changeDuringApproval ? 0 : 1));
      if (!changeDuringApproval) {
        const actual = f.executions.at(-1);
        assert(actual);
        const script = `fixture prefix\n${command}`;
        assert.deepEqual(
          actual.args,
          name === "bash"
            ? ["-c", script]
            : [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n${script}`,
              ],
        );
        assert.equal(actual.program, "fixture-shell");
        assert.equal(
          actual.cwd?.toLowerCase(),
          a.workspace.identity.cwd.toLowerCase(),
        );
        assert.equal(actual.timeout, 250);
        assert.equal(actual.env?.RTK_TEE, "0");
        assert.equal(actual.env?.RTK_TELEMETRY_DISABLED, "1");
        assert.equal(
          intent.operationHash,
          operationHash({
            kind: "exec",
            transport: "rtk-proxy",
            program: actual.program,
            args: actual.args,
            cwd: actual.cwd,
            env: actual.env,
            timeoutMs: actual.timeout,
            script: name === "powershell" ? actual.args.at(-1) : script,
            policyRevision: intent.policyRevision,
          }),
        );
      }
      return { input, intent, receipt: await app.host.getReceipt(input) };
    };
    await run("bash", "initial-bash");
    const revoked = await run("bash", "revoked-bash", "powershell");
    assert(
      JSON.stringify(await a.workspace.entries(a.conversation)).includes(
        "policy changed while awaiting approval",
      ),
    );
    const ps = await run("powershell", "current-ps");
    assert.notEqual(ps.intent.policyRevision, revoked.intent.policyRevision);
    assert.equal(a.workspace.registry.snapshot(), registry); // No publication for a settings edit.
    assert.deepEqual(
      await a.workspace.harness.snapshot(
        f.d.AgentDoc,
        a.conversation.id,
        f.ctx,
      ),
      state,
    );
    const next = await app.host.open({
      cwd: f.cwd,
      openId: "new-ps-admission",
    });
    const nextAgent = await (
      await a.workspace.conversation(next.info.id)
    ).agent(f.ctx);
    assert(nextAgent.tools.some((tool) => tool.name === "powershell"));
    assert(!nextAgent.callable.some((tool) => tool.name === "bash"));
    await app.host.close(next.address);
    const reloaded = await app.reload({ apiVersion: 2 });
    assert.equal(reloaded.state, "applied", JSON.stringify(reloaded));
    assert.deepEqual(
      await a.workspace.harness.snapshot(BuiltinRuntimeManifest, f.ctx),
      manifest,
    );
    // Fresh PS preference has the identical complete native metadata signature.
    fresh = f.createApplicationRuntime({
      ...f.options,
      dataRoot: join(f.root, "fresh-ps"),
    });
    await fresh.host.open({ cwd: f.cwd, openId: "fresh-ps" });
    const freshWorkspace = await fresh.host.workspace(f.cwd);
    assert.deepEqual(
      await freshWorkspace.harness.snapshot(BuiltinRuntimeManifest, f.ctx),
      manifest,
    );
    await fresh.dispose();
    fresh = undefined;
    const entries = await a.workspace.entries(a.conversation);
    const agent = await a.conversation.agent(f.ctx);
    const originalId = a.conversation.id;
    await app.dispose();
    app = f.createApplicationRuntime(f.options); // Same SQLite, different preference from first assembly.
    await app.connect({ clientId: "restarted" });
    const snapshot = await app.host.open({
      cwd: f.cwd,
      id: a.snapshot.info.id,
      openId: "restart-ps",
    });
    await app.ready(snapshot.address);
    const workspace = await app.host.workspace(f.cwd);
    const conversation = await workspace.conversation(snapshot.info.id);
    const provider = f.providers.get(workspace.identity.key);
    assert(provider);
    a = { snapshot, workspace, conversation, provider };
    assert.equal(conversation.id, originalId);
    assert.deepEqual(await workspace.entries(conversation), entries);
    const restoredAgent = await conversation.agent(f.ctx);
    assert.deepEqual(restoredAgent.model, agent.model);
    assert.equal(restoredAgent.thinkingLevel, "high");
    assert.deepEqual(
      await workspace.harness.snapshot(f.d.AgentDoc, conversation.id, f.ctx),
      state,
    );
    assert.deepEqual(
      await app.host.getReceipt({ ...ps.input, ...snapshot.address }),
      { ...ps.receipt, ...snapshot.address },
    );
    await app.host.prompt({ ...ps.input, ...snapshot.address }); // Durable duplicate, not a new request.
    assert.equal(provider.state.callCount, 0);
    await run("powershell", "after-restart-ps");
    f.settings.shell = "git-bash";
    await run("bash", "toggled-back-bash");
    const back = await app.reload({ apiVersion: 2 });
    assert.equal(back.state, "applied", JSON.stringify(back));
    assert.deepEqual(
      await workspace.harness.snapshot(BuiltinRuntimeManifest, f.ctx),
      manifest,
    );
    assert.equal(f.network(), 0);
  } finally {
    await app.dispose();
    await fresh?.dispose();
  }
}
async function shellSelection() {
  const d = await import("@earendil-works/pi-durable");
  const native = await import("@earendil-works/pi-durable/tools");
  let nestedCalls = 0;
  const probe = d.defineTool({
    name: "nested_probe",
    description: "Fixture nested caller",
    parameters: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
    async execute(args, api, context) {
      assert(
        args &&
          typeof args === "object" &&
          "name" in args &&
          typeof args.name === "string",
      );
      nestedCalls++;
      const result = await api.executeTool(
        args.name,
        { command: "fixture nested only" },
        context,
      );
      return {
        structuredOutput: result.structuredOutput,
        isError: result.isError,
        diagnostics: result.diagnostics,
      };
    },
  });
  const read = native.createReadTool(),
    bash = native.createBashTool(),
    ps = (await import("./shell-tools")).desktopShellTool({
      shell: "powershell",
      shellProgram: "fixture-shell",
    });
  const extension = d.defineExtension({
    name: "fixture.nested",
    tools: [read, bash, ps, probe],
  });
  let app: ApplicationRuntime;
  const f = await fixture(
    {
      config: {
        apiVersion: 2,
        runtime: {
          extensions: [extension],
          profiles: {
            custom: {
              extensions: [extension],
              tools: [read, bash, ps, probe],
              modelTools: [read, bash, probe],
              model: { provider: "fixture", modelId: "fake" },
              thinkingLevel: "off",
            },
          },
          defaultProfile: "custom",
        },
      },
      emitUI: allowToolRequests(() => app),
    },
    "git-bash",
  );
  app = f.app;
  try {
    const a = await f.open();
    await app.ready(a.snapshot.address);
    assert.deepEqual(
      (await a.conversation.agent(f.ctx)).tools.map((tool) => tool.name),
      ["read", "bash", "nested_probe"],
    );
    f.settings.shell = "powershell";
    const agent = await a.conversation.agent(f.ctx);
    assert.deepEqual(
      agent.tools.map((tool) => tool.name),
      ["read", "nested_probe"],
    ); // No injection into modelTools.
    assert.deepEqual(
      agent.callable.map((tool) => tool.name),
      ["read", "powershell", "nested_probe"],
    );
    for (const tool of agent.callable) {
      assert.equal(tool.replay, "unsafe");
      for (const name of ["pig.image-policy", "pig.tool-policy"]) {
        const policy = agent.extensions.find((entry) => entry.name === name);
        assert(
          policy?.wraps?.some(
            (wrap) => "tool" in wrap && wrap.tool === tool.name,
          ),
        );
      }
    }
    for (const [index, name] of ["bash", "powershell"].entries()) {
      a.provider.setResponses([
        (context) => {
          assert.deepEqual(
            f.ai.getCurrentTools(context.messages).map((tool) => tool.name),
            ["read", "nested_probe"],
          );
          return f.ai.fauxAssistantMessage(
            [
              f.ai.fauxToolCall(
                "nested_probe",
                { name },
                { id: `nested-${name}` },
              ),
            ],
            { stopReason: "toolUse" },
          );
        },
        f.ai.fauxAssistantMessage("nested done"),
      ]);
      await app.host.prompt({
        ...a.snapshot.address,
        requestId: `nested-${name}`,
        text: "fixture",
        draftRevision: app.host.drafts.read(a.snapshot.address).revision,
      });
      await a.conversation.waitForIdle(f.ctx);
      assert.equal(nestedCalls, index + 1);
      assert.equal(f.spawns(), index); // Inactive Bash rejected; hidden-but-callable PS is not an allowlist denial.
    }
    assert(
      JSON.stringify(await a.workspace.entries(a.conversation)).includes(
        "Tool bash is not callable",
      ),
    );
    a.provider.setResponses([
      f.ai.fauxAssistantMessage(
        [
          f.ai.fauxToolCall(
            "bash",
            { command: "must not run" },
            { id: "inactive-direct" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      f.ai.fauxAssistantMessage("denied"),
    ]);
    await app.host.prompt({
      ...a.snapshot.address,
      requestId: "inactive-direct",
      text: "fixture",
      draftRevision: app.host.drafts.read(a.snapshot.address).revision,
    });
    await a.conversation.waitForIdle(f.ctx);
    assert.equal(f.spawns(), 1);
    assert(
      JSON.stringify(await a.workspace.entries(a.conversation)).includes(
        "tool_unavailable",
      ),
    );
    // Explicit enabled tools are an intersection too; preference must not add PS back.
    const selected = await a.conversation.agent(f.ctx);
    const registrations = a.workspace.registry
      .snapshot()
      .extension("pig.tools")?.tools;
    const selectedRead = registrations?.find((tool) => tool.name === "read");
    const selectedBash = registrations?.find((tool) => tool.name === "bash");
    assert(selectedRead && selectedBash);
    await a.conversation.configure(
      { tools: [selectedRead, selectedBash, probe] },
      f.ctx,
    );
    assert.deepEqual(
      (await a.conversation.agent(f.ctx)).callable.map((tool) => tool.name),
      ["read", "nested_probe"],
    );
    assert(selected.callable.some((tool) => tool.name === "powershell"));
    assert.equal(f.network(), 0);
  } finally {
    await app.dispose();
  }
}
async function approvals() {
  const f = await fixture();
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    await a.conversation.configure({ cwd: f.other }, f.ctx); // Never a new filesystem/exec grant.
    a.provider.setResponses([
      f.ai.fauxAssistantMessage(
        [
          f.ai.fauxToolCall(
            "powershell",
            { command: "fixture only" },
            { id: "shell-call" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      f.ai.fauxAssistantMessage("done"),
    ]);
    await f.app.host.prompt({
      ...a.snapshot.address,
      requestId: "shell",
      text: "fixture",
      draftRevision: 0,
    });
    await until(
      () =>
        f.app.host.broker
          .pending()
          .some((request) => request.kind === "confirm"),
      async () => a.workspace.entries(a.conversation),
    );
    const first = f.app.host.broker
      .pending()
      .find((request) => request.kind === "confirm");
    assert(first);
    assert.equal(f.spawns(), 0);
    const state = await a.workspace.harness.snapshot(
      f.NativeApprovals,
      a.conversation.id,
      f.ctx,
    );
    assert.equal(
      Object.values(state?.requests ?? {})[0]?.stage,
      "before-intent",
    );
    await f.app.host.close(a.snapshot.address);
    assert.equal(
      Object.values(
        (
          await a.workspace.harness.snapshot(
            f.NativeApprovals,
            a.conversation.id,
            f.ctx,
          )
        )?.requests ?? {},
      )[0]?.state,
      "pending",
    );
    const next = await f.app.host.open({
      cwd: f.cwd,
      id: a.snapshot.info.id,
      openId: "reattach",
    });
    await f.app.ready(next.address);
    const request = f.app.host.broker
      .pending()
      .find((entry) => entry.kind === "confirm");
    assert(request);
    assert.notEqual(request.uiId, first.uiId);
    await f.app.resolveUI({ ...request, kind: "confirm", value: true });
    await a.conversation.waitForIdle(f.ctx);
    assert.equal(f.spawns(), 1);
    const executedCwd = f.executions[0]?.cwd;
    assert.equal(
      process.platform === "win32" ? executedCwd?.toLowerCase() : executedCwd,
      a.workspace.identity.cwd,
    );
    assert(f.executions[0]?.args.includes("-Command"));
    const entries = JSON.stringify(await a.workspace.entries(a.conversation));
    assert(entries.includes("ordinary live output"), entries);
    assert.equal(f.network(), 0);
    // Removing mandatory selections cannot bypass even the base callable registrations.
    const nativeTools = a.workspace.registry.snapshot().extension("pig.tools");
    assert(nativeTools);
    await a.conversation.configure({ extensions: [nativeTools] }, f.ctx);
    await assert.rejects(
      f.app.host.prompt({
        ...next.address,
        requestId: "no-policy",
        text: "blocked",
        draftRevision: f.app.host.drafts.read(next.address).revision,
      }),
      /POLICY_SELECTION_REQUIRED/,
    );
    assert.equal(f.spawns(), 1);
  } finally {
    await f.app.dispose();
  }
}
async function images() {
  const started = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  let decodes = 0;
  const f = await fixture({
    imageProcessor: {
      prepare: async () => {
        decodes++;
        throw new Error("Blocked image must not decode");
      },
    },
  });
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    a.provider.setResponses([
      async () => {
        started.resolve();
        await finish.promise;
        return f.ai.fauxAssistantMessage("one");
      },
      f.ai.fauxAssistantMessage("two"),
    ]);
    const image = {
      type: "image" as const,
      data: Buffer.from("blocked fixture image").toString("base64"),
      mimeType: "image/png",
    };
    const first = {
      ...a.snapshot.address,
      requestId: "idle-image",
      text: "one",
      images: [image],
      draftRevision: 0,
    };
    await f.app.host.prompt(first);
    await started.promise;
    const queued = {
      ...a.snapshot.address,
      requestId: "queued-image",
      text: "two",
      images: [image],
      draftRevision: f.app.host.drafts.read(a.snapshot.address).revision,
    };
    assert.equal((await f.app.host.prompt(queued)).disposition, "queued");
    await assert.rejects(
      f.app.host.prompt({ ...first, images: [] }),
      /REQUEST_ID_CONFLICT/,
    );
    finish.resolve();
    await a.conversation.waitForIdle(f.ctx);
    const history = JSON.stringify(await a.workspace.entries(a.conversation));
    assert(!history.includes(image.data));
    assert(history.includes("Image removed"));
    assert.equal(decodes, 0);
    assert.equal((await f.app.host.getReceipt(queued)).state, "accepted");
  } finally {
    finish.resolve();
    await f.app.dispose();
  }
}
async function resources() {
  const root = process.env.PIG_P0_ROOT;
  assert(root);
  const instruction = join(root, "project", "selected.md"),
    prompt = join(root, "global-prompt.md");
  await mkdir(join(root, "project"), { recursive: true });
  await writeFile(instruction, "EXPLICIT_PROJECT_BYTES");
  await writeFile(prompt, "---\nname: question\n---\nApproved $1");
  const f = await fixture({
    config: {
      apiVersion: 2,
      runtime: {
        resources: () => ({
          global: { instructions: [], skills: [], prompts: [prompt] },
          project: { instructions: [instruction], skills: [], prompts: [] },
        }),
      },
    },
  });
  try {
    assert.equal(f.modelCreations(), 0);
    assert.equal((await f.app.selectedProjectResources(f.cwd)).length, 1);
    assert.equal(f.modelCreations(), 0); // Inspection does not open storage/models or apply bytes.
    const a = await f.open();
    await until(() =>
      f.app.host.broker
        .pending()
        .some((request) => request.kind === "project-trust"),
    );
    let sent = false;
    const contexts: unknown[] = [];
    a.provider.setResponses([
      async (context) => {
        contexts.push(context);
        return f.ai.fauxAssistantMessage("approved");
      },
    ]);
    const sending = f.app.host
      .prompt({
        ...a.snapshot.address,
        requestId: "resource-input",
        text: "/question evidence",
        draftRevision: 0,
      })
      .then(() => {
        sent = true;
      });
    await Bun.sleep(20);
    assert(!sent);
    assert.equal(a.provider.state.callCount, 0);
    const request = f.app.host.broker
      .pending()
      .find((entry) => entry.kind === "project-trust");
    assert(request);
    await f.app.resolveUI({ ...request, kind: "project-trust", value: "once" });
    await sending;
    await a.conversation.waitForIdle(f.ctx);
    assert(JSON.stringify(contexts).includes("EXPLICIT_PROJECT_BYTES"));
    assert(JSON.stringify(contexts).includes("Approved evidence"));
    assert.equal(f.network(), 0);
  } finally {
    await f.app.dispose();
  }
}
async function reload() {
  const root = process.env.PIG_P0_ROOT;
  assert(root);
  const file = join(root, "pig.config.ts");
  const { ConfigLoader } = await import("./config-loader");
  const loader = new ConfigLoader(file);
  const source = (instructions: string) => `
    import { defineConfig, type PigConfig } from '@pig/config';
    const instructions: string = ${JSON.stringify(instructions)};
    const config: PigConfig = { apiVersion: 2, runtime: {
      profiles: { selected: { extensions: [], tools: [], instructions,
        model: { provider: 'fixture', modelId: 'fake' }, thinkingLevel: 'off' } },
      defaultProfile: 'selected'
    } };
    export default defineConfig(config);
  `;
  await writeFile(file, source("first actual TS candidate"));
  const f = await fixture({
    configLoader: loader,
    checkCompatibility: async () => undefined,
  });
  try {
    const initial = await f.app.reload();
    assert.equal(
      initial.state,
      "applied",
      JSON.stringify({ initial, file, cwd: process.cwd() }),
    );
    assert.equal(
      loader.accepted?.config.runtime?.profiles?.selected.instructions,
      "first actual TS candidate",
    );
    await writeFile(file, source("reloaded actual TS candidate"));
    const updated = await f.app.reload();
    assert.equal(updated.state, "applied", JSON.stringify(updated));
    assert.equal(
      loader.accepted?.config.runtime?.profiles?.selected.instructions,
      "reloaded actual TS candidate",
    );
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    assert.equal(
      (await a.conversation.agent(f.ctx)).instructions,
      "reloaded actual TS candidate",
    );
    await writeFile(file, source("live workspace TS candidate"));
    const live = await f.app.reload();
    assert.equal(live.state, "applied", JSON.stringify(live));
    assert.equal(
      a.workspace.runtime.profiles?.selected.instructions,
      "live workspace TS candidate",
    );
    const accepted = loader.accepted;
    const lastRegistry = a.workspace.registry,
      lastModels = a.workspace.models;
    await writeFile(file, "export default { apiVersion: 1 };");
    const rejected = await f.app.reload();
    assert.equal(rejected.state, "failed");
    assert.equal(loader.accepted, accepted);
    assert.equal(a.workspace.registry, lastRegistry);
    assert.equal(a.workspace.models, lastModels);
    assert.equal(
      a.workspace.runtime.profiles?.selected.instructions,
      "live workspace TS candidate",
    );
    assert((await f.app.host.getSnapshot(a.snapshot.address)).sessionUI);
    // An independent host without compatibility proof must retain its native last-good runtime.
    const unknown = f.createApplicationRuntime({
      ...f.options,
      configLoader: undefined,
      dataRoot: join(root, "unknown"),
      checkCompatibility: undefined,
    });
    try {
      await unknown.host.open({ cwd: f.cwd, openId: "unknown" });
      const workspace = await unknown.host.workspace(f.cwd);
      const previous = workspace.registry;
      const result = await unknown.reload({ apiVersion: 2, runtime: {} });
      assert.equal(result.state, "pending");
      assert.match(result.reason ?? "", /COMPATIBILITY_UNKNOWN/);
      assert.equal(workspace.registry, previous);
    } finally {
      await unknown.dispose();
    }
    // Provider instances are not made fresh by spreading their outer records.
    const external = f.ai.fauxProvider({ provider: "external" }).provider;
    const raw = f.createApplicationRuntime({
      ...f.options,
      configLoader: undefined,
      configFile: undefined,
      dataRoot: join(root, "raw"),
      config: { apiVersion: 2, runtime: { providers: [external] } },
    });
    try {
      await assert.rejects(
        raw.host.workspace(f.cwd),
        /PROVIDER_FACTORY_REQUIRED/,
      );
    } finally {
      await raw.dispose();
    }
    const reused = f.createApplicationRuntime({
      ...f.options,
      configFile: undefined,
      dataRoot: join(root, "reused"),
      createProviders: async () => [external],
    });
    try {
      await reused.host.workspace(f.cwd);
      await assert.rejects(
        reused.host.workspace(f.other),
        /PROVIDER_INSTANCE_REUSED/,
      );
    } finally {
      await reused.dispose();
    }
  } finally {
    await f.app.dispose();
  }
}
async function lifecycle() {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let cleanups = 0;
  const f = await fixture({
    attachNativeUI: async () => {
      entered.resolve();
      await release.promise;
      return () => {
        cleanups++;
      };
    },
  });
  try {
    const a = await f.open();
    await entered.promise;
    const closing = f.app.host.close(a.snapshot.address);
    release.resolve();
    await closing;
    assert.equal(cleanups, 1);
    await assert.rejects(
      f.app.ready(a.snapshot.address),
      /STALE_APPLICATION_PROJECTION/,
    );
    await f.app.dispose();
    await f.app.dispose();
    assert.equal(cleanups, 1);
  } finally {
    release.resolve();
    await f.app.dispose();
  }
  const broken = await fixture({
    dataRoot: join(f.root, "broken-data"),
    attachNativeUI: async () => {
      throw new Error("projection failed");
    },
  });
  try {
    const a = await broken.open();
    await assert.rejects(
      broken.app.ready(a.snapshot.address),
      /projection failed/,
    );
    await assert.rejects(
      broken.app.host.prompt({
        ...a.snapshot.address,
        requestId: "failed-projection",
        text: "retain",
        draftRevision: 0,
      }),
      /projection failed/,
    );
    assert.equal(a.provider.state.callCount, 0);
  } finally {
    await broken.app.dispose();
  }
}
async function auth() {
  const f = await fixture({ createModels: undefined });
  try {
    process.env.OPENAI_API_KEY = "ambient-fixture";
    process.env.ANTHROPIC_API_KEY = "ambient-fixture";
    const cli = join(f.root, ".pi", "agent");
    await mkdir(cli, { recursive: true });
    await writeFile(
      join(cli, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "cli-fixture" } }),
    );
    const workspace = await f.app.host.workspace(f.cwd);
    assert.equal(await workspace.models.getAuth("anthropic"), undefined);
    assert.equal(await workspace.models.getAuth("openai-api"), undefined);
    await f.credentials.modify("anthropic", async () => ({
      type: "api_key",
      key: "app-fixture",
    }));
    assert.equal(
      (await workspace.models.getAuth("anthropic"))?.auth.apiKey,
      "app-fixture",
    );
    assert.equal(f.network(), 0);
    assert.equal(f.spawns(), 0);
    assert.equal(
      JSON.parse(await readFile(join(cli, "auth.json"), "utf8")).anthropic.key,
      "cli-fixture",
    );
  } finally {
    await f.app.dispose();
  }
}
function allowToolRequests(
  getApp: () => ApplicationRuntime,
): ApplicationRuntimeOptions["emitUI"] {
  return (event) => {
    if (event.type === "request" && event.request.kind === "confirm") {
      const request = event.request;
      queueMicrotask(() => {
        void getApp().resolveUI({ ...request, kind: "confirm", value: true });
      });
    }
  };
}
async function delegation() {
  let app: ApplicationRuntime;
  const f = await fixture({
    research: { model: { provider: "fixture", modelId: "fake" } },
    emitUI: allowToolRequests(() => app),
  });
  app = f.app;
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    a.provider.setResponses([
      f.ai.fauxAssistantMessage(
        [
          f.ai.fauxToolCall(
            "delegate",
            { task: "Read-only question" },
            { id: "delegate-call" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      f.ai.fauxAssistantMessage(
        "Conclusion: fixture only. Evidence: no side effects. Unresolved: none.",
      ),
      f.ai.fauxAssistantMessage("parent done"),
    ]);
    await f.app.host.prompt({
      ...a.snapshot.address,
      requestId: "delegate",
      text: "fixture",
      draftRevision: 0,
    });
    await a.conversation.waitForIdle(f.ctx);
    const state = await a.workspace.harness.snapshot(
      f.Delegations,
      a.conversation.id,
      f.ctx,
    );
    assert.equal(
      state?.runs.length,
      1,
      JSON.stringify(await a.workspace.entries(a.conversation)),
    );
    assert.equal(state?.runs[0]?.outcome, "success", JSON.stringify(state));
    const saved = state?.runs[0];
    assert(saved);
    const child = await a.workspace.harness.conversation(saved.childId, f.ctx);
    assert(child);
    const agent = await child.agent(f.ctx);
    assert.deepEqual(
      agent.tools.map((tool) => tool.name),
      ["read"],
    );
    assert(!agent.callable.some((tool) => tool.name !== "read"));
    assert.equal(agent.maxTurns, 8);
    assert.equal(f.spawns(), 0);
  } finally {
    await f.app.dispose();
  }
}
async function reconnect() {
  let now = 1;
  let nativeUI: import("./extension-ui").NativeUI | undefined;
  let mounts = 0;
  const f = await fixture({
    connectionNow: () => now,
    attachNativeUI: ({ ui }) => {
      nativeUI = ui;
      mounts++;
      ui.setStatus("fixture", "mounted");
    },
  });
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    const input = {
      ...a.snapshot.address,
      requestId: "pending-reconnect",
      text: "fixture only",
      draftRevision: 0,
    };
    a.provider.setResponses([
      f.ai.fauxAssistantMessage(
        [
          f.ai.fauxToolCall(
            "powershell",
            { command: "injected fixture only" },
            { id: "reconnect-call" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      f.ai.fauxAssistantMessage("finished once"),
    ]);
    await f.app.host.prompt(input);
    const draft = f.app.host.draft({
      ...a.snapshot.address,
      expectedRevision: f.app.host.drafts.read(a.snapshot.address).revision,
      content: { text: "unsent survives", pastes: [], images: [] },
    }).draft;
    await until(() =>
      f.app.host.broker.pending().some((request) => request.kind === "confirm"),
    );
    const initial = f.app.host.broker
      .pending()
      .find((request) => request.kind === "confirm");
    assert(initial);
    const state = () =>
      a.workspace.harness.snapshot(f.NativeApprovals, a.conversation.id, f.ctx);
    const intent = Object.values((await state())?.requests ?? {})[0];
    assert(intent);
    await f.app.connect({ clientId: "second-root" });
    assert.equal(f.app.host.broker.pending()[0]?.uiId, initial.uiId);
    f.app.host.disconnect({ clientId: "fixture" });
    assert.equal(f.app.host.broker.pending()[0]?.uiId, initial.uiId);
    assert(nativeUI);
    const ordinary = nativeUI.confirm(
      "Native dialog",
      "Disposable, not a permission decision",
    );
    f.app.host.disconnectAll();
    assert.equal(await ordinary, false);
    await assert.rejects(f.app.ready(a.snapshot.address), /DETACHED/);
    assert.equal(f.spawns(), 0);
    assert.deepEqual(Object.values((await state())?.requests ?? {})[0], intent);
    const task = await a.workspace.harness.getTask(intent.taskId, f.ctx);
    assert(task);
    assert.equal(task.abortRequested, false);
    assert.notEqual(task.state.status, "terminal");
    await assert.rejects(
      f.app.resolveUI({ ...initial, kind: "confirm", value: true }),
      /unknown|completed|stale/i,
    );
    await f.app.connect({ clientId: "restored-root" });
    await f.app.ready(a.snapshot.address);
    const restored = f.app.host.broker
      .pending()
      .find((request) => request.kind === "confirm");
    assert(restored);
    assert.notEqual(restored.uiId, initial.uiId);
    assert.deepEqual(Object.values((await state())?.requests ?? {})[0], intent);
    assert.deepEqual(f.app.host.drafts.read(a.snapshot.address), draft);
    assert.equal(mounts, 1);
    assert.equal(
      f.app.host.runtimeState().statuses[0]?.status.statuses[0]?.text,
      "mounted",
    );
    // Expiry detected inside connect must also restore, even before the lease timer's next tick.
    now += 31_000;
    await f.app.connect({ clientId: "after-expiry" });
    await f.app.ready(a.snapshot.address);
    const expired = f.app.host.broker
      .pending()
      .find((request) => request.kind === "confirm");
    assert(expired);
    assert.notEqual(expired.uiId, restored.uiId);
    await assert.rejects(
      f.app.resolveUI({ ...restored, kind: "confirm", value: true }),
      /unknown|completed|stale/i,
    );
    assert.deepEqual(Object.values((await state())?.requests ?? {})[0], intent);
    await f.app.resolveUI({ ...expired, kind: "confirm", value: true });
    await a.conversation.waitForIdle(f.ctx);
    assert.equal(f.spawns(), 1);
    assert.equal(a.provider.state.callCount, 2);
    assert.deepEqual(f.app.host.drafts.read(a.snapshot.address), draft);
    assert.deepEqual(
      (await f.app.host.getSnapshot(a.snapshot.address)).address,
      a.snapshot.address,
    );
    await f.app.host.prompt(input); // Existing durable receipt, never a new submission.
    assert.equal(f.spawns(), 1);
    assert.equal(a.provider.state.callCount, 2);
  } finally {
    await f.app.dispose();
  }
}
async function reconnectFailure() {
  const f = await fixture();
  const { spyOn } = await import("bun:test");
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    f.app.host.disconnectAll();
    const watch = spyOn(a.workspace.harness, "watchDoc").mockRejectedValueOnce(
      new Error("reconnect watch unavailable"),
    );
    try {
      await assert.rejects(
        f.app.connect({ clientId: "failed-root" }),
        /RECONNECT_FAILED/,
      );
      await assert.rejects(
        f.app.ready(a.snapshot.address),
        /reconnect watch unavailable/,
      );
      assert.equal(f.app.host.broker.isAvailable(), false);
      assert.equal(a.provider.state.callCount, 0);
      assert.equal(f.spawns(), 0);
    } finally {
      watch.mockRestore();
    }
  } finally {
    await f.app.dispose();
  }
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let cleanups = 0;
  const late = await fixture({
    dataRoot: join(f.root, "late-reconnect"),
    attachNativeUI: async () => {
      entered.resolve();
      await release.promise;
      return () => {
        cleanups++;
      };
    },
  });
  try {
    const a = await late.open();
    await entered.promise;
    late.app.host.disconnectAll();
    const connecting = late.app.connect({ clientId: "late-root" });
    const rejected = assert.rejects(connecting, /RECONNECT_FAILED/);
    const closing = late.app.host.close(a.snapshot.address);
    release.resolve();
    await closing;
    await rejected;
    assert.equal(cleanups, 1);
    assert.equal(late.app.host.broker.pending().length, 0);
  } finally {
    release.resolve();
    await late.app.dispose();
  }
}
async function inheritResearch() {
  let app: ApplicationRuntime;
  const f = await fixture({
    defaultModel: undefined,
    research: { inheritParent: true },
    emitUI: allowToolRequests(() => app),
  });
  app = f.app;
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    const definition = a.workspace.registry
      .snapshot()
      .extension("pig.research");
    assert(definition);
    assert.equal((await a.conversation.agent(f.ctx)).model, undefined);
    await assert.rejects(
      f.app.host.prompt({
        ...a.snapshot.address,
        requestId: "no-model",
        text: "no dispatch",
        draftRevision: 0,
      }),
      /available model/,
    );
    assert.equal(a.provider.state.callCount, 0);
    const ask = (id: string) =>
      f.ai.fauxAssistantMessage(
        [f.ai.fauxToolCall("delegate", { task: `Read-only ${id}` }, { id })],
        { stopReason: "toolUse" },
      );
    for (const [index, modelId] of ["fake", "later"].entries()) {
      f.settings.shell = index === 0 ? "git-bash" : "powershell";
      await f.app.host.setModel({
        ...a.snapshot.address,
        provider: "fixture",
        id: modelId,
      });
      a.provider.setResponses([
        ask(`inherit-${index}`),
        f.ai.fauxAssistantMessage(`Conclusion: ${modelId}`),
        f.ai.fauxAssistantMessage("parent done"),
      ]);
      await f.app.host.prompt({
        ...a.snapshot.address,
        requestId: `inherit-${index}`,
        text: "fixture",
        draftRevision: f.app.host.drafts.read(a.snapshot.address).revision,
      });
      await a.conversation.waitForIdle(f.ctx);
      const saved = (
        await a.workspace.harness.snapshot(
          f.Delegations,
          a.conversation.id,
          f.ctx,
        )
      )?.runs[index];
      assert(saved);
      assert.equal(saved.model, `fixture/${modelId}`);
      assert.equal(saved.outcome, "success", JSON.stringify(saved));
      const child = await a.workspace.harness.conversation(
        saved.childId,
        f.ctx,
      );
      assert(child);
      const agent = await child.agent(f.ctx);
      assert.equal(agent.model?.modelId, modelId);
      assert.equal(agent.maxTurns, 8);
      assert.deepEqual(
        agent.tools.map((tool) => tool.name),
        ["read"],
      );
      assert(!agent.callable.some((tool) => tool.name !== "read"));
      assert.equal(
        a.workspace.registry.snapshot().extension("pig.research"),
        definition,
      );
      const entries = await a.workspace.entries(child);
      assert.equal(
        entries.filter((entry) => f.d.UserEntry.is(entry)).length,
        1,
      ); // No parent transcript copying.
    }
    const calls = a.provider.state.callCount;
    // Model removed after a genuine parent request, before native ToolTask invocation.
    a.provider.setResponses([
      async () => {
        await a.conversation.configure({ model: null }, f.ctx);
        return ask("removed-model");
      },
    ]);
    await f.app.host.prompt({
      ...a.snapshot.address,
      requestId: "removed-model",
      text: "fixture",
      draftRevision: f.app.host.drafts.read(a.snapshot.address).revision,
    });
    await a.conversation.waitForIdle(f.ctx);
    assert.equal(a.provider.state.callCount, calls + 1); // No child provider dispatch.
    assert.equal(
      (
        await a.workspace.harness.snapshot(
          f.Delegations,
          a.conversation.id,
          f.ctx,
        )
      )?.runs.length,
      2,
    );
    const conversations = await a.workspace.harness.commit(
      (tx) => tx.scanConversations({}, 10),
      f.ctx,
    );
    assert.equal(conversations.items.length, 3); // Root plus the two authorized children only.
    assert(
      JSON.stringify(await a.workspace.entries(a.conversation)).includes(
        "DELEGATION_MODEL_UNAVAILABLE",
      ),
    );
    assert.equal(f.spawns(), 0);
    assert.equal(f.network(), 0);
  } finally {
    await f.app.dispose();
  }
}
async function configuredBoundaries() {
  const { fauxProvider } = await import("@earendil-works/pi-ai");
  const contexts: unknown[] = [];
  let changed = false;
  const f = await fixture({
    config: {
      apiVersion: 2,
      runtime: {
        providerFactories: [
          async (context) => {
            contexts.push(context);
            return fauxProvider({ provider: "configured" }).provider;
          },
        ],
        resources: ({ cwd }) => ({
          global: { instructions: [], skills: [], prompts: [] },
          project: {
            instructions: changed ? [join(cwd, "changed.md")] : [],
            skills: [],
            prompts: [],
          },
        }),
      },
    },
    checkCompatibility: async () => undefined,
  });
  try {
    assert.equal(contexts.length, 0);
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    const b = await f.app.host.workspace(f.other);
    assert.equal(contexts.length, 2);
    assert.notEqual(
      a.workspace.models.getProvider("configured"),
      b.models.getProvider("configured"),
    );
    assert(
      contexts.every(
        (context) => (context as { scope: string }).scope === "workspace",
      ),
    );
    const before = a.workspace.registry;
    changed = true;
    const rejected = await f.app.reload(f.options.config);
    assert.equal(rejected.state, "failed");
    assert.match(rejected.reason ?? "", /RESOURCE_SELECTION_RESTART_REQUIRED/);
    assert.equal(a.workspace.registry, before);
    assert.deepEqual(await f.app.selectedProjectResources(f.cwd), []);
    assert.equal(f.network(), 0);
    assert.equal(f.spawns(), 0);
  } finally {
    await f.app.dispose();
  }
}
async function toolPermissions() {
  const f = await fixture();
  try {
    const a = await f.open();
    await f.app.ready(a.snapshot.address);
    const initial = await a.workspace.harness.snapshot(
      f.Todos,
      a.conversation.id,
      f.ctx,
    );
    for (const [index, allowed] of [false, true].entries()) {
      a.provider.setResponses([
        f.ai.fauxAssistantMessage(
          f.ai.fauxToolCall(
            "todos",
            {
              expectedRevision: 0,
              items: [
                { id: "one", title: "Explicit permission", state: "pending" },
              ],
            },
            { id: `todos-${index}` },
          ),
          { stopReason: "toolUse" },
        ),
        f.ai.fauxAssistantMessage("done"),
      ]);
      await f.app.host.prompt({
        ...a.snapshot.address,
        requestId: `todos-${index}`,
        text: "fixture",
        draftRevision: f.app.host.drafts.read(a.snapshot.address).revision,
      });
      await until(() =>
        f.app.host.broker
          .pending()
          .some((request) => request.kind === "confirm"),
      );
      const request = f.app.host.broker
        .pending()
        .find((request) => request.kind === "confirm");
      assert(request && request.kind === "confirm");
      const pending = await a.workspace.harness.snapshot(
        f.NativeApprovals,
        a.conversation.id,
        f.ctx,
      );
      assert(
        Object.values(pending?.requests ?? {}).some(
          (intent) =>
            intent.operationKind === "tool" &&
            intent.toolName === "todos" &&
            intent.state === "pending",
        ),
      );
      assert.equal(
        (await a.workspace.harness.snapshot(f.Todos, a.conversation.id, f.ctx))
          ?.revision,
        initial?.revision,
      );
      await f.app.resolveUI({ ...request, kind: "confirm", value: allowed });
      await a.conversation.waitForIdle(f.ctx);
      const saved = await a.workspace.harness.snapshot(
        f.Todos,
        a.conversation.id,
        f.ctx,
      );
      assert.equal(saved?.revision, allowed ? 1 : 0);
      assert.equal(saved?.items.length, allowed ? 1 : 0);
    }
    assert.equal(f.spawns(), 0);
    assert.equal(f.network(), 0);
  } finally {
    await f.app.dispose();
  }
}
if (import.meta.main) {
  const mode = process.argv[2];
  const modes = {
    assembly,
    approvals,
    images,
    resources,
    reload,
    lifecycle,
    auth,
    delegation,
    reconnect,
    reconnectFailure,
    inheritResearch,
    configuredBoundaries,
    toolPermissions,
    shellPreference,
    shellSelection,
  };
  if (!mode || !Object.hasOwn(modes, mode))
    throw new Error("Unknown application fixture");
  await modes[mode as keyof typeof modes]();
  console.log(`PASS ${mode}`);
}
