import { createHash } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendKey,
  SessionAddress,
} from "../shared/runtime-contract";

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
};

/** Host-lifetime ledger; no eviction or retransmission on lookup. */
export class SendReceipts {
  private records = new Map<string, RecordState>();
  private queues = new Map<string, Promise<void>>();
  private active = new Map<Promise<void>, string>();
  constructor(readonly hostId: string) {}
  lookup(key: SendKey): PromptReceipt {
    return structuredClone(
      this.records.get(sendKey(key))?.receipt ?? {
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
    record.reject(failure);
  }
  /** Registers pending synchronously BEFORE validation, normalization, auth, or SDK input. */
  send(
    params: PromptParams,
    session: Pick<AgentSession, "prompt">,
    prepare: (
      signal: AbortSignal,
    ) => Promise<{ text: string; images?: PromptParams["images"] }>,
    onError: (error: unknown) => void,
  ): Promise<PromptAccepted> {
    if (
      typeof params.requestId !== "string" ||
      !params.requestId ||
      params.requestId.length > 256
    )
      return Promise.reject(new Error("Invalid request ID"));
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          params.hostId,
          params.sessionId,
          params.epoch,
          params.draftRevision,
          params.text,
          (params.images ?? []).map((i) => [
            i.mimeType,
            createHash("sha256")
              .update(Buffer.from(i.data, "base64"))
              .digest("hex"),
          ]),
        ]),
      )
      .digest("hex");
    const key = sendKey(params),
      previous = this.records.get(key);
    if (previous)
      return previous.hash === hash
        ? previous.promise
        : Promise.reject(new Error("REQUEST_ID_CONFLICT"));
    const deferred = Promise.withResolvers<PromptAccepted>();
    const record: RecordState = {
      hash,
      receipt: {
        hostId: params.hostId,
        sessionId: params.sessionId,
        epoch: params.epoch,
        requestId: params.requestId,
        state: "pending",
      },
      ...deferred,
      cancel: new AbortController(),
    };
    this.records.set(key, record);
    // Attach a handler immediately, including for cancellation before RPC awaits it.
    void record.promise.catch(() => {});
    const address = addressKey(params);
    const prior = this.queues.get(address) ?? Promise.resolve();
    const admission = Promise.withResolvers<void>();
    this.queues.set(address, admission.promise);
    const task = prior.then(async () => {
      try {
        record.cancel.signal.throwIfAborted();
        const input = await prepare(record.cancel.signal);
        record.cancel.signal.throwIfAborted();
        // This is the ONLY adapter to SDK 1.5.0's real typed acceptance hook.
        await session.prompt(input.text, {
          images: input.images,
          streamingBehavior: "followUp",
          preflightResult: (disposition) => {
            // Never throw here: SDK 1.5.0 calls onStarted outside its finally.
            // SessionHost's public Agent.prompt boundary cancels a late start safely.
            if (record.receipt.state !== "pending") {
              admission.resolve();
              return;
            }
            const accepted = { disposition };
            record.receipt = {
              ...record.receipt,
              state: "accepted",
              accepted,
              acceptedAt: Date.now(),
            };
            record.resolve(accepted);
            admission.resolve();
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
        admission.resolve();
      }
    });
    this.active.set(task, address);
    void task.finally(() => this.active.delete(task));
    return record.promise;
  }
  async settled(address?: SessionAddress) {
    await Promise.all(
      [...this.active]
        .filter(([, key]) => !address || key === addressKey(address))
        .map(([task]) => task),
    );
  }
}
