import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  defineExtension,
  type ToolExecutionApi,
  type ToolRegistration,
  wrapTool,
} from "@earendil-works/pi-durable";

export type ToolIdentity = Pick<
  ToolExecutionApi,
  "taskId" | "conversationId" | "callId"
> & { toolName: string };
export type ToolOwner = ToolIdentity & {
  readonly profileId: string;
  readonly policyRevision: number;
  readonly readOnly: boolean;
  /** Actual callable tools, not merely modelTools. */
  readonly tools: readonly string[];
  readonly roots: readonly string[];
  /** App-owned read-only artifacts (e.g. this conversation's native spill files).
   * Never populate from model arguments or by granting the whole data directory. */
  readonly readRoots?: readonly string[];
};
export type FinalCommandPlan = {
  readonly kind: "exec";
  readonly transport: "rtk-proxy";
  readonly program: string;
  readonly args: readonly string[];
  readonly script: string | null;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly policyRevision: number;
};
export type FileOperation = {
  readonly kind: "file";
  readonly action: string;
  readonly paths: readonly string[];
  readonly contentHash: string | null;
  readonly policyRevision: number;
};
/** Optional beforeTool permission intent for tools whose effect is an app-owned
 * native document operation, rather than exec/fs. It is NOT an exec grant. */
export type ToolIntentOperation = {
  readonly kind: "tool";
  readonly name: string;
  readonly argumentsJson: string;
  readonly policyRevision: number;
};
export type NativeOperation =
  | FinalCommandPlan
  | FileOperation
  | ToolIntentOperation;

/** Canonical, order-independent JSON hashing. No command source goes into UI IDs/logs. */
export function operationHash(value: unknown): string {
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, ordered(child)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}

/** Resolve missing descendants via the nearest existing parent. A dangling link
 * is not a missing directory and must not bypass the realpath check. */
export async function canonicalOperationPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await lstat(absolute);
      throw new Error("Unresolvable symbolic link");
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT")
        throw statError;
    }
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(
      await canonicalOperationPath(parent),
      relative(parent, absolute),
    );
  }
}
function contains(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === "" ||
    (!isAbsolute(part) &&
      part !== ".." &&
      !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}

export type NativeToolPolicyOptions = {
  /** Must resolve the app-owned effective profile, including task-owned children. */
  resolveOwner(identity: ToolIdentity, context: Context): Promise<ToolOwner>;
  /** Mandatory final boundary; resolve only after current policy/approval CAS. */
  authorize(
    owner: ToolOwner,
    operation: NativeOperation,
    context: Context,
  ): Promise<undefined | (() => void)>;
};
type Scope = { owner: ToolOwner; parents: readonly ToolOwner[]; live: boolean };

/** Capability boundary, not a sandbox for trusted JS using node:fs directly. */
export function createNativeToolPolicy(options: NativeToolPolicyOptions) {
  const scopes = new AsyncLocalStorage<Scope>();
  const current = (): Scope => {
    const scope = scopes.getStore();
    if (!scope?.live) throw new Error("No active policy-wrapped tool owner");
    return scope;
  };
  const assertCallable = (owner: ToolOwner, name: string) => {
    if (!owner.tools.includes(name) || (owner.readOnly && name !== "read"))
      throw new Error(
        `Tool ${name} is not callable by profile ${owner.profileId}`,
      );
  };
  const refresh = async (context: Context) => {
    const scope = current();
    if (context.abortSignal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    const latest = await options.resolveOwner(scope.owner, context);
    if (operationHash(latest) !== operationHash(scope.owner))
      throw new Error("Tool policy changed; retry with a new authorization");
    return scope;
  };
  const path = async (
    input: string,
    cwd: string,
    context: Context,
    write = false,
  ) => {
    const scope = await refresh(context);
    const canonical = await canonicalOperationPath(resolve(cwd, input));
    for (const owner of [scope.owner, ...scope.parents]) {
      if (write && owner.readOnly)
        throw new Error("Read-only owner cannot mutate files");
      const roots = await Promise.all(
        (write
          ? owner.roots
          : [...owner.roots, ...(owner.readRoots ?? [])]
        ).map((root) => realpath(root)),
      );
      if (!roots.some((root) => contains(root, canonical)))
        throw new Error("Path is outside authorized project roots");
    }
    return canonical;
  };
  const authorize = async (operation: NativeOperation, context: Context) => {
    const scope = await refresh(context);
    if ([scope.owner, ...scope.parents].some((owner) => owner.readOnly))
      throw new Error("Read-only owner cannot write or execute commands");
    if (operation.policyRevision !== scope.owner.policyRevision)
      throw new Error("Operation policy revision changed");
    const lease = await options.authorize(scope.owner, operation, context);
    await refresh(context);
    return () => {
      current();
      if (context.abortSignal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      lease?.();
    };
  };
  const wrap = <T extends ToolRegistration>(tool: T): T => ({
    ...tool,
    // Generic env-capable tools cannot promise safe side-effect replay.
    replay: "unsafe",
    async execute(args, api, context) {
      const parent = scopes.getStore();
      const resolved = await options.resolveOwner(
        {
          taskId: api.taskId,
          conversationId: api.conversationId,
          callId: api.callId,
          toolName: tool.name,
        },
        context,
      );
      if (
        resolved.taskId !== api.taskId ||
        resolved.conversationId !== api.conversationId ||
        resolved.callId !== api.callId ||
        resolved.toolName !== tool.name
      )
        throw new Error("Tool owner identity mismatch");
      assertCallable(resolved, tool.name);
      if (parent?.live) assertCallable(parent.owner, tool.name);
      const owner = Object.freeze({
        ...resolved,
        tools: Object.freeze([...resolved.tools]),
        roots: Object.freeze([...resolved.roots]),
        ...(resolved.readRoots
          ? { readRoots: Object.freeze([...resolved.readRoots]) }
          : {}),
      });
      const scope: Scope = {
        owner,
        parents: parent?.live ? [parent.owner, ...parent.parents] : [],
        live: true,
      };
      try {
        return await scopes.run(scope, () =>
          tool.execute(
            args,
            {
              ...api,
              async executeTool(
                name,
                nestedArgs,
                nestedContext,
                nestedOptions,
              ) {
                for (const entry of [owner, ...scope.parents])
                  assertCallable(entry, name);
                return api.executeTool(
                  name,
                  nestedArgs,
                  nestedContext,
                  nestedOptions,
                );
              },
            },
            context,
          ),
        );
      } finally {
        scope.live = false;
      }
    },
  });
  return {
    currentOwner: () => current().owner,
    path,
    authorize,
    wrap,
    /** Select this extension LAST, for every resolved callable tool, on EVERY profile.
     * Rebuild it on registry reload. Profile selection must not remove it. */
    extension(tools: readonly ToolRegistration[]) {
      return defineExtension({
        name: "pig.tool-policy",
        wraps: tools.map((tool) => wrapTool(tool, wrap)),
      });
    },
  };
}
export type NativeToolPolicy = ReturnType<typeof createNativeToolPolicy>;
