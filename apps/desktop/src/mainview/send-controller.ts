import type { Snapshot } from "../shared/rpc-schema";
import type {
  DraftContent,
  DraftSyncParams,
  DraftSyncResult,
  PromptAccepted,
  PromptDelivery,
  PromptParams,
  PromptReceipt,
  PromptRecoveryAck,
  SendIntent,
  SendKey,
  SessionAddress,
} from "../shared/runtime-contract";
import { RESUME_REQUEST_PREFIX } from "../shared/runtime-contract";
import { addressKey, sameAddress } from "./chat-snapshot";
import { type DraftStore, expandedDraft } from "./draft-store";
import {
  cancelledRequestIds,
  transcriptRequestIds,
} from "./transcript-requests";

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
  detached?: true;
  optimistic?: boolean;
  timestamp?: number;
  delivery?: PromptDelivery;
  stage?: Extract<PromptReceipt, { state: "pending" }>["stage"];
  /** Payload has already been returned to the composer, not rejected by the host. */
  returned?: boolean;
};
/** Steering the SDK holds until the next step boundary: shown in the queue tray. */
export function isPendingSteer(state: SendState, running: boolean) {
  return (
    state.delivery === "steer" &&
    (state.disposition === "queued" ||
      (state.disposition === undefined && running))
  );
}
export function isSendUnconfirmed(state: SendState | undefined) {
  return !!state && ["sending", "checking", "unknown"].includes(state.state);
}
type Transport = {
  /** Runs before draft CAS/reservation; it never dispatches a prompt itself. */
  prepareSession?(address: SessionAddress): Promise<void> | void;
  syncDraft(params: DraftSyncParams): Promise<DraftSyncResult>;
  prompt(params: PromptParams): Promise<PromptAccepted>;
  getPromptReceipt(params: SendKey): Promise<PromptReceipt>;
  /** Rejects a reserved send that was never dispatched. */
  cancelPrompt?(params: SendKey): Promise<unknown>;
  /** Reorders waiting follow-ups; resolves with the host's resulting order. */
  reorderPrompts?(
    params: SessionAddress & { requestIds: string[] },
  ): Promise<string[]>;
  /** Sends a waiting follow-up now as steering; false once it has started. */
  steerPrompt?(params: SendKey): Promise<boolean>;
  acknowledgeRecovery?(params: PromptRecoveryAck): Promise<void>;
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
/** Retries reuse the immutable request ID; the host ledger deduplicates dispatch. */
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
  private retries = new Map<
    string,
    { payload: PromptParams; attempts: number }
  >();
  /** Follow-ups the host promoted to steering; later updates keep that delivery. */
  private promoted = new Set<string>();
  /** Queue position after a reorder; unranked items follow in send order. */
  private ranks = new Map<string, number>();
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
    private notice: (kind: "restored" | "unknown") => void = () => {},
    private ownsDraft: (address: SessionAddress) => boolean = () => true,
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
  protectedAddresses(): SessionAddress[] {
    return [...this.operations].flatMap(([id, state]) => {
      const owner = this.transfers.get(id)?.address ?? state.key;
      return isSendUnconfirmed(state) && this.activeDraft(owner) ? [owner] : [];
    });
  }
  private activeDraft(address: SessionAddress) {
    return this.ownsDraft(address) && !this.drafts.read(address).retired;
  }
  reconcile(snapshot: Snapshot) {
    if (!this.operations.size || !this.activeDraft(snapshot.address)) return;
    const recovered: SendState[] = [];
    for (const state of this.operations.values()) {
      if (
        sameAddress(
          this.transfers.get(this.operationKey(state.key))?.address ??
            state.key,
          snapshot.address,
        ) &&
        (state.state === "accepted" || isSendUnconfirmed(state)) &&
        !state.detached &&
        (state.content || (state.returned && isSendUnconfirmed(state)))
      ) {
        const records = snapshot.transcript.records;
        if (cancelledRequestIds(records).has(state.key.requestId)) {
          if (!state.returned) recovered.push(state);
          this.put(
            snapshot.address,
            {
              ...state,
              state: "accepted",
              content: undefined,
              optimistic: false,
              recoveredQueue: false,
            },
            this.read(snapshot.address)?.key.requestId === state.key.requestId,
          );
          continue;
        }
        if (!transcriptRequestIds(records).has(state.key.requestId)) continue;
        // Matching history is authoritative even if the acceptance RPC was lost.
        if (isSendUnconfirmed(state))
          this.settle(state.key, state, { state: "accepted" });
        const confirmed =
          this.operations.get(this.operationKey(state.key)) ?? state;
        this.put(
          snapshot.address,
          { ...confirmed, content: undefined, optimistic: false },
          this.read(snapshot.address)?.key.requestId === state.key.requestId,
        );
      }
    }
    // restoreSent prepends; reverse so multiple recovered sends keep click order.
    for (const state of recovered.reverse())
      if (
        state.content &&
        !state.key.requestId.startsWith(RESUME_REQUEST_PREFIX)
      )
        this.drafts.restoreSent(snapshot.address, state.content);
    if (recovered.length) {
      this.notice("restored");
      void this.saveRecovery(
        snapshot.address,
        recovered.map((state) => state.key),
      );
    }
  }
  private async saveRecovery(
    address: SessionAddress,
    keys: SendKey[],
    unconfirmed?: true,
  ) {
    if (!this.activeDraft(address)) return;
    try {
      await this.drafts.flush(address, this.transport.syncDraft);
      // Acknowledge only after saving, and never against a replaced owner.
      for (const key of keys) {
        if (!this.activeDraft(address)) return;
        await this.transport.acknowledgeRecovery?.({
          ...address,
          key,
          unconfirmed,
        });
      }
    } catch (error) {
      if (this.activeDraft(address)) this.rejected(String(error));
    }
  }
  /** Pending steering stays in the tray; returned input lives in the composer. */
  pendingSteering(address: SessionAddress, running: boolean) {
    return [...this.operations.values()].filter(
      (state) =>
        sameAddress(
          this.transfers.get(this.operationKey(state.key))?.address ??
            state.key,
          address,
        ) &&
        !state.detached &&
        state.content &&
        (state.state === "unknown" ||
          (state.optimistic &&
            state.state !== "rejected" &&
            isPendingSteer(state, running))),
    );
  }
  optimistic(address: SessionAddress) {
    return [...this.operations.values()].filter(
      (state) =>
        sameAddress(state.key, address) &&
        state.optimistic &&
        (state.delivery !== "followUp" || state.disposition !== undefined) &&
        state.content &&
        state.state !== "rejected" &&
        state.state !== "unknown" &&
        state.disposition !== "handled",
    );
  }
  queued(address: SessionAddress) {
    const rank = (state: SendState) =>
      this.ranks.get(this.operationKey(state.key)) ?? Number.MAX_SAFE_INTEGER;
    return [...this.operations.values()]
      .filter(
        (state) =>
          sameAddress(state.key, address) &&
          !state.detached &&
          state.delivery === "followUp" &&
          state.content &&
          isSendUnconfirmed(state) &&
          state.state !== "unknown",
      )
      .sort((a, b) => rank(a) - rank(b));
  }
  private rank(address: SessionAddress, requestIds: string[]) {
    requestIds.forEach((requestId, index) => {
      this.ranks.set(this.operationKey({ ...address, requestId }), index);
    });
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  /** Shows the new order at once, then adopts the host's authoritative order. */
  async reorderQueued(address: SessionAddress, requestIds: string[]) {
    const before = this.queued(address).map((state) => state.key.requestId);
    this.rank(address, requestIds);
    try {
      const order = await this.transport.reorderPrompts?.({
        ...address,
        requestIds,
      });
      if (order) this.rank(address, order);
    } catch (error) {
      this.rank(address, before);
      throw error;
    }
  }
  /** Sends a waiting follow-up now; it then appears in the conversation as steering. */
  async steerQueued(address: SessionAddress, key: SendKey) {
    const id = this.operationKey(key);
    const state = this.queued(address).find(
      (item) => this.operationKey(item.key) === id,
    );
    if (!state || !this.transport.steerPrompt) return false;
    if (!(await this.transport.steerPrompt(key))) return false;
    this.promoted.add(id);
    const latest = this.operations.get(id);
    if (latest)
      this.put(
        address,
        { ...latest, timestamp: Date.now() },
        this.read(address)?.key.requestId === key.requestId,
      );
    return true;
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
          !state.detached &&
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
        (state.state === "unknown" && !state.returned) ||
        (state.state === "checking" &&
          !(state.delivery === "followUp" && state.stage === "queued")) ||
        (state.detached && !!state.content) ||
        state.recoveredQueue,
    );
  }
  private operationKey(key: SendKey) {
    return `${addressKey(key)}:${key.requestId}`;
  }
  /** After a confirmed stop and history change, keep old payloads out of the new run. */
  retire(address: SessionAddress) {
    for (const [id, state] of this.operations) {
      const owner = this.transfers.get(id)?.address ?? state.key;
      if (!sameAddress(state.key, address) && !sameAddress(owner, address))
        continue;
      if (!this.dispatched.has(id)) this.cancelled.add(id);
      this.retries.delete(id);
      this.operations.set(id, { ...state, detached: true, optimistic: false });
      this.transfers.delete(id);
      this.ranks.delete(id);
    }
    for (const [key, state] of this.states)
      if (this.operations.get(this.operationKey(state.key))?.detached)
        this.states.delete(key);
    this.tick++;
    for (const listener of this.listeners) listener();
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
        this.ranks.delete(key);
        this.promoted.delete(key);
        this.retries.delete(key);
      }
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  private put(address: SessionAddress, state: SendState, current = true) {
    const id = this.operationKey(state.key);
    if (this.operations.get(id)?.detached)
      state = { ...state, detached: true, optimistic: false };
    // Captured send states still say followUp; promotion is the newer fact.
    if (this.promoted.has(id)) state = { ...state, delivery: "steer" };
    if (!isSendUnconfirmed(state)) this.ranks.delete(id);
    this.operations.set(id, state);
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
      const latest = this.operations.get(key);
      if (
        !latest ||
        latest.returned ||
        latest.detached ||
        !isSendUnconfirmed(latest) ||
        !this.activeDraft(this.transfers.get(key)?.address ?? address)
      )
        return;
      // Keep one hung receipt RPC, but still exhaust the bounded send retries.
      if (this.lookups.has(key) && latest.recoveryReason === "lookup-timeout") {
        this.retryOrReturn(address, latest);
        return;
      }
      void this.lookup(address, state.key);
    }, delay);
  }
  restore(intents: SendIntent[]) {
    for (const intent of intents) {
      const receipt = intent.receipt;
      const id = this.operationKey(receipt);
      // A restored reservation may already be running on the host, even after a renderer reload.
      if (receipt.state === "pending" && receipt.stage !== "prepared")
        this.dispatched.add(id);
      const existing = this.operations.get(id);
      if (existing?.detached) continue;
      if (existing?.returned) {
        if (receipt.state === "accepted" || receipt.state === "rejected")
          this.settle(receipt, existing, {
            state: receipt.state,
            ...(receipt.state === "accepted"
              ? { disposition: receipt.accepted.disposition }
              : { message: receipt.message }),
          });
        continue;
      }
      const draft = this.drafts.read(receipt);
      // The recovery read includes old owners and other chats in the project.
      const live = this.activeDraft(this.transfers.get(id)?.address ?? receipt);
      const recoveredQueue = !!(
        !intent.recovered &&
        !live &&
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
        state:
          receipt.state === "pending"
            ? intent.recovered || !live
              ? "unknown"
              : "checking"
            : receipt.state,
        content: intent.recovered ? undefined : intent.content,
        returned: intent.recovered,
        owner: intent.owner,
        recoveredQueue,
        delivery: intent.delivery,
        stage: receipt.state === "pending" ? receipt.stage : undefined,
        timestamp: intent.timestamp,
        optimistic: !!intent.delivery && live,
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
      if (live && state.state === "checking") this.poll(receipt, state);
      if (live && state.state === "unknown")
        queueMicrotask(() => this.returnUnknown(state));
    }
  }
  /**
   * Stop cancels every send not yet dispatched, then holds later sends until
   * the host finishes stopping. Accepted sends are handled by the host.
   */
  stop(address: SessionAddress, abort: () => Promise<void>) {
    for (const [id, state] of this.operations) {
      if (sameAddress(state.key, address)) this.retries.delete(id);
      if (
        sameAddress(state.key, address) &&
        isSendUnconfirmed(state) &&
        !this.dispatched.has(id)
      )
        this.cancelled.add(id);
    }
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
    resume = false,
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
      key: {
        ...address,
        requestId: `${resume ? RESUME_REQUEST_PREFIX : ""}${crypto.randomUUID()}`,
      },
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
      if (
        !isSendUnconfirmed(this.operations.get(id)) ||
        this.operations.get(id)?.returned
      )
        return;
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
    const prepare = this.transport.prepareSession?.(address);
    if (prepare) await prepare;
    check();
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
    this.retries.set(id, { payload, attempts: 1 });
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
    this.retries.delete(id);
    if (previous?.returned)
      state = {
        ...state,
        content: undefined,
        optimistic: false,
        returned: true,
        version: previous.version,
      };
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
      !previous?.detached &&
      !this.withdrawn.has(id)
    )
      this.drafts.restoreSent(address, state.content);
    this.put(
      address,
      {
        ...state,
        content:
          previous?.detached ||
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
  private retryOrReturn(address: SessionAddress, state: SendState) {
    const id = this.operationKey(state.key);
    const retry = this.retries.get(id);
    if (
      !state.detached &&
      !state.returned &&
      !this.cancelled.has(id) &&
      !this.transfers.has(id) &&
      this.activeDraft(address) &&
      retry &&
      retry.attempts < 3
    ) {
      retry.attempts++;
      this.put(
        address,
        { ...state, state: "checking" },
        this.read(address)?.key.requestId === state.key.requestId,
      );
      // No new CAS, selection or request ID: this is the exact same send.
      void Promise.resolve()
        .then(async () => {
          if (this.retries.get(id) !== retry || !this.activeDraft(address))
            return;
          const accepted = await this.transport.prompt(retry.payload);
          this.settle(address, state, {
            state: "accepted",
            disposition: accepted.disposition,
          });
        })
        .catch(() => {});
      this.poll(address, state);
      return;
    }
    this.returnUnknown(state);
  }
  private returnUnknown(state: SendState) {
    const id = this.operationKey(state.key);
    const latest = this.operations.get(id);
    if (
      !isSendUnconfirmed(latest) ||
      latest?.returned ||
      latest?.detached ||
      !state.content
    )
      return;
    const next = this.transfers.get(id);
    const owner = next?.address ?? state.key;
    if (!this.activeDraft(owner)) return;
    this.retries.delete(id);
    // A delayed CAS ACK must not dispatch input after it was returned for editing.
    if (!this.dispatched.has(id)) this.cancelled.add(id);
    const draft = this.drafts.read(owner);
    const empty =
      !expandedDraft(draft.content) &&
      !draft.content.images.length &&
      !draft.content.files?.length &&
      !draft.content.annotations?.length;
    if (!state.key.requestId.startsWith(RESUME_REQUEST_PREFIX))
      this.drafts.restoreSent(owner, state.content);
    const returned: SendState = {
      ...state,
      state: "unknown",
      content: undefined,
      optimistic: false,
      returned: true,
      message: undefined,
      // A late acceptance may clear only the unchanged, exclusively restored draft.
      version: empty ? this.drafts.read(owner).version : -1,
    };
    if (next) next.state = returned;
    this.put(
      owner,
      returned,
      this.read(owner)?.key.requestId === state.key.requestId,
    );
    this.notice("unknown");
    // Only cancelled history can prove recovery of a receipt from another owner.
    void this.saveRecovery(
      owner,
      sameAddress(owner, state.key) ? [state.key] : [],
      true,
    );
  }
  lookup(
    address: SessionAddress,
    key = this.read(address)?.key,
  ): Promise<void> {
    if (!key) return Promise.resolve();
    const id = this.operationKey(key);
    const state = this.operations.get(id);
    if (!isSendUnconfirmed(state) || !state || state.detached)
      return Promise.resolve();
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
        // A late non-terminal reply must not put returned input back in the tray.
        if (this.operations.get(id)?.returned) return;
        if (receipt.state === "unknown") {
          if (receipt.reason === "host-restarted") this.returnUnknown(state);
          else this.retryOrReturn(address, state);
          return;
        }
        if (receipt.stage === "prepared" && !this.dispatched.has(id)) {
          this.returnUnknown({ ...state, recoveryReason: "prepared" });
          return;
        }
        if (receipt.stage === "prepared") {
          this.retryOrReturn(address, state);
          return;
        }
        update({
          ...state,
          state: state.state === "unknown" ? "unknown" : "checking",
          stage: receipt.stage,
        });
      })
      .catch(() => {
        const failures = (this.failures.get(id) ?? 0) + 1;
        this.failures.set(id, failures);
        // An unreachable receipt service must not leave a send looking active forever.
        if (state.returned) return;
        this.retryOrReturn(address, {
          ...state,
          recoveryReason: "lookup-timeout",
        });
      })
      .finally(() => {
        clearTimeout(timer);
        this.lookups.delete(id);
        if (
          ["sending", "checking"].includes(
            this.operations.get(id)?.state ?? "",
          ) &&
          !this.operations.get(id)?.returned
        )
          this.poll(address, state);
      });
    const bounded = Promise.race([
      request,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.retryOrReturn(address, {
            ...state,
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
        state.detached ||
        !isSendUnconfirmed(state) ||
        !sameAddress(transfer?.address ?? state.key, previous)
      )
        continue;
      const source = transfer?.state ?? state;
      this.retries.delete(id);
      const moved: SendState = {
        ...source,
        version:
          old.version === source.version &&
          current.version === old.transferredVersion
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
