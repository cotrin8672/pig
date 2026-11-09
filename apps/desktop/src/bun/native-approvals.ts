import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import {
  type ConversationId,
  type DocumentWatch,
  defineDoc,
  defineExtension,
  type Harness,
  type HookApi,
  hook,
  type TaskId,
  type ToolHookCall,
  ToolTask,
  type Tx,
} from "@earendil-works/pi-durable";
import type { UIReply } from "../shared/extension-ui";
import type { SessionAddress, UIAddress } from "../shared/runtime-contract";
import {
  type NativeOperation,
  operationHash,
  type ToolOwner,
} from "./native-tool-policy";
import {
  sameSession,
  type UIRequestBroker,
  validateSession,
} from "./ui-request-broker";

export type ApprovalRequest = {
  requestId: string;
  taskId: TaskId;
  callId: string;
  toolName: string;
  operationHash: string;
  operationKind: NativeOperation["kind"];
  policyRevision: number;
  revision: number;
  expiresAt: number;
  description: string;
  consumed: boolean;
  stage: "before-intent" | "final-operation";
  state: "pending" | "approved" | "denied" | "expired" | "cancelled";
};
export type ApprovalState = {
  revision: number;
  requests: Record<string, ApprovalRequest>;
};
export const NativeApprovals = defineDoc<ApprovalState>({
  kind: "pig.approvals",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ revision: 0, requests: {} }),
  checkpointWhen: () => true,
});
type ApprovalHarness = Pick<Harness, "commit" | "watchDoc">;
type Binding = Readonly<
  ApprovalRequest & UIAddress & { conversationId: ConversationId }
>;
type Attachment = {
  conversationId: ConversationId;
  address: SessionAddress;
  watch: DocumentWatch<ApprovalState>;
  context: Context;
  active: boolean;
};
export type NativeApprovalOptions = {
  /** HookApi cannot commit/watch. Inject the public Harness in a host closure. */
  harness(): ApprovalHarness;
  broker: UIRequestBroker;
  resolveOwner(
    call: ToolHookCall,
    api: HookApi,
    context: Context,
  ): Promise<ToolOwner>;
  /** Standard shell: env.planTool(call, owner). Unknown execs wait only at the
   * final boundary, AFTER unsafe native intent, and cannot replay on recovery.
   * Return a ToolIntentOperation for other tools when app tool-call permissions
   * require approval; returning undefined skips ONLY the before-intent prompt. */
  planTool(
    call: ToolHookCall,
    owner: ToolOwner,
    context: Context,
  ): Promise<NativeOperation | undefined>;
  now?: () => number;
  ttlMs?: number;
};

/** Durable document is authoritative; broker requests are disposable projections.
 * This module never invokes Tool.execute, nor changes native task replay states. */
