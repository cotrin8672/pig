import type { Snapshot } from "../shared/rpc-schema";
import type {
  DraftContent,
  DraftSyncParams,
  DraftSyncResult,
  PromptAccepted,
  PromptDelivery,
  PromptParams,
  PromptReceipt,
  SendIntent,
  SendKey,
  SessionAddress,
} from "../shared/runtime-contract";
import { addressKey, sameAddress } from "./chat-snapshot";
import { type DraftStore, expandedDraft } from "./draft-store";

export type SendState = {
  key: SendKey;
  version: number;
  state: "sending" | "checking" | "unknown" | "rejected" | "accepted";
  message?: string;
  content?: SendIntent["content"];
  owner?: SendIntent["owner"];
  disposition?: PromptAccepted["disposition"];
  recoveryReason?: "prepared" | "lookup-timeout";
  recoveredQueue?: boolean;
  optimistic?: boolean;
  timestamp?: number;
  delivery?: PromptDelivery;
  stage?: Extract<PromptReceipt, { state: "pending" }>["stage"];
};
export function isSendUnconfirmed(state: SendState | undefined) {
  return !!state && ["sending", "checking", "unknown"].includes(state.state);
}
type Transport = {
  syncDraft(params: DraftSyncParams): Promise<DraftSyncResult>;
  prompt(params: PromptParams): Promise<PromptAccepted>;
  getPromptReceipt(params: SendKey): Promise<PromptReceipt>;
  /** Rejects a reserved send that was never dispatched. */
  cancelPrompt?(params: SendKey): Promise<unknown>;
};
export type PendingAttachments = Promise<
  Pick<DraftContent, "images" | "files">
