import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";

/**
 * Issues session-ordered requests in click order. A step resolves once its RPC
 * has been sent; the host orders execution, so later steps never wait for
 * responses or a running turn.
 */
export class SessionLane {
  private tails = new Map<string, Promise<void>>();
  enqueue(address: SessionAddress, step: () => unknown): Promise<void> {
    const key = addressKey(address);
    const run = (this.tails.get(key) ?? Promise.resolve()).then(step).then(
      () => {},
      () => {},
    );
    this.tails.set(key, run);
    void run.then(() => {
      if (this.tails.get(key) === run) this.tails.delete(key);
    });
    return run;
  }
  move(previous: SessionAddress, next: SessionAddress) {
    const tail = this.tails.get(addressKey(previous));
    if (!tail) return;
    this.tails.delete(addressKey(previous));
    this.enqueue(next, () => tail);
  }
}
export const lane = new SessionLane();
