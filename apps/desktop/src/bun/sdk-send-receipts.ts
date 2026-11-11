import { createHash } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendIntent,
  SendKey,
  SessionAddress,
} from "../shared/runtime-contract";
import { validateDraftContent } from "./composer-bridge";
import type { SendRecoveryStore } from "./send-recovery-store";

export const addressKey = (a: SessionAddress) =>
  JSON.stringify([a.hostId, a.sessionId, a.epoch]);
const sendKey = (a: SendKey) =>
  `${addressKey(a)}:${JSON.stringify(a.requestId)}`;
type RecordState = {
  hash: string;
  receipt: PromptReceipt;
  promise: Promise<PromptAccepted>;
  resolve(value: PromptAccepted): void;
  reject(error: Error): void;
  cancel: AbortController;
  dispatched: boolean;
  scheduled: boolean;
  intent?: SendIntent;
};

/** Host-lifetime ledger; no eviction or retransmission on lookup. */
export class SendReceipts {
  private records = new Map<string, RecordState>();
  private queues = new Map<string, Promise<void>>();
  private followUps = new Map<string, Promise<void>>();
  private active = new Map<Promise<void>, string>();
  constructor(
    readonly hostId: string,
    private recovery?: SendRecoveryStore,
  ) {}
  queuedIntent(key: SendKey) {
    const intent = this.records.get(sendKey(key))?.intent;
    return intent?.content ? intent : this.recovery?.lookup(key, true);
  }
  intents() {
    const terminal = new Map<string, SendIntent>();
    const unresolved: SendIntent[] = [];
    for (const record of this.records.values()) {
      if (!record.intent) continue;
      if (
        record.receipt.state === "pending" ||
        record.receipt.state === "unknown" ||
        record.intent.content
      )
        unresolved.push(record.intent);
      else terminal.set(addressKey(record.receipt), record.intent);
    }
    return structuredClone([...terminal.values(), ...unresolved]);
  }
  has(key: SendKey) {
    return this.records.has(sendKey(key)) || !!this.recovery?.lookup(key);
  }
  private persist(record: RecordState) {
    if (record.intent) {
      record.intent = { ...record.intent, receipt: record.receipt };
      this.recovery?.intent(record.intent);
    }
  }
  lookup(key: SendKey): PromptReceipt {
    const live = this.records.get(sendKey(key))?.receipt;
    if (live) return structuredClone(live);
    const saved = this.recovery?.lookup(key)?.receipt;
    return structuredClone(
      (saved?.state === "pending" && key.hostId !== this.hostId
        ? { ...saved, state: "unknown", reason: "host-restarted" }
        : saved) ?? {
        ...key,
        state: "unknown",
        reason: key.hostId === this.hostId ? "not-found" : "host-restarted",
      },
    );
  }
  pending(address: SessionAddress) {
    return [...this.records.values()].some(
      (r) =>
        addressKey(r.receipt) === addressKey(address) &&
        r.receipt.state === "pending",
    );
  }
  cancel(address: SessionAddress) {
    for (const record of this.records.values()) {
      if (
        addressKey(record.receipt) !== addressKey(address) ||
        record.receipt.state !== "pending"
      )
        continue;
      record.cancel.abort(new Error("Prompt cancelled before acceptance"));
      this.reject(record, record.cancel.signal.reason, "CANCELLED");
    }
  }
  /** Withdrawal is safe until SDK input starts; after that the send belongs to Stop. */
  withdraw(key: SendKey) {
    const record = this.records.get(sendKey(key));
    if (!record || record.dispatched) return this.lookup(key);
    record.cancel.abort(new Error("Prompt cancelled before dispatch"));
    this.reject(record, record.cancel.signal.reason, "CANCELLED");
    return this.lookup(key);
  }
  private reject(
    record: RecordState,
    error: unknown,
    code = "PREFLIGHT_FAILED",
  ) {
    if (record.receipt.state !== "pending") return;
    const failure = error instanceof Error ? error : new Error(String(error));
    record.receipt = {
      ...record.receipt,
      state: "rejected",
      code,
      message: failure.message,
    };
    if (record.intent) record.intent = { ...record.intent, content: undefined };
    try {
      this.persist(record);
    } catch {
      /* The live rejection remains authoritative. */
    }
    record.reject(failure);
  }
  /** Reserves an immutable send during CAS, before the renderer can issue prompt. */
  register(
    params: PromptParams,
    metadata?: Pick<SendIntent, "content" | "owner">,
  ): RecordState {
    if (params.hostId !== this.hostId) throw new Error("STALE_SESSION_ADDRESS");
    if (
      typeof params.requestId !== "string" ||
      !params.requestId ||
      params.requestId.length > 256
    )
      throw new Error("Invalid request ID");
    if (
      typeof params.text !== "string" ||
      !Number.isSafeInteger(params.draftRevision) ||
      params.draftRevision < 0 ||
      (params.delivery !== undefined &&
        params.delivery !== "steer" &&
        params.delivery !== "followUp")
    )
      throw new Error("Invalid prompt payload");
    if (metadata?.content) validateDraftContent(metadata.content);
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          params.hostId,
          params.sessionId,
          params.epoch,
          params.draftRevision,
          params.text,
          params.delivery ?? "steer",
          (params.images ?? []).map((i) => [
            i.mimeType,
            createHash("sha256")
              .update(Buffer.from(i.data, "base64"))
              .digest("hex"),
          ]),
        ]),
      )
      .digest("hex");
    const key = sendKey(params);
    let previous = this.records.get(key);
    const saved = !previous && this.recovery?.lookup(params);
    if (saved) {
      const deferred = Promise.withResolvers<PromptAccepted>();
      void deferred.promise.catch(() => {});
      if (saved.receipt.state === "accepted")
        deferred.resolve(saved.receipt.accepted);
      else
        deferred.reject(
          new Error(
            saved.receipt.state === "rejected"
              ? saved.receipt.message
              : "Acceptance is unknown; inspect history before sending again",
          ),
        );
      previous = {
        hash: saved.hash,
        receipt: saved.receipt,
        intent: saved,
        ...deferred,
        cancel: new AbortController(),
        dispatched: true,
        scheduled: true,
      };
      this.records.set(key, previous);
    }
    if (previous) {
      if (previous.hash !== hash) throw new Error("REQUEST_ID_CONFLICT");
      return previous;
    }
    const deferred = Promise.withResolvers<PromptAccepted>();
    const record: RecordState = {
      hash,
      receipt: {
        hostId: params.hostId,
        sessionId: params.sessionId,
        epoch: params.epoch,
        requestId: params.requestId,
        state: "pending",
        stage: "prepared",
      },
      ...deferred,
      cancel: new AbortController(),
      dispatched: false,
      scheduled: false,
    };
    if (metadata) {
      record.intent = {
        ...structuredClone(metadata),
        hash,
        receipt: record.receipt,
        draftRevision: params.draftRevision,
        delivery: params.delivery ?? "steer",
        timestamp: Date.now(),
      };
      this.recovery?.intent(record.intent);
    }
    this.records.set(key, record);
    // Attach a handler immediately, including for cancellation before RPC awaits it.
    void record.promise.catch(() => {});
    return record;
  }
  /** Only the first dispatch executes SDK input. Restored unknown records are never dispatched. */
  send(
    params: PromptParams,
    session: Pick<AgentSession, "prompt"> &
      Partial<Pick<AgentSession, "waitForIdle" | "isStreaming">>,
    prepare: (
      signal: AbortSignal,
    ) => Promise<{ text: string; images?: PromptParams["images"] }>,
    onError: (error: unknown) => void,
    onAccepted?: (intent: SendIntent) => void,
  ): Promise<PromptAccepted> {
    let record: RecordState;
    try {
      record = this.register(params);
    } catch (error) {
      return Promise.reject(error);
    }
    if (record.scheduled || record.receipt.state !== "pending")
      return record.promise;
    record.scheduled = true;
    const queued = params.delivery === "followUp";
    record.receipt = {
      ...record.receipt,
      state: "pending",
      stage: queued ? "queued" : "dispatched",
    };
    try {
      this.persist(record);
    } catch (error) {
      this.reject(record, error);
      return record.promise;
    }
    const address = addressKey(params);
    const signal = record.cancel.signal;
    const wait = <T>(promise: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void promise
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
    const acquire = () => {
      const prior = this.queues.get(address) ?? Promise.resolve();
      const admission = Promise.withResolvers<void>();
      // Cancellation must not let later sends bypass this slot's predecessor.
      this.queues.set(
        address,
        prior.then(() => admission.promise),
      );
      return { prior, admission };
    };
    // Queued follow-ups wait outside the admission lane so they cannot block steering.
    let slot = queued ? undefined : acquire();
    const previousFollowUp = this.followUps.get(address) ?? Promise.resolve();
    const task = (async () => {
      try {
        if (queued) await wait(previousFollowUp);
        let input: Awaited<ReturnType<typeof prepare>> | undefined;
        for (;;) {
          signal.throwIfAborted();
          if (queued) {
            await wait(session.waitForIdle?.() ?? Promise.resolve());
            slot = acquire();
          }
          if (!slot) throw new Error("Missing prompt admission");
          await wait(slot.prior);
          signal.throwIfAborted();
          if (!queued || !session.isStreaming) {
            input = await prepare(signal);
            signal.throwIfAborted();
            if (!queued || !session.isStreaming) break;
          }
          slot.admission.resolve();
          slot = undefined;
        }
        record.dispatched = true;
        record.receipt = {
          ...record.receipt,
          state: "pending",
          stage: "dispatched",
        };
        this.persist(record);
        // This is the ONLY adapter to SDK 1.5.0's real typed acceptance hook.
        await session.prompt(input.text, {
          images: input.images,
          streamingBehavior: params.delivery ?? "steer",
          preflightResult: (disposition) => {
            // Never throw here: SDK 1.5.0 calls onStarted outside its finally.
            // SessionHost's public Agent.prompt boundary cancels a late start safely.
            if (record.receipt.state !== "pending") {
              slot?.admission.resolve();
              return;
            }
            const accepted = { disposition };
            record.receipt = {
              ...record.receipt,
              state: "accepted",
              accepted,
              acceptedAt: Date.now(),
            };
            if (record.intent && disposition !== "queued")
              record.intent = { ...record.intent, content: undefined };
            try {
              if (record.intent && onAccepted) {
                record.intent = { ...record.intent, receipt: record.receipt };
                onAccepted(record.intent);
              } else this.persist(record);
            } catch (error) {
              onError(error);
            }
            record.resolve(accepted);
            slot?.admission.resolve();
          },
        });
        // A prompt issued inside an SDK settled hook can resolve before its
        // deferred dispatch. Completion without a hook is indeterminate, not rejection.
        if (record.receipt.state === "pending")
          await record.promise.catch(() => {});
      } catch (error) {
        if (record.receipt.state === "accepted") onError(error);
        else this.reject(record, error);
      } finally {
        slot?.admission.resolve();
      }
    })();
    if (queued) this.followUps.set(address, task);
    this.active.set(task, address);
    void task.finally(() => this.active.delete(task));
    return record.promise;
  }
  /** Resolves when every prompt already dispatched for this owner is accepted or rejected. */
  admitted(address: SessionAddress) {
    return this.queues.get(addressKey(address)) ?? Promise.resolve();
  }
  async settled(address?: SessionAddress) {
    await Promise.all(
      [...this.active]
        .filter(([, key]) => !address || key === addressKey(address))
        .map(([task]) => task),
    );
  }
  releasePayload(key: SendKey) {
    const record = this.records.get(sendKey(key));
    if (!record?.intent) return;
    record.intent = { ...record.intent, content: undefined };
    this.persist(record);
  }
  forget(address: SessionAddress) {
    for (const record of this.records.values())
      if (addressKey(record.receipt) === addressKey(address))
        record.intent = undefined;
  }
}
