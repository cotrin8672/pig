import { UI_CONNECTION_LEASE_MS } from "../shared/runtime-contract";

/** Root liveness only, not chat ownership or terminal replay. Expiry denies new
 * UI and cancels pending requests even when native renderer-loss hooks are absent. */
export class UIConnectionLease {
  private clients = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly lost: () => void,
    private readonly leaseMs = UI_CONNECTION_LEASE_MS,
    private readonly now = Date.now,
  ) {}
  connect(clientId: string) {
    if (typeof clientId !== "string" || !clientId || clientId.length > 256)
      throw new Error("Invalid Root client ID");
    this.expire();
    if (!this.clients.has(clientId) && this.clients.size >= 32)
      throw new Error("Too many Root connections");
    this.clients.set(clientId, this.now() + this.leaseMs);
    if (!this.timer) {
      this.timer = setInterval(
        () => this.expire(),
        Math.min(5000, this.leaseMs),
      );
      this.timer.unref();
    }
  }
  heartbeat(clientId: string): boolean {
    this.expire();
    if (!this.clients.has(clientId)) return false;
    this.clients.set(clientId, this.now() + this.leaseMs);
    return true;
  }
  disconnect(clientId: string) {
    if (!this.clients.delete(clientId)) return;
    if (!this.clients.size) this.clear();
  }
  expire() {
    const hadClients = this.clients.size > 0;
    for (const [client, deadline] of this.clients)
      if (deadline <= this.now()) this.clients.delete(client);
    if (hadClients && !this.clients.size) this.clear();
  }
  clear() {
    this.clients.clear();
    clearInterval(this.timer);
    this.timer = undefined;
    this.lost();
  }
}
