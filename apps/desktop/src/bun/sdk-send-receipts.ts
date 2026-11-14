import { createHash } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  PromptAccepted,
  PromptDelivery,
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
type Deferred<T> = ReturnType<typeof Promise.withResolvers<T>>;
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
  /** Starts as requested; a waiting follow-up may be promoted to steering. */
  delivery: PromptDelivery;
  promoted: Deferred<void>;
  /** Preparing SDK input; from here on the follow-up keeps its place. */
  starting: boolean;
};
/** Waiting follow-ups in send order; the holder runs until its response completes. */
type Lane = {
  order: RecordState[];
  holder?: RecordState;
  changed: Deferred<void>;
};

/** Host-lifetime ledger; no eviction or retransmission on lookup. */
export class SendReceipts {
  private records = new Map<string, RecordState>();
  private queues = new Map<string, Promise<void>>();
  private lanes = new Map<string, Lane>();
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
    // A reload restores the queue in its current (possibly reordered) order.
    const position = new Map<string, number>();
    for (const lane of this.lanes.values())
      lane.order.forEach((record, index) => {
        position.set(sendKey(record.receipt), index);
      });
    const at = (intent: SendIntent) =>
      position.get(sendKey(intent.receipt)) ?? -1;
    unresolved.sort((a, b) => at(a) - at(b));
    return structuredClone([...terminal.values(), ...unresolved]);
  }
  private lane(address: string) {
    let lane = this.lanes.get(address);
    if (!lane) {
      lane = { order: [], changed: Promise.withResolvers<void>() };
      this.lanes.set(address, lane);
    }
    return lane;
  }
  private changed(lane: Lane) {
    lane.changed.resolve();
    lane.changed = Promise.withResolvers<void>();
  }
  private leave(address: string, record: RecordState) {
    const lane = this.lanes.get(address);
    if (!lane) return;
    lane.order = lane.order.filter((item) => item !== record);
    if (lane.holder === record) lane.holder = undefined;
    if (!lane.order.length) this.lanes.delete(address);
    this.changed(lane);
  }
  /** Resolves when this follow-up heads the lane, or once it is promoted to steering. */
  private async turn(
    address: string,
    record: RecordState,
    wait: <T>(promise: Promise<T>) => Promise<T>,
  ) {
    for (;;) {
      const lane = this.lanes.get(address);
      if (record.delivery !== "followUp" || !lane || lane.holder === record)
        return;
      if (!lane.holder && lane.order[0] === record) {
        lane.holder = record;
        return;
      }
      await wait(Promise.race([lane.changed.promise, record.promoted.promise]));
    }
  }
  private holds(address: string, record: RecordState) {
    return this.lanes.get(address)?.holder === record;
  }
  /**
   * Reorders follow-ups that have not started preparing. The one already
   * starting stays first; IDs missing from the request keep their relative
   * order at the end. A head that is only waiting for idle can be passed.
   */
  reorderQueued(address: SessionAddress, requestIds: string[]) {
    const lane = this.lanes.get(addressKey(address));
    if (!lane) return [];
    const rank = new Map(requestIds.map((id, index) => [id, index]));
    const fixed = lane.order.filter(
      (record) => record.dispatched || record.starting,
    );
    const movable = lane.order
      .filter((record) => !fixed.includes(record))
      .sort(
        (a, b) =>
          (rank.get(a.receipt.requestId) ?? requestIds.length) -
          (rank.get(b.receipt.requestId) ?? requestIds.length),
      );
    lane.order = [...fixed, ...movable];
    if (lane.holder && lane.order[0] !== lane.holder) lane.holder = undefined;
    this.changed(lane);
    return lane.order.map((record) => record.receipt.requestId);
  }
  /** Sends a waiting follow-up now, as steering. False once SDK input has started. */
  steerQueued(key: SendKey) {
    const record = this.records.get(sendKey(key));
    if (
      !record ||
      record.dispatched ||
      record.delivery !== "followUp" ||
      record.receipt.state !== "pending"
    )
      return false;
    record.delivery = "steer";
    if (record.intent) {
      record.intent = { ...record.intent, delivery: "steer" };
      this.persist(record);
    }
    this.leave(addressKey(key), record);
    record.promoted.resolve();
    return true;
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
        delivery: saved.delivery ?? "steer",
        promoted: Promise.withResolvers<void>(),
        starting: false,
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
      delivery: params.delivery ?? "steer",
      promoted: Promise.withResolvers<void>(),
      starting: false,
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
    // A follow-up promoted before its prompt arrived is sent as steering.
    const queued = record.delivery === "followUp";
    const later = () => record.delivery === "followUp";
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
    if (queued) this.lane(address).order.push(record);
    const task = (async () => {
      try {
        let input: Awaited<ReturnType<typeof prepare>> | undefined;
        for (;;) {
          signal.throwIfAborted();
          if (later()) {
            await this.turn(address, record, wait);
            const lane = this.lanes.get(address);
            await wait(
              Promise.race([
                session.waitForIdle?.() ?? Promise.resolve(),
                record.promoted.promise,
                ...(lane ? [lane.changed.promise] : []),
              ]),
            );
            // Reordered behind another follow-up while waiting: wait for the turn again.
            if (later() && !this.holds(address, record)) continue;
            slot = acquire();
          } else slot ??= acquire();
          await wait(slot.prior);
          signal.throwIfAborted();
          const displaced = later() && !this.holds(address, record);
          if (!displaced && (!later() || !session.isStreaming)) {
            record.starting = later();
            input = await prepare(signal);
            signal.throwIfAborted();
            if (!later() || !session.isStreaming) break;
            record.starting = false;
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
          streamingBehavior: record.delivery,
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
        this.leave(address, record);
      }
    })();
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
