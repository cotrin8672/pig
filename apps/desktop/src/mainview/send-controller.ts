import type {
  DraftSyncParams,
  DraftSyncResult,
  PromptAccepted,
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
};
export function isSendUnconfirmed(state: SendState | undefined) {
  return !!state && ["sending", "checking", "unknown"].includes(state.state);
}
type Transport = {
  syncDraft(params: DraftSyncParams): Promise<DraftSyncResult>;
  prompt(params: PromptParams): Promise<PromptAccepted>;
  getPromptReceipt(params: SendKey): Promise<PromptReceipt>;
};
/** A transport failure is not a rejection. Only read-only lookup is ever retried. */
export class SendController {
  private states = new Map<string, SendState>();
  private transfers = new Map<string, SessionAddress>();
  private listeners = new Set<() => void>();
  private operations = new Map<string, SendState>();
  private scheduled = new Set<string>();
  private lookups = new Map<string, Promise<void>>();
  private failures = new Map<string, number>();
  private dispatched = new Set<string>();
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
  retained() {
    return [...this.operations.values()].filter(
      (state) =>
        state.state === "unknown" ||
        state.state === "checking" ||
        state.recoveredQueue,
    );
  }
  private operationKey(key: SendKey) {
    return `${addressKey(key)}:${key.requestId}`;
  }
  discard(address: SessionAddress) {
    this.states.delete(addressKey(address));
    for (const [key, state] of this.operations)
      if (sameAddress(state.key, address)) this.operations.delete(key);
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
  async send(address: SessionAddress) {
    const previous = this.read(address);
    // An unknown receipt never triggers a retry or requires permission for a new send.
    if (previous && ["sending", "checking"].includes(previous.state)) return;
    // Reserve before awaiting CAS so double-clicks cannot register two sends.
    const captured = this.drafts.read(address);
    const state: SendState = {
      key: { ...address, requestId: crypto.randomUUID() },
      version: captured.version,
      content: structuredClone(captured.content),
      state: "sending",
    };
    this.put(address, state);
    let payload: PromptParams;
    try {
      const draft = await this.drafts.flush(
        address,
        this.transport.syncDraft,
        captured,
        state.key.requestId,
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
      };
    } catch (error) {
      // A lost CAS ACK may already have reserved this ID on the host.
      this.put(address, {
        ...state,
        state: "checking",
        message: String(error),
      });
      await this.lookup(address, state.key);
      return;
    }
    this.poll(address, state);
    this.dispatched.add(this.operationKey(state.key));
    try {
      const result = await this.transport.prompt(payload);
      this.settle(address, state, {
        state: "accepted",
        disposition: result.disposition,
      });
    } catch {
      if (!isSendUnconfirmed(this.operations.get(this.operationKey(state.key))))
        return;
      this.put(address, {
        ...state,
        state: "checking",
      });
      await this.lookup(address, state.key);
    }
  }
  private settle(
    address: SessionAddress,
    state: SendState,
    result: {
      state: "accepted" | "rejected";
      message?: string;
      disposition?: PromptAccepted["disposition"];
    },
  ) {
    const previous = this.operations.get(this.operationKey(state.key));
    if (
      previous &&
      ["accepted", "rejected"].includes(previous.state) &&
      !isSendUnconfirmed(this.read(address))
    )
      return;
    if (previous?.state === "accepted" && result.state !== "accepted") return;
    const current = this.read(address)?.key.requestId === state.key.requestId;
    const cleared =
      current &&
      result.state === "accepted" &&
      this.drafts.clearAccepted(address, state.version);
    this.put(
      address,
      {
        ...state,
        content: state.recoveredQueue ? state.content : undefined,
        message: undefined,
        ...result,
      },
      current,
    );
    // Mirror the accepted clear, without risking a newer extension revision.
    if (cleared)
      void this.drafts.flush(address, this.transport.syncDraft).catch(() => {});
    const next = this.transfers.get(addressKey(address));
    const transferred = next && this.read(next);
    this.transfers.delete(addressKey(address));
    if (next && transferred?.key.requestId === state.key.requestId)
      this.settle(next, transferred, result);
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
    const state = this.read(previous);
    if (!state || !isSendUnconfirmed(state)) return;
    const old = this.drafts.read(previous);
    const current = this.drafts.read(next);
    this.transfers.set(addressKey(previous), next);
    this.put(next, {
      ...state,
      // Only the unchanged transferred draft may be cleared by a late receipt.
      version:
        old.version === state.version && current.content === old.content
          ? current.version
          : -1,
      state: "unknown",
      message: undefined,
    });
  }
}