export function createNativeApprovals(options: NativeApprovalOptions) {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 5 * 60_000;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 2_147_000_000)
    throw new RangeError("Invalid approval expiry");
  const revocations = new Map<string, number>();
  const revokeKey = (conversationId: ConversationId, taskId?: TaskId) =>
    `${conversationId}:${taskId ?? "all"}`;
  const bindings = new Map<string, Binding>();
  const attachments = new Map<ConversationId, Attachment>();
  const decisionJobs = new Map<string, Promise<void>>();
  const key = (address: UIAddress) =>
    JSON.stringify([
      address.hostId,
      address.sessionId,
      address.epoch,
      address.uiId,
    ]);
  const matching = (a: ApprovalRequest, b: ApprovalRequest) =>
    a.requestId === b.requestId &&
    a.taskId === b.taskId &&
    a.callId === b.callId &&
    a.operationHash === b.operationHash &&
    a.operationKind === b.operationKind &&
    a.revision === b.revision &&
    a.expiresAt === b.expiresAt &&
    a.policyRevision === b.policyRevision &&
    a.stage === b.stage;
  const liveTask = async (
    tx: Tx,
    owner: Pick<ToolOwner, "taskId" | "conversationId" | "callId">,
    stage?: ApprovalRequest["stage"],
  ) => {
    const task = await tx.task(owner.taskId);
    if (
      !task ||
      task.kind !== ToolTask.definition.name ||
      task.conversationId !== owner.conversationId ||
      task.abortRequested ||
      task.state.status === "terminal" ||
      task.state.status === "completing"
    )
      throw new Error("Approval task is not live");
    const input = task.input as { callId?: string; call?: { id: string } };
    if ((input.callId ?? input.call?.id) !== owner.callId)
      throw new Error("Approval call identity mismatch");
    const checkpoint = task.state.checkpoint as {
      phase?: string;
      replay?: string;
    };
    if (stage === "before-intent" && checkpoint.phase !== "call")
      throw new Error(
        "Cannot recreate before-intent approval after execute intent",
      );
    if (
      stage === "final-operation" &&
      (checkpoint.phase !== "execute" || checkpoint.replay !== "unsafe")
    )
      throw new Error(
        "Final side effects require native unsafe execute intent",
      );
  };
  const expire = async (conversationId: ConversationId, context: Context) =>
    options.harness().commit(async (tx) => {
      const doc = await tx.doc(NativeApprovals, conversationId);
      for (const request of Object.values(doc.requests))
        if (
          (request.state === "pending" || request.state === "approved") &&
          request.expiresAt <= now()
        )
          request.state = "expired";
    }, context);
  const check = async (
    owner: ToolOwner,
    expected: ApprovalRequest,
    context: Context,
  ) =>
    options.harness().commit(async (tx) => {
      await liveTask(tx, owner, "final-operation");
      const doc = await tx.doc(NativeApprovals, owner.conversationId);
      const request = doc.requests[expected.requestId];
      if (
        !request ||
        !matching(request, expected) ||
        request.state !== "approved" ||
        request.consumed ||
        request.expiresAt <= now()
      )
        throw new Error("Approval is stale, expired, consumed or not approved");
      request.consumed = true; // One final operation, never a reusable shell capability.
    }, context);
  const wait = async (
    conversationId: ConversationId,
    expected: ApprovalRequest,
    context: Context,
  ): Promise<void> => {
    const watch = await options
      .harness()
      .watchDoc(NativeApprovals, conversationId, context);
    if (!watch) throw new Error("Approval document unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const inspect = (state: Readonly<ApprovalState>) => {
          const request = state.requests[expected.requestId];
          if (!request || !matching(request, expected)) {
            reject(new Error("Approval request changed"));
            return;
          }
          if (request.expiresAt <= now()) {
            reject(new Error("Approval expired"));
            return;
          }
          if (request.state === "approved") resolve();
          else if (request.state !== "pending")
            reject(new Error(`Approval ${request.state}`));
        };
        // Acquisition value is a real revision, not an event that start replays.
        inspect(watch.value);
        watch.start(async (call) => {
          if (call.kind === "failed" || call.retired)
            reject(new Error("Approval watch unavailable"));
          else inspect(call.value);
        });
        void watch.closed.then(() =>
          reject(new Error("Approval wait interrupted; no operation executed")),
        );
        timer = setTimeout(
          () => {
            reject(new Error("Approval expired"));
            void expire(conversationId, withoutAbortSignal(context)).catch(
              () => {},
            );
          },
          Math.max(0, expected.expiresAt - now()),
        );
      });
    } finally {
      clearTimeout(timer);
      await watch.stop();
    }
  };
  const request = async (
    owner: ToolOwner,
    operation: NativeOperation,
    stage: ApprovalRequest["stage"],
    context: Context,
  ): Promise<ApprovalRequest> => {
    if (context.abortSignal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    const hash = operationHash(operation);
    const expected = await options.harness().commit(async (tx) => {
      await liveTask(tx, owner, stage);
      const doc = await tx.doc(NativeApprovals, owner.conversationId);
      const sameCall = Object.values(doc.requests).filter(
        (r) => r.taskId === owner.taskId && r.callId === owner.callId,
      );
      // The pre-intent plan is a commitment, not a broad shell permission. Any
      // prefix/env/cwd/argv/rewrite change must return to a NEW native call.
      const planned = sameCall
        .filter(
          (r) => r.stage === "before-intent" && r.operationKind === "exec",
        )
        .sort((a, b) => b.revision - a.revision)[0];
      if (
        stage === "final-operation" &&
        planned &&
        (planned.operationHash !== hash ||
          planned.policyRevision !== owner.policyRevision)
      )
        throw new Error(
          "Final operation changed after beforeTool authorization",
        );
      const prior = sameCall.find(
        (r) =>
          r.operationHash === hash && r.policyRevision === owner.policyRevision,
      );
      if (prior) {
        if (prior.expiresAt <= now()) prior.state = "expired";
        return { ...prior }; // tx.doc values are Draft proxies, not cloneable objects.
      }
      for (const previous of sameCall)
        if (previous.state === "pending" || previous.state === "approved")
          previous.state = "cancelled";
      if (Object.keys(doc.requests).length >= 1024)
        throw new Error("Approval request limit reached");
      const description =
        operation.kind === "exec"
          ? `RTK proxy target: ${operation.program}\nArguments: ${JSON.stringify(operation.args)}\nCwd: ${operation.cwd}\nEnvironment SHA-256: ${operationHash(operation.env)}`
          : operation.kind === "tool"
            ? `${operation.name}\nArguments: ${operation.argumentsJson}`
            : `${operation.action}: ${JSON.stringify(operation.paths)}\nContent SHA-256: ${operation.contentHash ?? "none"}`;
      if (Buffer.byteLength(description) > 64 * 1024)
        throw new Error("Operation is too large for safe approval display");
      const revision = ++doc.revision;
      const item: ApprovalRequest = {
        requestId: operationHash([owner.taskId, owner.callId, hash, revision]),
        taskId: owner.taskId,
        callId: owner.callId,
        toolName: owner.toolName,
        operationHash: hash,
        operationKind: operation.kind,
        policyRevision: owner.policyRevision,
        revision,
        expiresAt: now() + ttl,
        description,
        consumed: false,
        stage,
        state: "pending",
      };
      doc.requests[item.requestId] = item;
      return structuredClone(item);
    }, context);
    await wait(owner.conversationId, expected, context);
    return expected;
  };
  const cancelProjection = (binding: Binding) => {
    bindings.delete(key(binding)); // remove BEFORE broker cancellation resolves its promise
    options.broker.cancel(binding);
  };
  const decision = async (
    binding: Binding,
    reply: UIReply,
    context: Context,
  ) => {
    const id = key(binding);
    const attachment = attachments.get(binding.conversationId);
    if (
      bindings.get(id) !== binding ||
      !attachment?.active ||
      !sameSession(attachment.address, reply)
    )
      return;
    // setAvailable(false) cancels every broker dialog: disconnect is NOT denial.
    if (!options.broker.isAvailable(binding)) {
      bindings.delete(id);
      return;
    }
    await options.harness().commit(async (tx) => {
      if (
        bindings.get(id) !== binding ||
        !attachment.active ||
        !sameSession(attachment.address, reply)
      )
        return;
      await liveTask(tx, {
        ...binding,
        conversationId: binding.conversationId,
      });
      const doc = await tx.doc(NativeApprovals, binding.conversationId);
      const current = doc.requests[binding.requestId];
      if (
        !current ||
        !matching(current, binding) ||
        current.state !== "pending"
      )
        throw new Error("Stale approval reply");
      if (current.expiresAt <= now()) current.state = "expired";
      else
        current.state =
          reply.kind === "confirm"
            ? reply.value
              ? "approved"
              : "denied"
            : "cancelled";
    }, context);
    bindings.delete(id);
  };
  const project = (attachment: Attachment, state: Readonly<ApprovalState>) => {
    if (!attachment.active) return;
    for (const binding of [...bindings.values()]) {
      if (binding.conversationId !== attachment.conversationId) continue;
      const current = state.requests[binding.requestId];
      if (
        !current ||
        !matching(current, binding) ||
        current.state !== "pending" ||
        current.expiresAt <= now()
      )
        cancelProjection(binding);
    }
    for (const item of Object.values(state.requests)) {
      if (
        item.state !== "pending" ||
        item.expiresAt <= now() ||
        !options.broker.isAvailable(attachment.address)
      )
        continue;
      if (
        [...bindings.values()].some(
          (binding) =>
            binding.conversationId === attachment.conversationId &&
            matching(binding, item),
        )
      )
        continue;
      const binding: Binding = Object.freeze({
        ...item,
        ...attachment.address,
        conversationId: attachment.conversationId,
        uiId: randomUUID(),
      });
      const id = key(binding);
      bindings.set(id, binding);
      // UI is deliberately not given a mutable operation or environment secrets.
      const pending = options.broker.request({
        ...attachment.address,
        uiId: binding.uiId,
        kind: "confirm",
        title: `Allow ${item.toolName}?`,
        message: `${item.description}\nOperation SHA-256: ${item.operationHash}`,
        // Durable clock is authoritative; broker uses real wall time.
        expiresAt: Date.now() + Math.max(0, item.expiresAt - now()),
      });
      const job = pending.then((reply) =>
        decision(binding, reply, attachment.context),
      );
      decisionJobs.set(id, job);
      void job
        .catch(() => {})
        .finally(() => {
          decisionJobs.delete(id);
        });
    }
  };
  const detach = async (conversationId: ConversationId) => {
    const attachment = attachments.get(conversationId);
    if (!attachment) return;
    attachment.active = false;
    attachments.delete(conversationId);
    for (const binding of [...bindings.values()])
      if (binding.conversationId === conversationId) cancelProjection(binding);
    await attachment.watch.stop();
  };
  const cancel = async (
    conversationId: ConversationId,
    context: Context,
    taskId?: TaskId,
  ) => {
    const id = revokeKey(conversationId, taskId);
    revocations.set(id, (revocations.get(id) ?? 0) + 1);
    await options.harness().commit(async (tx) => {
      const doc = await tx.doc(NativeApprovals, conversationId);
      for (const item of Object.values(doc.requests))
        if (
          (taskId === undefined || item.taskId === taskId) &&
          (item.state === "pending" || item.state === "approved")
        )
          item.state = "cancelled";
    }, context);
  };
  return {
    /** Inject as NativeToolPolicy.authorize; called for EVERY final write/exec. */
    async authorize(
      owner: ToolOwner,
      operation: NativeOperation,
      context: Context,
    ) {
      const initial = attachments.get(owner.conversationId);
      if (!initial?.active || !options.broker.isAvailable(initial.address))
        throw new Error("Approval UI is absent");
      const revision = [
        revocations.get(revokeKey(owner.conversationId)),
        revocations.get(revokeKey(owner.conversationId, owner.taskId)),
      ];
      const expected = await request(
        owner,
        operation,
        "final-operation",
        context,
      );
      const attachment = attachments.get(owner.conversationId);
      if (
        !attachment?.active ||
        !options.broker.isAvailable(attachment.address)
      )
        throw new Error("Approval UI is absent");
      await check(owner, expected, context);
      return () => {
        if (
          context.abortSignal?.aborted ||
          now() >= expected.expiresAt ||
          attachments.get(owner.conversationId) !== attachment ||
          !attachment.active ||
          !options.broker.isAvailable(attachment.address) ||
          revision[0] !== revocations.get(revokeKey(owner.conversationId)) ||
          revision[1] !==
            revocations.get(revokeKey(owner.conversationId, owner.taskId))
        )
          throw new Error(
            "Approval was revoked, expired or UI detached before operation",
          );
      };
    },
    /** Mandatory native hook extension. Inject env.planTool and owner resolver;
     * no private HookApi casts, no pauseForApproval API. Select after other hooks. */
    extension: defineExtension({
      name: "pig.approvals",
      hooks: [
        hook(ToolTask, {
          async beforeTool(call, api, context) {
            try {
              const owner = await options.resolveOwner(call, api, context);
              const operation = await options.planTool(call, owner, context);
              if (operation)
                await request(owner, operation, "before-intent", context);
              const latest = await options.resolveOwner(call, api, context);
              if (operationHash(latest) !== operationHash(owner))
                throw new Error("Tool policy changed while awaiting approval");
              return undefined;
            } catch (error) {
              return {
                block:
                  error instanceof Error ? error.message : "Approval failed",
              };
            }
          },
          async afterTool(_call, result, api, context) {
            if (
              result.diagnostics?.some((diagnostic) =>
                [
                  "interrupted",
                  "abandoned",
                  "aborted",
                  "restart_limit",
                ].includes(diagnostic.code ?? ""),
              )
            )
              await cancel(api.conversationId, context, api.taskId);
            return undefined;
          },
        }),
      ],
    }),
    async attach(
      conversationId: ConversationId,
      address: SessionAddress,
      context: Context,
    ) {
      validateSession(address);
      await detach(conversationId);
      await options.harness().commit(async (tx) => {
        await tx.doc(NativeApprovals, conversationId);
      }, context);
      const watch = await options
        .harness()
        .watchDoc(NativeApprovals, conversationId, context);
      if (!watch) throw new Error("Approval projection unavailable");
      const attachment: Attachment = {
        conversationId,
        address: Object.freeze({ ...address }),
        watch,
        context,
        active: true,
      };
      attachments.set(conversationId, attachment);
      project(attachment, watch.value);
      watch.start(async (call) => {
        if (call.kind === "value" && !call.retired)
          project(attachment, call.value);
      });
      void watch.closed.then(() => {
        if (attachments.get(conversationId) === attachment)
          void detach(conversationId);
      });
      await expire(conversationId, context);
    },
    detach,
    /** Root must route replies owned by this module here, other replies to broker.
     * Broker validates kind/value/focus; decision then CASes immutable identity. */
    owns(reply: UIAddress) {
      return bindings.has(key(reply));
    },
    async resolve(reply: UIReply) {
      const id = key(reply);
      if (!bindings.has(id)) throw new Error("Stale or unknown approval UI ID");
      options.broker.resolve(reply);
      await decisionJobs.get(id);
    },
    /** Explicit Stop, before Harness/Conversation.abort. UI detach does NOT call this. */
    cancel,
    expire,
    async dispose() {
      for (const conversationId of [...attachments.keys()])
        await detach(conversationId);
    },
  };
}
