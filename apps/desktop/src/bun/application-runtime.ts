import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { CredentialStore, Provider } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  type ConversationId,
  defineExtension,
  defineTool,
  type Extension,
  GenerationTask,
  hook,
  type ModelRef,
  section,
  type ToolRegistration,
  ToolTask,
  type ToolTaskInput,
  type UserInput,
  wrapTool,
} from "@earendil-works/pi-durable";
import type {
  ImageLimits,
  ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import type {
  AgentProfile,
  PigConfig,
  RuntimeConfig,
} from "../../../../packages/config/src";
import type { UIReply } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import type { Settings } from "../shared/settings";
import {
  type BuiltinRuntimeCompatibility,
  builtinRuntimeCompatibility,
} from "./application-compatibility";
import { createConfigProviders } from "./application-config";
import { createBuiltinAdapters } from "./builtin-adapters";
import {
  createDelegationExtensions,
  createTodosExtension,
  Delegations,
  reconcileDelegations,
  Todos,
} from "./builtin-extensions";
import { type ConfigApplyGate, ConfigLoader } from "./config-loader";
import { validateConfig } from "./config-validation";
import {
  DurableHost,
  type DurableHostOptions,
  type NativeUIAttachment,
} from "./durable-host";
import { createNativeUIHost, type NativeUI } from "./extension-ui";
import { createNativeImagePolicy } from "./image-policy";
import { createNativeApprovals, NativeApprovals } from "./native-approvals";
import {
  assertConversationMembership,
  PigConversationMeta,
  parseConversationAppId,
  type WorkspaceIdentity,
  workspaceIdentity,
} from "./native-conversation-meta";
import {
  createNativeToolPolicy,
  operationHash,
  type ToolIdentity,
  type ToolOwner,
} from "./native-tool-policy";
import {
  isProjectTrusted,
  resolveProjectTrust,
  selectedProjectResources,
} from "./project-trust";
import {
  createResourcesExtension,
  expandInput,
  inspectResourceSelection,
  loadResources,
  type ResourceSelection,
  ResourceSelectionError,
  type ResourceSnapshot,
  resourcePathWithin,
} from "./resources";
import {
  createDesktopTools,
  DesktopExecutionEnv,
  desktopShellTool,
  type NativeEnvironmentOptions,
} from "./shell-tools";
import { sameSession } from "./ui-request-broker";
import type { RuntimeApplyResult, WorkspaceRuntime } from "./workspace-runtime";

/** Explicit selections only. A project file cannot be relabelled as user-global to skip trust. */
export interface ApplicationResourceSelection {
  global?: ResourceSelection;
  project?: ResourceSelection;
}
export interface ApplicationRuntimeOptions
  extends Pick<
    DurableHostOptions,
    | "emit"
    | "emitUI"
    | "emitSession"
    | "disabled"
    | "modelInfo"
    | "defaultEffort"
    | "createModels"
    | "validateResume"
    | "checkCompatibility"
    | "onFailure"
    | "onReport"
    | "connectionNow"
  > {
  dataRoot: string;
  modelDirectory: string;
  credentials: CredentialStore;
  config?: PigConfig;
  configLoader?: ConfigLoader;
  configFile?: string;
  settings(): Settings;
  harnessSettings?: DurableHostOptions["settings"];
  /** Trusted factory, not a sandbox: MUST return fresh providers for each workspace/generation.
   * Raw config providers without this port are rejected, never shared or guessed at. */
  createProviders?(
    identity: WorkspaceIdentity,
    configured: readonly Provider[],
  ): Promise<readonly Provider[]>;
  defaultModel?: ModelRef;
  /** Absence omits delegation. Inheritance freezes the current parent model at each unsafe invocation. */
  research?:
    | { model: ModelRef; inheritParent?: never; instructions?: string }
    | { inheritParent: true; model?: never; instructions?: string };
  /** Resolved once per workspace lifetime; never scans implicit/legacy directories. */
  resourceSelection?(
    identity: WorkspaceIdentity,
  ): ApplicationResourceSelection | Promise<ApplicationResourceSelection>;
  imageProcessor?: ImageProcessor;
  imageLimits?(
    model: Parameters<NonNullable<DurableHostOptions["prepareInput"]>>[1],
  ): Partial<ImageLimits>;
  /** Explicit trusted native UI port, NOT an SDK facade or a security approval API. */
  attachNativeUI?(input: {
    address: SessionAddress;
    ui: NativeUI;
    signal: AbortSignal;
  }):
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>;
  /** Test/embedding port; omitted production runner is always runCommand (mandatory RTK). */
  execution?: Pick<
    NativeEnvironmentOptions,
    "runner" | "which" | "shellProgram" | "shellEnv" | "commandPrefix"
  >;
}
export interface ApplicationRuntime {
  /** Trusted in-process port. Use reload/abort/resolveUI below for app-owned lifecycle operations. */
  readonly host: DurableHost;
  /** Restores projections only after loss of the last UI lease; another live Root keeps its dialogs. */
  connect(input: { clientId: string }): Promise<void>;
  reload(config?: PigConfig): Promise<RuntimeApplyResult>;
  /** Waits for approval projection, selected-resource trust and native UI attachment; failures propagate. */
  ready(address: SessionAddress): Promise<void>;
  abort(address: SessionAddress): Promise<void>;
  resolveUI(reply: UIReply): Promise<void>;
  selectedProjectResources(
    cwd: string,
    signal?: AbortSignal,
  ): ReturnType<typeof selectedProjectResources>;
  dispose(): Promise<void>;
}

const emptySelection: ResourceSelection = Object.freeze({
  instructions: [],
  skills: [],
  prompts: [],
});
const emptySnapshot: ResourceSnapshot = Object.freeze({
  instructions: [],
  skills: [],
  prompts: [],
});
const mandatory = [
  "pig.resources",
  "pig.reconcile",
  "pig.approvals",
  "pig.image-policy",
  "pig.tool-policy",
];
type Projection = {
  address: SessionAddress;
  ready: Promise<void>;
  assertLive(): void;
};
type Boundary = {
  identity: WorkspaceIdentity;
  selection: Required<ApplicationResourceSelection>;
  approvals: ReturnType<typeof createNativeApprovals>;
  resources: Extension;
  snapshots: Map<ConversationId, ResourceSnapshot>;
  workspace?: WorkspaceRuntime;
  environment(conversationId: ConversationId): Promise<DesktopExecutionEnv>;
  owner(identity: ToolIdentity, context: Context): Promise<ToolOwner>;
  wrap(tool: ToolRegistration): ToolRegistration;
  policy: ReturnType<typeof createNativeToolPolicy>;
};
function absolute(path: string, name: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
    throw new TypeError(`Explicit absolute ${name} required`);
}
function copySelection(
  selection: ResourceSelection = emptySelection,
): ResourceSelection {
  const copy = (paths: readonly string[]) =>
    Object.freeze(
      paths.map((path) => {
        absolute(path, "resource path");
        return path;
      }),
    );
  return Object.freeze({
    instructions: copy(selection.instructions),
    skills: copy(selection.skills),
    prompts: copy(selection.prompts),
  });
}
function requirePolicy(
  agent: Awaited<
    ReturnType<import("@earendil-works/pi-durable").Conversation["agent"]>
  >,
): void {
  const names = agent.extensions
    .map((extension) => extension.name)
    .filter((name) => name !== "pig.research");
  const selected = names.filter((name) => mandatory.includes(name));
  if (
    selected.join("\n") !== mandatory.join("\n") ||
    names.slice(-3).join("\n") !== mandatory.slice(-3).join("\n")
  )
    throw new Error("APPLICATION_POLICY_SELECTION_REQUIRED");
}

/** Lazy assembly only: no config import, workspace open, auth lookup, install or history discovery here.
 * Trusted extensions can still call node:fs or commit arbitrary docs directly; native 1.5 has no universal interceptor.
 * Package mutation exclusion is owned by Host; metadata inspection alone is never a lease. */
export function createApplicationRuntime(
  options: ApplicationRuntimeOptions,
): ApplicationRuntime {
  absolute(options.dataRoot, "dataRoot");
  absolute(options.modelDirectory, "modelDirectory");
  if (options.configFile) absolute(options.configFile, "configFile");
  if (!options.credentials)
    throw new TypeError("Explicit application CredentialStore required");
  const image = createNativeImagePolicy({
    blockImages: () => options.settings().blockImages,
    processor: options.imageProcessor,
  });
  const boundaries = new Map<string, Promise<Boundary>>();
  const projections = new Map<string, Projection>();
  const providers = new WeakSet<Provider>();
  const environments = new Set<DesktopExecutionEnv>();
  const compatibility = new WeakMap<
    NonNullable<RuntimeConfig["conversationCreated"]>,
    BuiltinRuntimeCompatibility
  >();
  const policyFor = (runtime: RuntimeConfig) => {
    const policy =
      runtime.conversationCreated &&
      compatibility.get(runtime.conversationCreated);
    if (!policy) throw new Error("APPLICATION_POLICY_ATTESTATION_MISSING");
    return policy;
  };
  const adapters = createBuiltinAdapters();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let connectionReady: Promise<void> | undefined;
  let host: DurableHost;
  let activeRuntime = options.config?.runtime;
  const genericTool = (name: string) =>
    !["read", "write", "edit", "bash", "powershell"].includes(name);
  const spillDirectory = (
    identity: WorkspaceIdentity,
    conversationId: ConversationId,
  ) =>
    join(
      options.dataRoot,
      "agent-v2",
      "workspaces",
      identity.key,
      "spill",
      String(conversationId),
    );
  const withAdapters = (config: PigConfig): PigConfig => {
    const validated = validateConfig(config);
    if (
      validated.sessionAdapters?.some((adapter) =>
        adapter.id.startsWith("pig."),
      )
    )
      throw new Error("Reserved application adapter ID");
    return {
      ...validated,
      sessionAdapters: [...adapters, ...(validated.sessionAdapters ?? [])],
    };
  };
  const bind = async (boundary: Boundary) =>
    (boundary.workspace ??= await host.workspace(boundary.identity.cwd));
  const selectResources = async (
    identity: WorkspaceIdentity,
    runtime = activeRuntime,
  ) => {
    if (options.resourceSelection && runtime?.resources)
      throw new Error("AMBIGUOUS_RESOURCE_SELECTION");
    const selection = options.resourceSelection
      ? await options.resourceSelection(identity)
      : await runtime?.resources?.(
          Object.freeze({ workspaceId: identity.key, cwd: identity.cwd }),
        );
    return {
      global: copySelection(selection?.global),
      project: copySelection(selection?.project),
    };
  };
  const boundaryFor = (
    identity: WorkspaceIdentity,
    selection?: Required<ApplicationResourceSelection>,
  ): Promise<Boundary> => {
    let pending = boundaries.get(identity.key);
    if (!pending) {
      pending = (async () =>
        buildBoundary(
          Object.freeze({ ...identity }),
          selection ?? (await selectResources(identity)),
        ))();
      boundaries.set(identity.key, pending);
      void pending.catch(() => {
        if (boundaries.get(identity.key) === pending)
          boundaries.delete(identity.key);
      });
    }
    return pending;
  };
  async function buildBoundary(
    identity: WorkspaceIdentity,
    selection: Required<ApplicationResourceSelection>,
  ): Promise<Boundary> {
    const snapshots = new Map<ConversationId, ResourceSnapshot>();
    let boundary: Boundary;
    const owner = async (
      input: ToolIdentity,
      context: Context,
    ): Promise<ToolOwner> => {
      const workspace = await bind(boundary);
      const conversation = await workspace.harness.conversation(
        input.conversationId,
        context,
      );
      if (!conversation) throw new Error("TOOL_CONVERSATION_MISSING");
      const metadata = await workspace.metadata(conversation, context);
      const task = await workspace.harness.getTask(input.taskId, context);
      if (
        !task ||
        task.kind !== ToolTask.definition.name ||
        task.conversationId !== input.conversationId ||
        task.abortRequested ||
        task.state.status === "terminal" ||
        task.state.status === "completing"
      )
        throw new Error("TOOL_TASK_MEMBERSHIP_MISMATCH");
      const call = task.input as ToolTaskInput;
      if ((call.kind === "model" ? call.callId : call.call.id) !== input.callId)
        throw new Error("TOOL_CALL_ID_MISMATCH");
      const actualCall =
        call.kind === "nested"
          ? call.call
          : await workspace.harness.commit(async (tx) => {
              const entry = await tx.entry(call.assistant);
              return entry?.model
                ?.flatMap((message) =>
                  message.role === "assistant" ? message.content : [],
                )
                .find(
                  (part) =>
                    part.type === "toolCall" && part.id === input.callId,
                );
            }, context);
      if (
        !actualCall ||
        actualCall.type !== "toolCall" ||
        actualCall.name !== input.toolName
      )
        throw new Error("TOOL_NAME_MISMATCH");
      const record = await workspace.harness.commit(
        (tx) => tx.conversation(input.conversationId),
        context,
      );
      const agent = await conversation.agent(context);
      const state = await workspace.harness.snapshot(
        AgentDoc,
        conversation.id,
        context,
      );
      if (!record || !state) throw new Error("TOOL_AGENT_MISSING");
      requirePolicy(agent);
      const research = agent.extensions.some(
        (extension) => extension.name === "pig.research",
      );
      if (!!record.owner !== research)
        throw new Error("UNSUPPORTED_TASK_OWNED_PROFILE");
      if (record.owner) {
        const parent = await workspace.harness.getTask(
          record.owner.taskId,
          context,
        );
        if (
          !parent ||
          parent.conversationId !== record.owner.conversationId ||
          parent.kind !== ToolTask.definition.name
        )
          throw new Error("RESEARCH_OWNER_MISMATCH");
      }
      const readRoots = [
        spillDirectory(identity, input.conversationId),
        ...(record.owner
          ? [spillDirectory(identity, record.owner.conversationId)]
          : []),
      ];
      await Promise.all(
        readRoots.map((directory) => mkdir(directory, { recursive: true })),
      );
      const settings = options.settings();
      const shellTool = settings.shell === "powershell" ? "powershell" : "bash";
      return {
        ...input,
        profileId: research ? "pig.research" : metadata.profile,
        policyRevision: Number.parseInt(
          operationHash({
            state,
            owner: record.owner ?? null,
            shell: settings.shell,
            blockImages: settings.blockImages,
            selection,
          }).slice(0, 12),
          16,
        ),
        readOnly: research,
        tools: [
          ...new Set(
            [...agent.tools, ...agent.callable, ...agent.deferred]
              .map((tool) => tool.name)
              .filter(
                (name) =>
                  (name !== "bash" && name !== "powershell") ||
                  name === shellTool,
              ),
          ),
        ].sort(),
        roots: [identity.cwd],
        readRoots,
      };
    };
    const policy = createNativeToolPolicy({
      resolveOwner: owner,
      authorize: async (identity, operation, context) => {
        const shell = options.settings().shell;
        const lease = await boundary.approvals.authorize(
          identity,
          operation,
          context,
        );
        return () => {
          if (options.settings().shell !== shell)
            throw new Error(
              "Shell preference changed; retry with a new authorization",
            );
          lease();
        };
      },
    });
    const environmentByShell = new Map<string, Promise<DesktopExecutionEnv>>();
    const environment = (conversationId: ConversationId) => {
      const shell = options.settings().shell;
      const key = `${conversationId}:${shell}`;
      let pending = environmentByShell.get(key);
      if (!pending) {
        pending = (async () => {
          const directory = spillDirectory(identity, conversationId);
          await mkdir(directory, { recursive: true });
          const env = new DesktopExecutionEnv({
            ...options.execution,
            cwd: identity.cwd,
            shell,
            policy,
            spillDirectory: directory,
          });
          environments.add(env);
          return env;
        })();
        environmentByShell.set(key, pending);
        void pending.catch(() => environmentByShell.delete(key));
      }
      return pending;
    };
    const approvals = createNativeApprovals({
      harness: () => {
        if (!boundary.workspace) throw new Error("WORKSPACE_NOT_READY");
        return boundary.workspace.harness;
      },
      broker: host.broker,
      resolveOwner: async (call, api, context) => {
        return owner(
          {
            taskId: api.taskId,
            conversationId: api.conversationId,
            callId: call.id,
            toolName: call.name,
          },
          context,
        );
      },
      planTool: async (call, identity) => {
        if (call.name === "bash" || call.name === "powershell")
          return (await environment(identity.conversationId)).planTool(
            call,
            identity,
          );
        if (!identity.readOnly && genericTool(call.name))
          return {
            kind: "tool",
            name: call.name,
            argumentsJson: JSON.stringify(call.arguments),
            policyRevision: identity.policyRevision,
          };
        return undefined;
      },
    });
    const resources = defineExtension({
      name: "pig.resources",
      sections: (createResourcesExtension(emptySnapshot).sections ?? []).map(
        (definition) =>
          section(definition.key, async (input, context) => {
            const snapshot =
              snapshots.get(input.conversationId) ?? emptySnapshot;
            const selected = createResourcesExtension(snapshot).sections?.find(
              (entry) => entry.key === definition.key,
            );
            return selected?.render(input, context);
          }),
      ),
    });
    boundary = {
      identity,
      selection,
      approvals,
      resources,
      snapshots,
      environment,
      owner,
      policy,
      wrap: (tool) =>
        policy.wrap(
          image.wrap({
            ...tool,
            async execute(args, api, context) {
              if (genericTool(tool.name)) {
                const current = policy.currentOwner();
                const lease = await policy.authorize(
                  {
                    kind: "tool",
                    name: tool.name,
                    argumentsJson: JSON.stringify(args),
                    policyRevision: current.policyRevision,
                  },
                  context,
                );
                lease();
              }
              return tool.execute(args, api, context);
            },
          }),
        ),
    };
    return boundary;
  }
  async function assemble(
    identity: WorkspaceIdentity,
    runtime: RuntimeConfig = {},
  ): Promise<RuntimeConfig> {
    const selection = await selectResources(identity, runtime);
    const boundary = await boundaryFor(identity, selection);
    if (operationHash(selection) !== operationHash(boundary.selection))
      throw new Error(
        "RESOURCE_SELECTION_RESTART_REQUIRED: initialized workspace selection is immutable",
      );
    if (
      runtime.extensions?.some((extension) => extension.name.startsWith("pig."))
    )
      throw new Error("Reserved application extension name");
    if (runtime.providers?.length && !options.createProviders)
      throw new Error("WORKSPACE_PROVIDER_FACTORY_REQUIRED");
    const fresh = [
      ...((await options.createProviders?.(
        identity,
        runtime.providers ?? [],
      )) ?? []),
      ...(await createConfigProviders(runtime.providerFactories ?? [], {
        scope: "workspace",
        workspaceId: identity.key,
        cwd: identity.cwd,
      })),
    ];
    for (const provider of fresh) {
      if (providers.has(provider)) throw new Error("PROVIDER_INSTANCE_REUSED");
      providers.add(provider);
    }
    const native = createDesktopTools({
      shell: "git-bash",
      images: image.images,
      shellProgram: options.execution?.shellProgram,
      commandPrefix: options.execution?.commandPrefix,
    });
    // Fixed native definitions: a GUI preference changes resolution, never the registry/protocol.
    const nativeTools = [
      ...native.tools,
      desktopShellTool({
        shell: "powershell",
        shellProgram: options.execution?.shellProgram,
        commandPrefix: options.execution?.commandPrefix,
      }),
    ];
    const tools = defineExtension({
      ...native.extension,
      tools: nativeTools.map(boundary.wrap),
    });
    const todos = createTodosExtension();
    const planning = defineExtension({
      ...todos,
      tools: todos.tools?.map(boundary.wrap),
    });
    const external = (runtime.extensions ?? []).map((extension) =>
      defineExtension({
        ...extension,
        tools: extension.tools?.map(boundary.wrap),
      }),
    );
    let allTools = [
      ...(tools.tools ?? []),
      ...(planning.tools ?? []),
      ...external.flatMap((extension) => extension.tools ?? []),
    ];
    const reconciliation = defineExtension({
      name: "pig.reconcile",
      hooks: [
        hook(GenerationTask, {
          afterTools: async (_entry, _results, api, context) => {
            const workspace = await bind(boundary);
            await workspace.harness.commit(
              (tx) => reconcileDelegations(tx, api.conversationId),
              context,
            );
          },
        }),
      ],
    });
    const security = () => {
      const toolPolicy = boundary.policy.extension(allTools);
      return [
        boundary.resources,
        reconciliation,
        boundary.approvals.extension,
        image.extension(allTools),
        defineExtension({
          ...toolPolicy,
          wraps: [
            ...(toolPolicy.wraps ?? []),
            // Native 1.5 beforeRequest only replaces messages. Public pure wrappers run
            // on each agent resolution, BEFORE callers/tools/modelTools are intersected.
            // Remove BOTH model and nested callers; never widen an explicit selection.
            ...nativeTools
              .filter(
                (tool) => tool.name === "bash" || tool.name === "powershell",
              )
              .map((tool) =>
                wrapTool(tool, (selected) => ({
                  ...selected,
                  callers:
                    selected.name ===
                    (options.settings().shell === "powershell"
                      ? "powershell"
                      : "bash")
                      ? selected.callers
                      : [],
                })),
              ),
          ],
        }),
      ];
    };
    const builtins: Extension[] = [tools, planning];
    if (options.research) {
      const read = tools.tools?.find((tool) => tool.name === "read");
      if (!read) throw new Error("Native read tool missing");
      // Register this fixed read-only definition once. Per-call model selection never mutates the registry.
      const researchExtension = defineExtension({
        name: "pig.research",
        tools: [read],
        hooks: [
          hook(ToolTask, {
            beforeTool: (call) =>
              call.name === "read"
                ? undefined
                : { block: "Research permits only read" },
            afterTool: (_call, result) => {
              const { control: _control, ...rest } = result;
              return rest;
            },
          }),
        ],
      });
      const profile = {
        id: "pig.research",
        extensions: security(),
        instructions: options.research.instructions,
      };
      const research = options.research;
      const delegate = defineTool({
        // Static metadata matches createDelegationExtensions; its implementation still owns child/task/doc semantics.
        name: "delegate",
        description:
          "Research one bounded question in a fresh, task-owned, read-only child conversation. Returns a saved short conclusion, evidence and unresolved issues.",
        replay: "unsafe",
        outputLimits: { maxBytes: 8000 * 4, maxLines: 1000 },
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["task"],
          properties: {
            task: { type: "string", minLength: 1, maxLength: 8000 },
          },
        },
        async execute(args, api, context) {
          const workspace = await bind(boundary);
          const parent = await workspace.harness.conversation(
            api.conversationId,
            context,
          );
          if (!parent) throw new Error("Delegation parent missing");
          const selected = research.inheritParent
            ? (await parent.agent(context)).model
            : research.model;
          if (
            !selected ||
            !(await workspace.models.getAvailable()).some(
              (model) =>
                model.provider === selected.provider &&
                model.id === selected.modelId,
            )
          )
            throw new Error(
              "DELEGATION_MODEL_UNAVAILABLE: choose an available parent/research model",
            );
          const model = Object.freeze({
            provider: selected.provider,
            modelId: selected.modelId,
          });
          const invocation = createDelegationExtensions({
            readTool: read,
            model,
            cwd: identity.cwd,
            profile,
            maxTurns: 8,
            maxConcurrency: 2,
            maxDepth: 1,
            maxReturnChars: 8000,
            inspectAgent: async (id, ctx) => {
              const conversation = await workspace.harness.conversation(
                id,
                ctx,
              );
              if (!conversation)
                throw new Error("Research conversation missing");
              return conversation.agent(ctx);
            },
          }).extension.tools?.[0];
          if (!invocation) throw new Error("Native delegation tool missing");
          return invocation.execute(args, api, context);
        },
      });
      const execution = defineExtension({
        name: "pig.delegation",
        tools: [boundary.wrap(delegate)],
      });
      builtins.push(execution, researchExtension);
      allTools = [...allTools, ...(execution.tools ?? [])];
    }
    const required = security();
    const extensions = [...builtins, ...external, ...required];
    const extensionByName = new Map(
      extensions.map((extension) => [extension.name, extension]),
    );
    const toolByName = new Map(allTools.map((tool) => [tool.name, tool]));
    const remap = (profile: AgentProfile): AgentProfile => ({
      ...profile,
      extensions: [
        ...profile.extensions.map((extension) => {
          const resolved = extensionByName.get(extension.name);
          if (!resolved) throw new Error("Unknown selected extension");
          return resolved;
        }),
        ...required,
      ],
      tools: profile.tools.map((tool) => {
        const resolved = toolByName.get(tool.name);
        if (!resolved) throw new Error("Unknown selected tool");
        return resolved;
      }),
      ...(profile.modelTools
        ? {
            modelTools: profile.modelTools.map((tool) => {
              const resolved = toolByName.get(tool.name);
              if (!resolved) throw new Error("Unknown model tool");
              return resolved;
            }),
          }
        : {}),
    });
    const profiles = Object.fromEntries(
      Object.entries(runtime.profiles ?? {}).map(([id, profile]) => [
        id,
        remap(profile),
      ]),
    );
    if (!Object.keys(profiles).length)
      profiles.default = {
        extensions: [
          ...builtins.filter((extension) => extension.name !== "pig.research"),
          ...required,
        ],
        tools: builtins
          .filter((extension) => extension.name !== "pig.research")
          .flatMap((extension) => extension.tools ?? []),
        ...(options.defaultModel ? { model: options.defaultModel } : {}),
        thinkingLevel: "off",
        cwd: identity.cwd,
      };
    const defaultProfile =
      runtime.defaultProfile ?? (profiles.default ? "default" : undefined);
    if (!defaultProfile)
      throw new Error("Explicit defaultProfile required with named profiles");
    const policy = builtinRuntimeCompatibility({
      extensions,
      opaque: !!runtime.extensions?.length || !!runtime.conversationCreated,
      storage: {
        scanDocuments: (...args) => {
          if (!boundary.workspace) throw new Error("WORKSPACE_NOT_READY");
          return boundary.workspace.storageMetadata.scanDocuments(...args);
        },
        scanSubmissions: (...args) => {
          if (!boundary.workspace) throw new Error("WORKSPACE_NOT_READY");
          return boundary.workspace.storageMetadata.scanSubmissions(...args);
        },
      },
    });
    const assembled: RuntimeConfig = {
      extensions,
      providers: fresh,
      profiles,
      defaultProfile,
      conversationCreated: async (tx, record) => {
        await policy.admit(tx);
        await tx.doc(Todos, record.id);
        await tx.doc(Delegations, record.id);
        await tx.doc(NativeApprovals, record.id);
        await runtime.conversationCreated?.(tx, record);
      },
    };
    const admit = assembled.conversationCreated;
    if (!admit) throw new Error("APPLICATION_ADMISSION_REQUIRED");
    compatibility.set(admit, policy);
    return assembled;
  }
  const loader =
    options.configLoader ??
    (options.configFile ? new ConfigLoader(options.configFile) : undefined);
  // Adapt only the apply candidate, not loading/caching/acceptance. ConfigLoader still owns last-good
  // publication and cleanup; Host still stages/gates every workspace before its synchronous apply.
  const hostLoader =
    loader &&
    new Proxy(loader, {
      get(target, key) {
        if (key === "reload")
          return (gate?: ConfigApplyGate) =>
            target.reload(async (candidate, accepted) => {
              if (!gate) throw new Error("Native host config gate required");
              const decision = await gate(
                { ...candidate, config: withAdapters(candidate.config) },
                accepted,
              );
              if (decision.status !== "ready") return decision;
              return {
                ...decision,
                apply() {
                  decision.apply?.();
                  activeRuntime = candidate.config.runtime;
                },
              };
            });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const ready = async (address: SessionAddress) => {
    const projection = projections.get(address.sessionId);
    if (!projection || !sameSession(projection.address, address))
      throw new Error("STALE_APPLICATION_PROJECTION");
    let pending: Promise<void>;
    do {
      pending = projection.ready;
      await pending;
      projection.assertLive();
    } while (pending !== projection.ready);
  };
  const attachUI: NonNullable<DurableHostOptions["attachUI"]> = (input) => {
    const parsed = parseConversationAppId(input.address.sessionId);
    const pending = boundaries.get(parsed.workspaceKey);
    if (!pending) throw new Error("WORKSPACE_BOUNDARY_MISSING");
    const ui = createNativeUIHost({ ...input, emit: options.emitUI });
    let closed = false,
      disconnected = false,
      generation = 0;
    let resourcesReady = false,
      nativeReady = false;
    let cleanup: void | (() => void | Promise<void>);
    let attachedBoundary: Boundary | undefined;
    let controller: AbortController | undefined;
    let detaching = Promise.resolve(),
      tail = Promise.resolve();
    let disposal: Promise<void> | undefined;
    const assertLive = () => {
      if (closed || disconnected || disposed || input.signal.aborted)
        throw new Error("APPLICATION_PROJECTION_DETACHED");
    };
    const projection: Projection = {
      address: { ...input.address },
      assertLive,
      ready: tail,
    };
    const detach = () => {
      if (disconnected) return;
      disconnected = true;
      generation++;
      controller?.abort(new Error("APPLICATION_PROJECTION_DISCONNECTED"));
      // Disable bindings synchronously, before cancellation replies can become durable denials.
      if (attachedBoundary)
        detaching = attachedBoundary.approvals.detach(parsed.id);
      void detaching.catch(() => {}); // Reconnect/dispose await and surface cleanup failure.
      ui.cancelAll("disconnect"); // Keep the native ports/status/epoch, cancel only disposable dialogs.
    };
    const onClose = () => {
      closed = true;
      detach();
    };
    input.signal.addEventListener("abort", onClose, { once: true });
    const start = () => {
      const current = ++generation;
      const lifetime = new AbortController();
      controller = lifetime;
      const assertCurrent = () => {
        assertLive();
        if (current !== generation || lifetime.signal.aborted)
          throw new Error("APPLICATION_PROJECTION_SUPERSEDED");
      };
      // Serialize watch acquisition, including completions that arrive after disconnect/dispose.
      const job = tail.then(async () => {
        const boundary = await pending;
        attachedBoundary = boundary;
        await detaching;
        const workspace = await bind(boundary);
        assertCurrent();
        try {
          await boundary.approvals.attach(
            parsed.id,
            input.address,
            withAbortSignal(lifetime.signal, BACKGROUND_CONTEXT),
          );
          assertCurrent();
          if (!resourcesReady) {
            const globalFiles = await inspectResourceSelection(
              boundary.selection.global,
              { signal: lifetime.signal },
            );
            if (
              globalFiles.some((file) =>
                resourcePathWithin(boundary.identity.cwd, file.path),
              )
            )
              throw new Error("PROJECT_RESOURCE_CANNOT_BE_GLOBAL");
            const global = await loadResources(boundary.selection.global, {
              trustedProjectPaths: globalFiles.map((file) => file.path),
              signal: lifetime.signal,
            });
            if (!global.ok)
              throw new ResourceSelectionError(global.diagnostics);
            const trust = await resolveProjectTrust(
              boundary.identity.cwd,
              boundary.selection.project,
              input.address,
              input.broker,
              lifetime.signal,
              {
                directory: options.modelDirectory,
                approvalScope: input.signal,
              },
            );
            const project = await loadResources(
              trust.trusted ? boundary.selection.project : emptySelection,
              {
                trustedProjectPaths: trust.trustedProjectPaths,
                signal: lifetime.signal,
              },
            );
            if (!project.ok)
              throw new ResourceSelectionError(project.diagnostics);
            assertCurrent();
            const snapshot: ResourceSnapshot = Object.freeze({
              instructions: [
                ...global.snapshot.instructions,
                ...project.snapshot.instructions,
              ],
              skills: [...global.snapshot.skills, ...project.snapshot.skills],
              prompts: [
                ...global.snapshot.prompts,
                ...project.snapshot.prompts,
              ],
            });
            for (const kind of ["skills", "prompts"] as const)
              if (
                new Set(snapshot[kind].map((entry) => entry.name)).size !==
                snapshot[kind].length
              )
                throw new Error(`Duplicate selected ${kind} name`);
            boundary.snapshots.set(parsed.id, snapshot);
            resourcesReady = true;
          }
          await workspace.harness.commit(
            (tx) => reconcileDelegations(tx, parsed.id),
            BACKGROUND_CONTEXT,
          );
          if (!nativeReady) {
            cleanup = await options.attachNativeUI?.({
              address: input.address,
              signal: input.signal,
              ui: ui.ui,
            });
            nativeReady = true;
          }
          assertCurrent();
        } catch (error) {
          await boundary.approvals.detach(parsed.id);
          throw error;
        }
      });
      projection.ready = job; // Replace BEFORE awaiting: prompt/ready now observe this projection generation.
      tail = job.catch(() => {}); // Keep readiness rejecting for callers without an unhandled rejection.
      return job;
    };
    projections.set(input.address.sessionId, projection);
    start();
    const attachment: NativeUIAttachment = {
      status: () => ui.getStatus(),
      disconnect: detach,
      reconnect() {
        if (closed || disposed || input.signal.aborted)
          return Promise.reject(new Error("APPLICATION_PROJECTION_DETACHED"));
        if (!disconnected) return projection.ready;
        disconnected = false;
        return start();
      },
      dispose() {
        if (disposal) return disposal;
        onClose();
        input.signal.removeEventListener("abort", onClose);
        if (projections.get(input.address.sessionId) === projection)
          projections.delete(input.address.sessionId);
        disposal = (async () => {
          await tail;
          try {
            await detaching;
            await (await pending).approvals.detach(parsed.id);
          } finally {
            try {
              await cleanup?.();
            } finally {
              ui.dispose();
            }
          }
        })();
        return disposal;
      },
    };
    return attachment;
  };
  host = new DurableHost({
    dataRoot: options.dataRoot,
    modelDirectory: options.modelDirectory,
    credentials: options.credentials,
    config: withAdapters(options.config ?? { apiVersion: 2 }),
    configLoader: hostLoader,
    createRuntimeConfig: assemble,
    createModels: options.createModels,
    settings: options.harnessSettings,
    prepareResume: async (workspace, inspection) => {
      const boundary = await boundaryFor(workspace.identity);
      boundary.workspace = workspace; // Native env may resolve while Host.workspace is still opening.
      const policy = policyFor(workspace.runtime);
      await policy.initialize(workspace);
      const saved = await workspace.harness.commit(
        (tx) => tx.scanConversations({}, 1),
        BACKGROUND_CONTEXT,
      );
      if (saved.items.length && !options.validateResume) {
        const rejected = await policy.validateResume(workspace, inspection);
        if (rejected) throw new Error(rejected);
      }
      const ids = new Set([
        ...inspection.tasks.map((task) => task.record.conversationId),
        ...inspection.submissions.map(
          (submission) => submission.conversationId,
        ),
      ]);
      if (!ids.size) return;
      const globalFiles = await inspectResourceSelection(
        boundary.selection.global,
      );
      if (
        globalFiles.some((file) =>
          resourcePathWithin(workspace.identity.cwd, file.path),
        )
      )
        throw new Error("PROJECT_RESOURCE_CANNOT_BE_GLOBAL");
      const projectFiles = await selectedProjectResources(
        workspace.identity.cwd,
        boundary.selection.project,
      );
      if (
        projectFiles.length &&
        !(await isProjectTrusted(
          workspace.identity.cwd,
          options.modelDirectory,
        ))
      )
        throw new Error(
          "RECOVERY_RESOURCE_TRUST_REQUIRED: persist trust before resuming selected project bytes",
        );
      const global = await loadResources(boundary.selection.global, {
        trustedProjectPaths: globalFiles.map((file) => file.path),
      });
      const project = await loadResources(boundary.selection.project, {
        trustedProjectPaths: projectFiles.map((file) => file.path),
      });
      if (!global.ok) throw new ResourceSelectionError(global.diagnostics);
      if (!project.ok) throw new ResourceSelectionError(project.diagnostics);
      const snapshot: ResourceSnapshot = Object.freeze({
        instructions: [
          ...global.snapshot.instructions,
          ...project.snapshot.instructions,
        ],
        skills: [...global.snapshot.skills, ...project.snapshot.skills],
        prompts: [...global.snapshot.prompts, ...project.snapshot.prompts],
      });
      for (const kind of ["skills", "prompts"] as const)
        if (
          new Set(snapshot[kind].map((entry) => entry.name)).size !==
          snapshot[kind].length
        )
          throw new Error(`Duplicate selected ${kind} name`);
      for (const id of ids) boundary.snapshots.set(id, snapshot);
      if (disposed) throw new Error("APPLICATION_RUNTIME_DISPOSED");
    },
    validateResume:
      options.validateResume ??
      ((workspace, inspection) =>
        policyFor(workspace.runtime).validateResume(workspace, inspection)),
    checkCompatibility:
      options.checkCompatibility ??
      ((input) =>
        policyFor(input.current).checkCompatibility(
          input,
          policyFor(input.next),
        )),
    pendingDependencies: async (workspace) => {
      if (
        host.broker
          .pending()
          .some(
            (request) =>
              parseConversationAppId(request.sessionId).workspaceKey ===
              workspace.identity.key,
          )
      )
        return "Native UI/approval dependency is pending";
      return policyFor(workspace.runtime).pendingDependencies(workspace);
    },
    emit: options.emit,
    emitUI: options.emitUI,
    emitSession: options.emitSession,
    disabled: options.disabled,
    modelInfo: options.modelInfo,
    defaultEffort: options.defaultEffort,
    onReport: options.onReport,
    onFailure: options.onFailure,
    projectorImagePolicy: (value) => image.project(value),
    connectionNow: options.connectionNow,
    attachUI,
    env: async (target, context) => {
      const metadata = await target.read.snapshot(
        PigConversationMeta,
        target.conversationId,
        context,
      );
      if (!metadata) throw new Error("ENV_WORKSPACE_MEMBERSHIP_MISSING");
      const boundary = await boundaryFor(
        await workspaceIdentity(metadata.canonicalCwd),
      );
      assertConversationMembership(
        metadata,
        boundary.identity,
        target.conversationId,
      );
      await bind(boundary);
      return boundary.environment(target.conversationId); // AgentDoc.cwd is never an authorization grant.
    },
    prepareInput: async (params, model, context) => {
      await ready(params);
      context.abortSignal?.throwIfAborted();
      const parsed = parseConversationAppId(params.sessionId);
      const pending = boundaries.get(parsed.workspaceKey);
      if (!pending) throw new Error("WORKSPACE_BOUNDARY_MISSING");
      const boundary = await pending;
      const conversation = await (await bind(boundary)).harness.conversation(
        parsed.id,
        context,
      );
      if (!conversation) throw new Error("PROMPT_CONVERSATION_MISSING");
      requirePolicy(await conversation.agent(context));
      const text = expandInput(
        params.text,
        boundary.snapshots.get(parsed.id) ?? emptySnapshot,
      );
      const content: UserInput = [
        { type: "text", text },
        ...(params.images ?? []),
      ];
      return image.prepareInput(content, options.imageLimits?.(model)); // Host receipts hash ORIGINAL params.
    },
  });
  return {
    host,
    ready,
    async connect(input) {
      // Public heartbeat sweeps expired leases before host.connect makes the broker available again.
      host.heartbeat(input);
      const reconnect = !host.broker.isAvailable();
      host.connect(input);
      if (reconnect) {
        connectionReady = host.reconnectUI();
        void connectionReady.catch(() => {});
      }
      await connectionReady;
    },
    async reload(config) {
      try {
        const result = await host.reload(
          config === undefined ? undefined : withAdapters(config),
        );
        if (result.state === "applied" && config !== undefined)
          activeRuntime = config.runtime;
        return result;
      } catch (error) {
        return {
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async abort(address) {
      // Validate the live epoch through the public Host before touching durable approvals.
      await host.getSnapshot(address);
      const parsed = parseConversationAppId(address.sessionId);
      const boundary = await boundaries.get(parsed.workspaceKey);
      if (!boundary) throw new Error("WORKSPACE_BOUNDARY_MISSING");
      await boundary.approvals.cancel(parsed.id, BACKGROUND_CONTEXT);
      await host.abort(address);
    },
    async resolveUI(reply) {
      await host.getSnapshot(reply);
      const parsed = parseConversationAppId(reply.sessionId);
      const boundary = await boundaries.get(parsed.workspaceKey);
      if (boundary?.approvals.owns(reply))
        await boundary.approvals.resolve(reply);
      else host.resolveUI(reply);
    },
    async selectedProjectResources(cwd, signal) {
      const boundary = await boundaryFor(await workspaceIdentity(cwd));
      return selectedProjectResources(
        boundary.identity.cwd,
        boundary.selection.project,
        signal,
      );
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        const errors: unknown[] = [];
        try {
          await host.dispose();
        } catch (error) {
          errors.push(error);
        }
        const opened = await Promise.allSettled(boundaries.values());
        const cleanups = await Promise.allSettled([
          ...opened.flatMap((entry) =>
            entry.status === "fulfilled"
              ? [entry.value.approvals.dispose()]
              : [],
          ),
          ...[...environments].map((env) => env.cleanup(BACKGROUND_CONTEXT)),
        ]);
        errors.push(
          ...cleanups.flatMap((entry) =>
            entry.status === "rejected" ? [entry.reason] : [],
          ),
        );
        projections.clear();
        environments.clear();
        boundaries.clear();
        if (errors.length)
          throw new AggregateError(
            errors,
            "Application runtime shutdown failed",
          );
      })();
      return disposal;
    },
  };
}
