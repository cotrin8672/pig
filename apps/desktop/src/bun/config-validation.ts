import {
  createRegistry,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type {
  AdapterKeymap,
  AgentProfile,
  ConfigKeymap,
  PigConfig,
  ProviderFactory,
  RuntimeConfig,
  SessionAdapter,
} from "../../../../packages/config/src";
import { normalizeCombo } from "../shared/keymap";
import { RESERVED_COMMAND_IDS, validateHostCommands } from "./command-registry";

function object(
  value: unknown,
  name: string,
  allowed?: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  if (
    allowed &&
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  )
    throw new Error(`${name} has unsupported properties`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${name} must be a nonempty string of at most ${max} characters`,
    );
  return value;
}
function array(value: unknown, name: string, max = 256): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${name} must be an array of at most ${max} entries`);
  return Array.from(value);
}
function fn(value: unknown, name: string): void {
  if (typeof value !== "function")
    throw new Error(`${name} must be a function`);
}
function optionalFunctions(
  value: Record<string, unknown>,
  names: string[],
  path: string,
): void {
  for (const name of names)
    if (value[name] !== undefined) fn(value[name], `${path}.${name}`);
}
function tool(value: unknown, name: string): ToolRegistration {
  const input = object(value, name);
  text(input.name, `${name}.name`);
  text(input.description, `${name}.description`, 65_536);
  object(input.parameters, `${name}.parameters`);
  fn(input.execute, `${name}.execute`);
  optionalFunctions(input, ["prepareArguments"], name);
  if (
    input.replay !== undefined &&
    input.replay !== "safe" &&
    input.replay !== "unsafe"
  )
    throw new Error(`${name}.replay is invalid`);
  if (
    input.executionMode !== undefined &&
    input.executionMode !== "parallel" &&
    input.executionMode !== "sequential"
  )
    throw new Error(`${name}.executionMode is invalid`);
  if (input.deferred !== undefined && input.deferred !== true)
    throw new Error(`${name}.deferred must be true`);
  if (input.callers !== undefined) {
    const callers = array(input.callers, `${name}.callers`, 2);
    if (
      callers.some((caller) => caller !== "model" && caller !== "tools") ||
      new Set(callers).size !== callers.length
    )
      throw new Error(`${name}.callers is invalid`);
  }
  return value as ToolRegistration;
}
function extension(value: unknown, name: string): Extension {
  const input = object(value, name, [
    "name",
    "tools",
    "sections",
    "hooks",
    "wraps",
    "tasks",
  ]);
  text(input.name, `${name}.name`);
  if (input.tools !== undefined)
    array(input.tools, `${name}.tools`).forEach((value, i) => {
      tool(value, `${name}.tools[${i}]`);
    });
  if (input.sections !== undefined)
    for (const value of array(input.sections, `${name}.sections`)) {
      const section = object(value, `${name}.section`, [
        "key",
        "render",
        "tag",
      ]);
      text(section.key, `${name}.section.key`);
      fn(section.render, `${name}.section.render`);
      if (section.tag !== undefined && typeof section.tag !== "boolean")
        throw new Error(`${name}.section.tag must be boolean`);
    }
  if (input.hooks !== undefined)
    for (const value of array(input.hooks, `${name}.hooks`)) {
      const hook = object(value, `${name}.hook`, ["task", "handlers"]);
      text(hook.task, `${name}.hook.task`);
      const handlers = object(hook.handlers, `${name}.hook.handlers`);
      for (const handler of Object.values(handlers))
        fn(handler, `${name}.hook.handler`);
    }
  if (input.wraps !== undefined)
    for (const value of array(input.wraps, `${name}.wraps`)) {
      const wrap = object(value, `${name}.wrap`, ["tool", "section", "wrap"]);
      if ((wrap.tool === undefined) === (wrap.section === undefined))
        throw new Error(`${name}.wrap requires one target`);
      text(wrap.tool ?? wrap.section, `${name}.wrap.target`);
      fn(wrap.wrap, `${name}.wrap.wrap`);
    }
  if (input.tasks !== undefined)
    for (const value of array(input.tasks, `${name}.tasks`)) {
      const task = object(value, `${name}.task`, ["definition"]);
      const definition = object(task.definition, `${name}.task.definition`, [
        "name",
        "version",
        "initial",
        "phases",
        "abort",
        "migrate",
        "hooks",
      ]);
      text(definition.name, `${name}.task.name`);
      if (
        !Number.isSafeInteger(definition.version) ||
        (definition.version as number) < 1
      )
        throw new Error(
          `${name}.task.definition.version must be a positive integer`,
        );
      fn(definition.initial, `${name}.task.initial`);
      fn(definition.abort, `${name}.task.abort`);
      optionalFunctions(definition, ["migrate"], `${name}.task`);
      const phases = object(definition.phases, `${name}.task.phases`);
      if (!Object.keys(phases).length || Object.keys(phases).length > 256)
        throw new Error(`${name}.task.phases must be nonempty and bounded`);
      for (const phase of Object.values(phases))
        fn(phase, `${name}.task.phase`);
      if (definition.hooks !== undefined)
        object(definition.hooks, `${name}.task.hooks`);
    }
  return value as Extension;
}

/** Actual enabled tools, including nested-call permissions; modelTools is NEVER an allowlist. */
export function effectiveProfileTools(profile: AgentProfile): {
  model: ToolRegistration[];
  callable: ToolRegistration[];
} {
  const tools = new Map<string, ToolRegistration>();
  for (const extension of profile.extensions)
    for (const tool of extension.tools ?? []) tools.set(tool.name, tool);
  for (const extension of profile.extensions)
    for (const wrap of extension.wraps ?? []) {
      if (!("tool" in wrap)) continue;
      const previous = tools.get(wrap.tool);
      if (!previous) continue;
      const next = tool(wrap.wrap(previous), `wrap(${wrap.tool})`);
      if (next.name !== previous.name)
        throw new Error(`Tool wrapper renamed ${previous.name}`);
      tools.set(next.name, next);
    }
  const enabled = profile.tools.map((selected) => {
    const resolved = tools.get(selected.name);
    if (!resolved) throw new Error(`Unknown profile tool: ${selected.name}`);
    return resolved;
  });
  const modelNames =
    profile.modelTools && new Set(profile.modelTools.map((tool) => tool.name));
  return {
    callable: enabled.filter(
      (tool) => tool.callers === undefined || tool.callers.includes("tools"),
    ),
    model: enabled.filter(
      (tool) =>
        (tool.callers === undefined || tool.callers.includes("model")) &&
        (modelNames ? modelNames.has(tool.name) : !tool.deferred),
    ),
  };
}

function runtime(value: unknown): RuntimeConfig {
  const input = object(value, "runtime", [
    "extensions",
    "providers",
    "providerFactories",
    "resources",
    "profiles",
    "defaultProfile",
    "conversationCreated",
  ]);
  const result: RuntimeConfig = {};
  const installed = array(
    input.extensions ?? [],
    "runtime.extensions",
    128,
  ).map((value, i) => extension(value, `runtime.extensions[${i}]`));
  const names = new Set<string>();
  const registry = createRegistry(); // Disposable validation registry; never a workspace singleton.
  for (const extension of installed) {
    if (names.has(extension.name))
      throw new Error(`Duplicate Extension id: ${extension.name}`);
    names.add(extension.name);
    registry.install(extension); // Native task collisions / duplicate tools / reserved & duplicate section keys.
  }
  result.extensions = [...installed];
  if (input.providers !== undefined) {
    const ids = new Set<string>();
    result.providers = array(input.providers, "runtime.providers", 128).map(
      (value) => {
        const provider = object(value, "provider");
        const id = text(provider.id, "provider.id");
        text(provider.name, "provider.name");
        const auth = object(provider.auth, "provider.auth");
        if (!auth.apiKey && !auth.oauth)
          throw new Error("provider.auth requires apiKey or oauth");
        if (auth.apiKey !== undefined) {
          const apiKey = object(auth.apiKey, "provider.auth.apiKey");
          fn(apiKey.resolve, "provider.auth.apiKey.resolve");
          optionalFunctions(apiKey, ["login", "check"], "provider.auth.apiKey");
        }
        if (auth.oauth !== undefined) {
          const oauth = object(auth.oauth, "provider.auth.oauth");
          text(oauth.name, "provider.auth.oauth.name");
          for (const name of ["login", "refresh", "toAuth"])
            fn(oauth[name], `provider.auth.oauth.${name}`);
        }
        for (const name of ["getModels", "stream", "streamSimple"])
          fn(provider[name], `provider.${name}`);
        optionalFunctions(
          provider,
          [
            "getAllModels",
            "refreshModels",
            "filterModels",
            "filterAllModels",
            "fetchDeferred",
            "cancelDeferred",
            "generateImages",
            "classify",
          ],
          "provider",
        );
        if (ids.has(id)) throw new Error(`Duplicate provider id: ${id}`);
        ids.add(id);
        return value as NonNullable<RuntimeConfig["providers"]>[number];
      },
    );
  }
  if (input.providerFactories !== undefined)
    result.providerFactories = array(
      input.providerFactories,
      "runtime.providerFactories",
      128,
    ).map((value, i) => {
      fn(value, `runtime.providerFactories[${i}]`);
      return value as ProviderFactory;
    });
  if (input.resources !== undefined) {
    fn(input.resources, "runtime.resources");
    result.resources = input.resources as RuntimeConfig["resources"];
  }
  if (input.profiles !== undefined) {
    const profiles = object(input.profiles, "runtime.profiles");
    if (Reflect.ownKeys(profiles).length > 128)
      throw new Error("At most 128 profiles are allowed");
    result.profiles = Object.fromEntries(
      Object.entries(profiles).map(([id, value]) => {
        text(id, "profile id", 128);
        const name = `runtime.profiles.${id}`;
        const input = object(value, name, [
          "model",
          "thinkingLevel",
          "instructions",
          "cwd",
          "maxTurns",
          "extensions",
          "tools",
          "modelTools",
        ]);
        const selected = array(input.extensions, `${name}.extensions`, 128).map(
          (value) => {
            const ref = object(value, `${name}.extension`);
            const found = installed.find(
              (extension) => extension.name === ref.name,
            );
            if (!found || found !== value)
              throw new Error(
                `${name} references unknown Extension: ${String(ref.name)}`,
              );
            return found;
          },
        );
        if (new Set(selected).size !== selected.length)
          throw new Error(`${name} has duplicate extensions`);
        const available = new Map(
          selected.flatMap((extension) =>
            (extension.tools ?? []).map((tool) => [tool.name, tool] as const),
          ),
        );
        const select = (
          value: unknown,
          path: string,
          allowed: ReadonlyMap<string, ToolRegistration>,
        ) => {
          const tools = array(value, path).map((value) => {
            const ref = object(value, path);
            const found = allowed.get(String(ref.name));
            if (!found || found !== value)
              throw new Error(
                `${path} references unknown/eclipsed tool: ${String(ref.name)}`,
              );
            return found;
          });
          if (new Set(tools).size !== tools.length)
            throw new Error(`${path} has duplicate tools`);
          return tools;
        };
        const profile: AgentProfile = {
          extensions: [...selected],
          tools: select(input.tools, `${name}.tools`, available),
        };
        if (input.modelTools !== undefined) {
          profile.modelTools = select(
            input.modelTools,
            `${name}.modelTools`,
            new Map(profile.tools.map((tool) => [tool.name, tool])),
          );
          if (
            profile.modelTools.some(
              (tool) => tool.callers && !tool.callers.includes("model"),
            )
          )
            throw new Error(
              `${name}.modelTools contains a tool not callable by the model`,
            );
        }
        if (input.model !== undefined) {
          const model = object(input.model, `${name}.model`, [
            "provider",
            "modelId",
          ]);
          profile.model = {
            provider: text(model.provider, `${name}.model.provider`),
            modelId: text(model.modelId, `${name}.model.modelId`),
          };
        }
        if (input.thinkingLevel !== undefined) {
          if (
            typeof input.thinkingLevel !== "string" ||
            ![
              "off",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
            ].includes(input.thinkingLevel)
          )
            throw new Error(`${name}.thinkingLevel is invalid`);
          profile.thinkingLevel =
            input.thinkingLevel as AgentProfile["thinkingLevel"];
        }
        for (const key of ["instructions", "cwd"] as const)
          if (input[key] !== undefined) {
            if (
              typeof input[key] !== "string" ||
              input[key].length > (key === "cwd" ? 16_384 : 262_144)
            )
              throw new Error(`${name}.${key} must be a bounded string`);
            profile[key] = input[key];
          }
        if (input.maxTurns !== undefined) {
          if (
            !Number.isSafeInteger(input.maxTurns) ||
            (input.maxTurns as number) < 1
          )
            throw new Error(`${name}.maxTurns must be an integer >= 1`);
          profile.maxTurns = input.maxTurns as number;
        }
        const effective = effectiveProfileTools(profile);
        if (
          profile.modelTools &&
          effective.model.length !== profile.modelTools.length
        )
          throw new Error(
            `${name}.modelTools contains a tool not callable by the model after wrapping`,
          );
        return [id, profile];
      }),
    );
  }
  if (input.defaultProfile !== undefined) {
    const id = text(input.defaultProfile, "runtime.defaultProfile", 128);
    if (!Object.hasOwn(result.profiles ?? {}, id))
      throw new Error(`Unknown defaultProfile: ${id}`);
    result.defaultProfile = id;
  }
  if (input.conversationCreated !== undefined) {
    fn(input.conversationCreated, "runtime.conversationCreated");
    result.conversationCreated =
      input.conversationCreated as RuntimeConfig["conversationCreated"];
  }
  return result;
}

export function validateConfig(value: unknown): PigConfig {
  // Version check precedes v2 property validation, so every v1 gets a migration diagnostic.
  const version = object(value, "config").apiVersion;
  if (version === 1)
    throw new Error(
      "apiVersion 1 is unsupported; migrate to apiVersion: 2 using examples/session-ui/config.ts (native Durable adapters; no SDK compatibility)",
    );
  if (version !== 2) throw new Error("apiVersion must be exactly 2");
  const input = object(value, "config", [
    "apiVersion",
    "runtime",
    "commands",
    "sessionAdapters",
    "keymaps",
  ]);
  const config: PigConfig = { apiVersion: 2 };
  if (input.runtime !== undefined) config.runtime = runtime(input.runtime);
  if (input.commands !== undefined)
    config.commands = validateHostCommands(input.commands);
  const ids = new Set<string>();
  if (input.sessionAdapters !== undefined)
    config.sessionAdapters = array(
      input.sessionAdapters,
      "sessionAdapters",
      128,
    ).map((value, index) => {
      const name = `sessionAdapters[${index}]`;
      const adapter = object(value, name, ["id", "connect"]);
      const id = text(adapter.id, `${name}.id`, 128);
      if (ids.has(id)) throw new Error(`Duplicate adapter id: ${id}`);
      fn(adapter.connect, `${name}.connect`);
      ids.add(id);
      return { id, connect: adapter.connect as SessionAdapter["connect"] };
    });
  if (input.keymaps !== undefined) {
    const combos = new Set<string>();
    const commands = new Set([
      ...(config.commands ?? []).map((command) => command.id),
      ...RESERVED_COMMAND_IDS,
    ]);
    config.keymaps = array(input.keymaps, "keymaps", 512).map(
      (value, index): ConfigKeymap => {
        const name = `keymaps[${index}]`;
        const binding = object(value, name, [
          "keys",
          "adapter",
          "command",
          "when",
        ]);
        const keys = normalizeCombo(text(binding.keys, `${name}.keys`, 128));
        if (!keys)
          throw new Error(`${name}.keys is not a valid key combination`);
        const command = text(binding.command, `${name}.command`);
        const when = binding.when;
        if (when !== "chat" && when !== "composer" && when !== "panel")
          throw new Error(`${name}.when must be chat, composer, or panel`);
        const identity = `${when}:${keys}`;
        if (combos.has(identity))
          throw new Error(`Duplicate keymap conflict: ${identity}`);
        combos.add(identity);
        if (binding.adapter !== undefined) {
          const adapter = text(binding.adapter, `${name}.adapter`, 128);
          if (!ids.has(adapter))
            throw new Error(`${name} references unknown adapter: ${adapter}`);
          return { keys, adapter, command, when } satisfies AdapterKeymap;
        }
        if (!commands.has(command))
          throw new Error(
            `${name} references unknown host command: ${command}`,
          );
        return { keys, command, when };
      },
    );
  }
  return config;
}
