import type {
  DraftSyncParams,
  DraftSyncResult,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
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
  constructor(
    private drafts: DraftStore,
    private transport: Transport,
    private schedule: (lookup: () => void) => void = (lookup) => {
      setTimeout(lookup, 1500);
    },
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
  private put(address: SessionAddress, state: SendState) {
    this.states.set(addressKey(address), state);
    for (const listener of this.listeners) listener();
  }
  async send(address: SessionAddress) {
    const previous = this.read(address);
    // An unknown receipt never triggers a retry or requires permission for a new send.
    if (previous && ["sending", "checking"].includes(previous.state)) return;
    // Reserve before awaiting CAS so double-clicks cannot register two sends.
    const state: SendState = {
      key: { ...address, requestId: crypto.randomUUID() },
      version: this.drafts.read(address).version,
      state: "sending",
    };
    this.put(address, state);
    let payload: PromptParams;
    try {
      const draft = await this.drafts.flush(address, this.transport.syncDraft);
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
      this.settle(address, state, {
        state: "rejected",
        message: String(error),
      });
      return;
    }
    try {
      await this.transport.prompt(payload);
      this.settle(address, state, { state: "accepted" });
    } catch {
      if (this.read(address)?.key.requestId !== state.key.requestId) return;
      this.put(address, {
        ...state,
        state: "checking",
      });
      await this.lookup(address);
    }
  }
  private settle(
    address: SessionAddress,
    state: SendState,
    result: { state: "accepted" | "rejected"; message?: string },
  ) {
    if (this.read(address)?.key.requestId !== state.key.requestId) return;
    const cleared =
      result.state === "accepted" &&
      this.drafts.clearAccepted(address, state.version);
    this.put(address, { ...state, message: undefined, ...result });
    // Mirror the accepted clear, without risking a newer extension revision.
    if (cleared)
      void this.drafts.flush(address, this.transport.syncDraft).catch(() => {});
    const next = this.transfers.get(addressKey(address));
    const transferred = next && this.read(next);
    this.transfers.delete(addressKey(address));
    if (next && transferred?.key.requestId === state.key.requestId)
      this.settle(next, transferred, result);
  }
  async lookup(address: SessionAddress) {
    const state = this.read(address);
    if (!state || !["sending", "checking"].includes(state.state)) return;
    try {
      const receipt = await this.transport.getPromptReceipt(state.key);
      if (
        !sameAddress(receipt, state.key) ||
        receipt.requestId !== state.key.requestId
      )
        throw new Error("Receipt address mismatch");
      if (this.read(address)?.key.requestId !== state.key.requestId) return;
      if (receipt.state === "accepted") {
        this.settle(address, state, { state: "accepted" });
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
        this.put(address, {
          ...state,
          state: "unknown",
          message: undefined,
        });
        return;
      }
      this.put(address, {
        ...state,
        state: "checking",
      });
    } catch {
      if (this.read(address)?.key.requestId !== state.key.requestId) return;
      this.put(address, {
        ...state,
        state: "checking",
      });
    }
    this.schedule(() => {
      void this.lookup(address);
    });
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
