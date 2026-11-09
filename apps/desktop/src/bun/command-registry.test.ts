import { expect, test } from "bun:test";
import type {
  CommandContext,
  CommandConversation,
  HostCommand,
} from "../../../../packages/config/src";
import { CommandRegistry, type CommandRegistryPort } from "./command-registry";

function fixture(commands: HostCommand[], builtins: HostCommand[] = []) {
  let streaming = false;
  let current = true;
  let confirmed = true;
  let releases = 0;
  const conversation: CommandConversation = {
    session: { id: "one", cwd: "" },
    sources: {
      conversation() {
        throw new Error("Not needed");
      },
      taskGraph: () => ({ tasks: {} }),
      subscribe: () => () => {},
      snapshot: async () => undefined,
      watchDocument: async () => undefined,
    },
    controller: {
      configure: async () => {},
      commit: async () => {
        throw new Error("Not needed");
      },
    },
  };
  const port: CommandRegistryPort = {
    assertCurrent() {
      if (!current) throw new Error("OLD_HOST");
    },
    conversation: (id) => (id === "one" ? conversation : undefined),
    isStreaming: () => streaming,
    confirm: async () => confirmed,
    released() {
      releases++;
    },
  };
  const registry = new CommandRegistry(commands, port, builtins);
  const invoke = (
    commandId: string,
    conversationId?: string,
    input?: Parameters<typeof registry.invoke>[0]["input"],
  ) =>
    registry.invoke({
      generation: registry.generation,
      commandId,
      conversationId,
      input,
    });
  return {
    registry,
    invoke,
    port,
    releases: () => releases,
    stream: (value: boolean) => {
      streaming = value;
    },
    confirm: (value: boolean) => {
      confirmed = value;
    },
    stale: () => {
      current = false;
    },
  };
}
const command = (run: HostCommand["run"] = () => {}): HostCommand => ({
  id: "example.run",
  title: "Run",
  scope: "conversation",
  run,
});

test("global config.reload needs no conversation and releases its lease before pending apply coordination", async () => {
  let ran = 0;
  const fake = fixture(
    [],
    [
      {
        id: "config.reload",
        title: "Reload",
        scope: "global",
        run(ctx) {
          expect(ctx.conversation).toBeUndefined();
          ran++;
        },
      },
    ],
  );
  fake.port.released = () => {
    expect(fake.registry.busy).toBe(false);
  };
  await fake.invoke("config.reload");
  expect(ran).toBe(1);
  expect((await fake.registry.describe())[0].disabled).toBeUndefined();
});

test("scope, current generation, streaming, conditions and default no-input all fail closed", async () => {
  let ran = 0;
  let disabled: string | undefined = "Policy disabled";
  const fake = fixture([
    {
      ...command(() => {
        ran++;
      }),
      enabled: () => disabled,
    },
  ]);
  await expect(fake.invoke("example.run")).rejects.toThrow(
    "CONVERSATION_REQUIRED",
  );
  await expect(fake.invoke("example.run", "missing")).rejects.toThrow(
    "CONVERSATION_UNAVAILABLE",
  );
  await expect(fake.invoke("example.run", "one", null)).rejects.toThrow(
    "COMMAND_INPUT_NOT_ALLOWED",
  );
  await expect(fake.invoke("example.run", "one")).rejects.toThrow(
    "Policy disabled",
  );
  expect((await fake.registry.describe("one"))[0].disabled).toBe(
    "Policy disabled",
  );
  disabled = undefined;
  fake.stream(true);
  await expect(fake.invoke("example.run", "one")).rejects.toThrow("AGENT_BUSY");
  fake.stream(false);
  await expect(
    fake.registry.invoke({
      generation: "old",
      commandId: "example.run",
      conversationId: "one",
    }),
  ).rejects.toThrow("STALE_GENERATION");
  await fake.invoke("example.run", "one");
  fake.stale();
  await expect(fake.invoke("example.run", "one")).rejects.toThrow("OLD_HOST");
  expect(ran).toBe(1);
});