>;
/** Issues a step in per-session click order; resolves once its RPC is sent. */
export type Sequence = (
  address: SessionAddress,
  step: () => unknown,
) => unknown;
const cancelledError = "Send cancelled";
/** A transport failure is not a rejection. Only read-only lookup is ever retried. */
export class SendController {
  private states = new Map<string, SendState>();
  private transfers = new Map<
    string,
    { address: SessionAddress; state: SendState }
  >();
  private listeners = new Set<() => void>();
  private operations = new Map<string, SendState>();
  private scheduled = new Set<string>();
  private lookups = new Map<string, Promise<void>>();
  private failures = new Map<string, number>();
  private dispatched = new Set<string>();
  private cancelled = new Set<string>();
  private withdrawn = new Set<string>();
  private barriers = new Map<string, Promise<unknown>>();
  private tick = 0;
  getTick = () => this.tick;
  constructor(
    private drafts: DraftStore,
    private transport: Transport,
    private schedule: (lookup: () => void, delayMs: number) => void = (
      lookup,
      delayMs,
    ) => {
      setTimeout(lookup, delayMs);
    },
    private lookupBudgetMs = 5_000,
    private rejected: (message: string) => void = () => {},
    private sequence: Sequence = (_, step) => step(),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  read(address: SessionAddress) {
    return this.states.get(addressKey(address));
  }
  reconcile(snapshot: Snapshot) {
    const visible = new Set(
      snapshot.transcript.records.map((record) => record.requestId),
    );
    for (const state of this.operations.values()) {
      if (
        sameAddress(state.key, snapshot.address) &&
        state.state === "accepted" &&
        state.content &&
        visible.has(state.key.requestId)
      )
        this.put(
          snapshot.address,
          { ...state, content: undefined, optimistic: false },
          this.read(snapshot.address)?.key.requestId === state.key.requestId,
        );
    }
  }
  optimistic(address: SessionAddress) {
    return [...this.operations.values()].filter(
      (state) =>
        sameAddress(state.key, address) &&
        state.optimistic &&
        (state.delivery !== "followUp" || state.disposition !== undefined) &&
        state.content &&
        state.state !== "rejected" &&
        state.disposition !== "handled",
    );
  }
  queued(address: SessionAddress) {
    return [...this.operations.values()].filter(
      (state) =>
        sameAddress(state.key, address) &&
        state.delivery === "followUp" &&
        state.content &&
        isSendUnconfirmed(state) &&
        state.state !== "unknown",
    );
  }
  /** Editing withdraws to the composer; newer draft text is preserved. */
  async withdrawQueued(address: SessionAddress, key: SendKey, edit = false) {
    const id = this.operationKey(key);
    const state = this.queued(address).find(
      (item) => this.operationKey(item.key) === id,
    );
    if (!state?.content) return false;
    this.withdrawn.add(id);
    try {
      if (this.dispatched.has(id) || state.stage) {
        const receipt = (await this.transport.cancelPrompt?.(key)) as
          | PromptReceipt
          | undefined;
        if (receipt?.state !== "rejected" || receipt.code !== "CANCELLED") {
          this.withdrawn.delete(id);
          // A rejection racing this withdrawal was suppressed, so restore it here.
          if (this.operations.get(id)?.state === "rejected")
            this.drafts.restoreSent(address, state.content);
          await this.lookup(address, key);
          if (receipt?.state === "rejected") throw new Error(receipt.message);
          return false;
        }
      }
      this.cancelled.add(id);
      this.settle(address, state, { state: "rejected", cancelled: true });
      if (edit) this.drafts.restoreSent(address, state.content);
      return true;
    } catch (error) {
      if (
        this.withdrawn.delete(id) &&
        this.operations.get(id)?.state === "rejected"
      )
        this.drafts.restoreSent(address, state.content);
      throw error;
    }
  }
  async wait(address: SessionAddress) {
    const pending = () =>
      [...this.operations.values()].filter(
        (state) =>
          (sameAddress(state.key, address) ||
            sameAddress(
              this.transfers.get(this.operationKey(state.key))?.address ??
                state.key,
              address,
            )) &&
          isSendUnconfirmed(state),
      );
    await Promise.all(
      pending().map((state) => this.lookup(address, state.key)),
    );
    if (pending().some((state) => state.state === "unknown"))
      throw new Error(
        "Send status is unknown. Check its receipt before changing this conversation.",
      );
    if (!pending().length) return;
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        const waiting = pending();
        if (waiting.some((state) => state.state === "unknown")) {
          unsubscribe();
          reject(
            new Error(
              "Send status is unknown; the conversation was not changed.",
            ),
          );
        } else if (!waiting.length) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  retained() {
    return [...this.operations.values()].filter(
      (state) =>
        state.state === "unknown" ||
        (state.state === "checking" &&
          !(state.delivery === "followUp" && state.stage === "queued")) ||
        state.recoveredQueue,
    );
  }
  private operationKey(key: SendKey) {
    return `${addressKey(key)}:${key.requestId}`;
  }
  discard(address: SessionAddress) {
    this.states.delete(addressKey(address));
    for (const [key, state] of this.operations)
      if (
        sameAddress(state.key, address) ||
        sameAddress(this.transfers.get(key)?.address ?? state.key, address)
      ) {
        this.operations.delete(key);
        this.transfers.delete(key);
      }
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  private put(address: SessionAddress, state: SendState, current = true) {
    this.operations.set(this.operationKey(state.key), state);
    if (current) this.states.set(addressKey(address), state);
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  private poll(address: SessionAddress, state: SendState) {
    const key = this.operationKey(state.key);
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const delay = Math.min(
      15_000,
      1500 * 2 ** Math.min(this.failures.get(key) ?? 0, 4),
    );
    this.schedule(() => {
      this.scheduled.delete(key);
      void this.lookup(address, state.key);
    }, delay);
  }
  restore(intents: SendIntent[]) {
    for (const intent of intents) {
      const receipt = intent.receipt;
      // A restored reservation may already be running on the host, even after a renderer reload.
      if (receipt.state === "pending" && receipt.stage !== "prepared")
        this.dispatched.add(this.operationKey(receipt));
      const existing = this.operations.get(this.operationKey(receipt));
      const draft = this.drafts.read(receipt);
      const recoveredQueue = !!(
        draft.retired &&
        receipt.state === "accepted" &&
        receipt.accepted.disposition === "queued" &&
        intent.content
      );
      if (existing?.state === "accepted") {
        if (recoveredQueue)
          this.put(
            receipt,
            {
              ...existing,
              content: intent.content,
              owner: intent.owner,
              recoveredQueue: true,
            },
            this.read(receipt)?.key.requestId === receipt.requestId,
          );
        continue;
      }
      if (existing?.state === "rejected") continue;
      const state: SendState = {
        key: receipt,
        version:
          !draft.dirty && draft.revision === intent.draftRevision
            ? draft.version
            : -1,
        state: receipt.state === "pending" ? "checking" : receipt.state,
        content: intent.content,
        owner: intent.owner,
        recoveredQueue,
        delivery: intent.delivery,
        stage: receipt.state === "pending" ? receipt.stage : undefined,
        timestamp: intent.timestamp,
        optimistic: !!intent.delivery && !draft.retired,
        ...(receipt.state === "rejected" ? { message: receipt.message } : {}),
        ...(receipt.state === "accepted"
          ? { disposition: receipt.accepted.disposition }
          : {}),
      };
      this.put(
        receipt,
        state,
        !this.read(receipt) ||
          this.read(receipt)?.key.requestId === receipt.requestId,
      );
      if (state.state === "checking") this.poll(receipt, state);
    }
  }
  /**
   * Stop cancels every send not yet dispatched, then holds later sends until
   * the host finishes stopping. Accepted sends are handled by the host.
   */
  stop(address: SessionAddress, abort: () => Promise<void>) {
    for (const [id, state] of this.operations)
      if (
        sameAddress(state.key, address) &&
        state.state === "sending" &&
        !this.dispatched.has(id)
      )
        this.cancelled.add(id);
    const key = addressKey(address);
    const stopping = abort();
    const barrier = stopping.catch(() => {});
    this.barriers.set(key, barrier);
    void barrier.then(() => {
      if (this.barriers.get(key) === barrier) this.barriers.delete(key);
    });
    return stopping;
  }
  async send(
    address: SessionAddress,
    content?: DraftContent,
    attachments?: PendingAttachments,
    delivery: PromptDelivery = "steer",
  ) {
    const editor = this.drafts.read(address);
    const captured = content ? { ...editor, content } : editor;
    if (
      !attachments &&
      !expandedDraft(captured.content) &&
      !captured.content.images.length
    )
      return;
    // Capture and clear synchronously; a second click cannot send the same draft.
    if (captured.retired || captured.conflict) {
      if (content)
        throw new Error(
          "The editor changed before sending; your message has been restored.",
        );
      return;
    }
    if (!content) this.drafts.clearForSend(address, captured.version);
    const state: SendState = {
      key: { ...address, requestId: crypto.randomUUID() },
      version: captured.version,
      content: structuredClone(captured.content),
      state: "sending",
      optimistic: true,
      timestamp: Date.now(),
      delivery,
    };
    this.put(address, state);
    const id = this.operationKey(state.key);
    // Enqueue synchronously so a later click cannot overtake this send.
    // Boxed: resolving with a Promise would wait for the prompt response.
    const issued = Promise.withResolvers<{
      response: Promise<PromptAccepted>;
    }>();
    this.sequence(address, () =>
      this.issue(address, state, captured, attachments).then(
        issued.resolve,
        issued.reject,
      ),
    );
    let response: Promise<PromptAccepted> | undefined;
    try {
      ({ response } = await issued.promise);
    } catch (error) {
      if (this.cancelled.has(id) || String(error).includes(cancelledError)) {
        // A lost CAS ACK may still have reserved the ID; it was never dispatched.
        if (this.reserved.has(id) && !String(error).includes(cancelledError))
          await this.transport.cancelPrompt?.(state.key)?.catch(() => {});
        this.settle(address, state, { state: "rejected", cancelled: true });
        return;
      }
      if (this.drafts.read(address).conflict || !this.reserved.has(id)) {
        this.settle(address, state, {
          state: "rejected",
          message: String(error),
        });
        return;
      }
      // A lost CAS ACK may already have reserved this ID on the host.
      this.put(
        address,
        {
          ...state,
          state: "checking",
          message: String(error),
        },
        this.read(address)?.key.requestId === state.key.requestId,
      );
      await this.lookup(address, state.key);
      return;
    } finally {
      this.reserved.delete(id);
    }
    if (!response) return;
    this.poll(address, state);
    try {
      const result = await response;
      this.settle(address, state, {
        state: "accepted",
        disposition: result.disposition,
      });
    } catch {
      if (!isSendUnconfirmed(this.operations.get(id))) return;
      this.put(
        address,
        {
          ...state,
          state: "checking",
        },
        this.read(address)?.key.requestId === state.key.requestId,
      );
      await this.lookup(address, state.key);
    }
  }
  private reserved = new Set<string>();
  /** Resolves with the prompt response once the RPC has been sent. */
  private async issue(
    address: SessionAddress,
    state: SendState,
    captured: ReturnType<DraftStore["read"]>,
    attachments?: PendingAttachments,
  ): Promise<{ response: Promise<PromptAccepted> }> {
    const id = this.operationKey(state.key);
    const check = () => {
      if (this.cancelled.has(id) || this.withdrawn.has(id))
        throw new Error(cancelledError);
    };
    await this.barriers.get(addressKey(address));
    check();
    if (attachments) {
      const loaded = await attachments;
      check();
      const content = {
        ...captured.content,
        images: [...captured.content.images, ...loaded.images],
        files: [...(captured.content.files ?? []), ...(loaded.files ?? [])],
      };
      captured = { ...captured, content };
      state.content = structuredClone(content);
      this.put(
        address,
        { ...state },
        this.read(address)?.key.requestId === state.key.requestId,
      );
      if (!expandedDraft(content) && !content.images.length)
        throw new Error("Message is empty");
    }
    this.reserved.add(id);
    let payload: PromptParams;
    {
      const draft = await this.drafts.flush(
        address,
        this.transport.syncDraft,
        captured,
        state.key.requestId,
        state.delivery,
      );
      const text = expandedDraft(draft.content);
      const images = draft.content.images.map((item) => item.image);
      if (!text && !images.length) throw new Error("Message is empty");
      state.version = draft.version;
      payload = {
        ...state.key,
        text,
        images: images.length ? images : undefined,
        draftRevision: draft.revision,
        delivery: state.delivery,
      };
    }
    await this.barriers.get(addressKey(address));
    if (this.cancelled.has(id) || this.withdrawn.has(id)) {
      // The host reserved this ID during CAS; never let it look pending.
      await this.transport.cancelPrompt?.(state.key);
      throw new Error(cancelledError);
    }
    this.dispatched.add(id);
    const response = this.transport.prompt(payload);
    void response.catch(() => {});
    return { response };
  }
  private settle(
    address: SessionAddress,
    state: SendState,
    result: {
      state: "accepted" | "rejected";
      message?: string;
      disposition?: PromptAccepted["disposition"];
      cancelled?: true;
    },
    forwarded = false,
  ) {
    this.cancelled.delete(this.operationKey(state.key));
    const id = this.operationKey(state.key);
    const previous = this.operations.get(id);
    if (
      !forwarded &&
      previous &&
      ["accepted", "rejected"].includes(previous.state)
    )
      return;
    if (previous?.state === "accepted" && result.state !== "accepted") return;
    const current = this.read(address)?.key.requestId === state.key.requestId;
    if (
      result.state === "rejected" &&
      !forwarded &&
      !result.cancelled &&
      !this.withdrawn.has(id)
    )
      this.rejected(result.message ?? "Send failed");
    const cleared =
      current &&
      result.state === "accepted" &&
      !state.optimistic &&
      this.drafts.clearAccepted(address, state.version);
    if (
      state.optimistic &&
      result.state === "rejected" &&
      state.content &&
      !this.withdrawn.has(id)
    )
      this.drafts.restoreSent(address, state.content);
    this.put(
      address,
      {
        ...state,
        content:
          state.recoveredQueue ||
          (state.optimistic && result.state === "accepted")
            ? state.content
            : undefined,
        message: undefined,
        state: result.state,
        ...(result.message ? { message: result.message } : {}),
        ...(result.disposition ? { disposition: result.disposition } : {}),
      },
      current,
    );
    // Mirror the accepted clear, without risking a newer extension revision.
    if (cleared)
      void this.drafts.flush(address, this.transport.syncDraft).catch(() => {});
    const next = this.transfers.get(id);
    this.transfers.delete(id);
    if (next && !sameAddress(next.address, address))
      this.settle(next.address, next.state, result, true);
  }
  lookup(
    address: SessionAddress,
    key = this.read(address)?.key,
  ): Promise<void> {
    if (!key) return Promise.resolve();
    const id = this.operationKey(key);
    const state = this.operations.get(id);
    if (!isSendUnconfirmed(state) || !state) return Promise.resolve();
    const flight = this.lookups.get(id);
    if (flight) return flight;
    let timer: ReturnType<typeof setTimeout>;
    const update = (next: SendState) => {
      if (isSendUnconfirmed(this.operations.get(id)))
        this.put(
          address,
          next,
          this.read(address)?.key.requestId === state.key.requestId,
        );
    };
    const request = Promise.resolve()
      .then(() => this.transport.getPromptReceipt(state.key))
      .then((receipt) => {
        if (
          !sameAddress(receipt, state.key) ||
          receipt.requestId !== state.key.requestId
        )
          throw new Error("Receipt address mismatch");
        if (!isSendUnconfirmed(this.operations.get(id))) return;
        this.failures.delete(id);
        if (receipt.state === "accepted") {
          this.settle(address, state, {
            state: "accepted",
            disposition: receipt.accepted.disposition,
          });
          return;
        }
        if (receipt.state === "rejected") {
          this.settle(address, state, {
            state: "rejected",
            message: receipt.message,
          });
          return;
        }
        if (receipt.state === "unknown") {
          update({
            ...state,
            state: "unknown",
            message: undefined,
          });
          return;
        }
        if (receipt.stage === "prepared" && !this.dispatched.has(id)) {
          update({
            ...state,
            state: "unknown",
            message: undefined,
            recoveryReason: "prepared",
          });
          return;
        }
        update({
          ...state,
          state: "checking",
          stage: receipt.stage,
        });
      })
      .catch(() => {
        this.failures.set(id, (this.failures.get(id) ?? 0) + 1);
        update({
          ...state,
          state: "checking",
        });
      })
      .finally(() => {
        clearTimeout(timer);
        this.lookups.delete(id);
        if (
          ["sending", "checking"].includes(this.operations.get(id)?.state ?? "")
        )
          this.poll(address, state);
      });
    const bounded = Promise.race([
      request,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          update({
            ...state,
            state: "unknown",
            message: undefined,
            recoveryReason: "lookup-timeout",
          });
          resolve();
        }, this.lookupBudgetMs);
      }),
    ]);
    // Keep the underlying flight registered after a timeout; never pile up hung RPCs.
    this.lookups.set(id, bounded);
    return bounded;
  }
  transfer(previous: SessionAddress, next: SessionAddress) {
    if (sameAddress(previous, next)) return;
    const active = this.read(previous)?.key.requestId;
    const old = this.drafts.read(previous);
    const current = this.drafts.read(next);
    for (const [id, state] of this.operations) {
      const transfer = this.transfers.get(id);
      if (
        !isSendUnconfirmed(state) ||
        !sameAddress(transfer?.address ?? state.key, previous)
      )
        continue;
      const source = transfer?.state ?? state;
      const moved: SendState = {
        ...source,
        version:
          old.version === source.version && current.content === old.content
            ? current.version
            : -1,
        state: "unknown",
        message: undefined,
      };
      this.transfers.set(id, { address: next, state: moved });
      this.put(next, moved, active === state.key.requestId);
    }
  }
}
