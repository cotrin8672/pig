import type { Snapshot } from "../shared/rpc-schema";
import type { OpenSessionParams, OpenState } from "../shared/runtime-contract";

type OpenTransport = {
  openSession(params: OpenSessionParams): Promise<Snapshot>;
  getOpenState(params: { openId: string }): Promise<OpenState>;
  cancelOpen(params: { openId: string }): Promise<void>;
};
/** One open mutation per client key; only read-only lookup follows transport loss. */
export class OpenController {
  private cancelled = new Set<string>();
  constructor(
    private transport: OpenTransport,
    private pause: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 1000)),
  ) {}
  isCancelled(openId: string) {
    return this.cancelled.has(openId);
  }
  cancel(openId: string) {
    this.cancelled.add(openId);
    return this.transport.cancelOpen({ openId });
  }
  async open(
    params: OpenSessionParams,
    status: (message: string) => void,
  ): Promise<Snapshot | undefined> {
    if (this.isCancelled(params.openId)) return;
    try {
      const snapshot = await this.transport.openSession(params);
      return this.isCancelled(params.openId) ? undefined : snapshot;
    } catch {
      status("Checking open state — no second open will be sent.");
    }
    while (!this.isCancelled(params.openId)) {
      let state: OpenState;
      try {
        state = await this.transport.getOpenState({ openId: params.openId });
      } catch {
        status(
          "Connection unavailable — retaining the open ID and checking state. You may cancel.",
        );
        await this.pause();
        continue;
      }
      if (this.isCancelled(params.openId)) return;
      if (state.state === "ready") return state.snapshot;
      if (state.state === "failed" || state.state === "cancelled")
        throw new Error(state.message);
      if (state.state === "unknown")
        throw new Error(
          "Open state is unknown. No automatic retry was sent. Inspect the session list before opening again.",
        );
      status("Still opening — waiting for startup UI. You may cancel.");
      await this.pause();
    }
  }
}