test("bounded JSON and explicit input validation precede confirmation and execution; fixed copy cannot be mutated by the caller", async () => {
  const seen: unknown[] = [];
  const fake = fixture([
    {
      ...command((_ctx, input) => {
        seen.push(input);
      }),
      validateInput(input) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          typeof input.text !== "string"
        )
          throw new Error("BAD_SHAPE");
      },
      confirmation: "Apply?",
    },
  ]);
  await expect(fake.invoke("example.run", "one", {})).rejects.toThrow(
    "BAD_SHAPE",
  );
  await expect(fake.invoke("example.run", "one", Number.NaN)).rejects.toThrow();
  fake.confirm(false);
  await expect(
    fake.invoke("example.run", "one", { text: "a" }),
  ).rejects.toThrow("COMMAND_CANCELLED");
  fake.confirm(true);
  const input = { text: "original" };
  const pending = fake.invoke("example.run", "one", input);
  input.text = "forged";
  await pending;
  expect(seen).toEqual([{ text: "original" }]);
  fake.port.confirm = undefined;
  await expect(
    fake.invoke("example.run", "one", { text: "a" }),
  ).rejects.toThrow("COMMAND_CONFIRMATION_UNAVAILABLE");
});

test("confirmation rechecks current policy and lifecycle; failures release busy without killing registry", async () => {
  let reason: string | undefined;
  let ran = 0;
  const fake = fixture([
    {
      ...command(() => {
        ran++;
      }),
      enabled: () => reason,
      confirmation: "Confirm",
    },
  ]);
  fake.port.confirm = async () => {
    reason = "Changed policy";
    return true;
  };
  await expect(fake.invoke("example.run", "one")).rejects.toThrow(
    "Changed policy",
  );
  expect(fake.registry.busy).toBe(false);
  expect(fake.releases()).toBe(1);
  reason = undefined;
  fake.port.confirm = async () => {
    fake.registry.dispose();
    return true;
  };
  await expect(fake.invoke("example.run", "one")).rejects.toThrow(
    "COMMAND_DISPOSED",
  );
  expect(ran).toBe(0);
});

test("in-flight commands retain busy until finally, reject double invocation, and receive an aborted lifetime on dispose", async () => {
  let finish!: () => void;
  let captured!: CommandContext;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fake = fixture([
    command(async (ctx) => {
      captured = ctx;
      await gate;
      throw new Error("failed after commit");
    }),
  ]);
  const pending = fake.invoke("example.run", "one");
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(fake.registry.busy).toBe(true);
  await expect(fake.invoke("example.run", "one")).rejects.toThrow(
    "COMMAND_BUSY",
  );
  fake.registry.dispose();
  expect(captured.scope.signal.aborted).toBe(true);
  expect(fake.registry.busy).toBe(true);
  finish();
  await expect(pending).rejects.toThrow("failed after commit");
  expect(fake.registry.busy).toBe(false);
});

test("invalid/reserved/duplicate IDs and asynchronous validators cannot expose arbitrary execution", async () => {
  for (const id of ["plain", "config.reload", "settings.open"])
    expect(() => fixture([{ ...command(), id }])).toThrow();
  expect(() => fixture([command(), command()])).toThrow("Duplicate command");
  const fake = fixture([{ ...command(), validateInput: async () => {} }]);
  await expect(fake.invoke("example.run", "one")).rejects.toThrow(
    "INVALID_COMMAND_VALIDATOR",
  );
});

test("controller mutation is available only during run, not conditions, confirmation or retained contexts", async () => {
  let retained!: CommandContext;
  let writes = 0;
  const fake = fixture([
    {
      ...command(async (ctx) => {
        retained = ctx;
        await ctx.conversation?.controller.configure({
          instructions: "native",
        });
      }),
      confirmation: "Confirm",
      allowWhileStreaming: true,
    },
  ]);
  const target = await fake.port.conversation(
    "one",
    new AbortController().signal,
  );
  if (!target) throw new Error("Missing target");
  target.controller.configure = async () => {
    writes++;
  };
  fake.port.confirm = async (_message, ctx) => {
    await expect(ctx.conversation?.controller.configure({})).rejects.toThrow(
      "COMMAND_EXECUTION_REQUIRED",
    );
    return true;
  };
  fake.stream(true);
  await fake.invoke("example.run", "one");
  expect(writes).toBe(1);
  await expect(retained.conversation?.controller.configure({})).rejects.toThrow(
    "COMMAND_DISPOSED",
  );
  expect(writes).toBe(1);
});
