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
type Transport = {
  syncDraft(params: DraftSyncParams): Promise<DraftSyncResult>;
  prompt(params: PromptParams): Promise<PromptAccepted>;
  getPromptReceipt(params: SendKey): Promise<PromptReceipt>;
};
/** A transport failure is not a rejection. Only read-only lookup is ever retried. */
export class SendController {
  private states = new Map<string, SendState>();
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
    if (previous && ["sending", "checking", "unknown"].includes(previous.state))
      return;
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
      this.put(address, {
        ...state,
        state: "rejected",
        message: String(error),
      });
      return;
    }
    try {
      await this.transport.prompt(payload);
      this.accept(address, state);
    } catch {
      this.put(address, {
        ...state,
        state: "checking",
        message: "Checking acceptance — do not resend.",
      });
      await this.lookup(address);
    }
  }
  private accept(address: SessionAddress, state: SendState) {
    if (this.read(address)?.key.requestId !== state.key.requestId) return;
    const cleared = this.drafts.clearAccepted(address, state.version);
    this.put(address, { ...state, state: "accepted", message: undefined });
    // Mirror the accepted clear, without risking a newer extension revision.
    if (cleared)
      void this.drafts.flush(address, this.transport.syncDraft).catch(() => {});
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
        this.accept(address, state);
        return;
      }
      if (receipt.state === "rejected") {
        this.put(address, {
          ...state,
          state: "rejected",
          message: receipt.message,
        });
        return;
      }
      if (receipt.state === "unknown") {
        this.put(address, {
          ...state,
          state: "unknown",
          message:
            "Acceptance is unknown. This message may have executed. Inspect history before explicitly sending again.",
        });
        return;
      }
      this.put(address, {
        ...state,
        state: "checking",
        message: "Checking acceptance — do not resend.",
      });
    } catch {
      this.put(address, {
        ...state,
        state: "checking",
        message: "Connection unavailable; checking acceptance. Draft retained.",
      });
    }
    this.schedule(() => {
      void this.lookup(address);
    });
  }
  confirmNewSend(address: SessionAddress) {
    const state = this.read(address);
    if (state?.state === "unknown")
      this.put(address, {
        ...state,
        state: "rejected",
        message: "New send explicitly enabled after inspecting history.",
      });
  }
  transfer(previous: SessionAddress, next: SessionAddress) {
    const state = this.read(previous);
    if (state && ["sending", "checking", "unknown"].includes(state.state))
      this.put(next, {
        ...state,
        state: "unknown",
        message:
          "Session ownership changed while acceptance was unconfirmed. The old send may have executed. Inspect history before enabling a NEW send.",
      });
  }
}
