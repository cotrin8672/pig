import {
  type RuntimeUsage,
  type SessionAddress,
  UI_CONNECTION_LEASE_MS,
} from "../shared/runtime-contract";

// Protection follows a chat across epochs; it never grants mutation authority.
const sessionKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId]);

/** A missing/expired report protects everything until native disconnect or a
 * fresh heartbeat. A renderer timeout is not evidence that its Panes are unused. */
export class RuntimeUsageTracker {
  private clients = new Map<
    string,
    { sequence: number; protected?: Set<string>; deadline: number }
  >();
  private connected = false;
  constructor(private readonly now = Date.now) {}
  connect(id: string) {
    this.connected = true;
    const previous = this.clients.get(id);
    this.clients.set(id, {
      sequence: previous?.sequence ?? -1,
      protected: previous?.protected,
      deadline: 0,
    });
  }
  update(id: string, usage: RuntimeUsage) {
    const client = this.clients.get(id);
    if (!client) return false;
    if (
      !Number.isSafeInteger(usage.sequence) ||
      usage.sequence < 0 ||
      !Array.isArray(usage.protected) ||
      usage.protected.length > 2048 ||
      usage.protected.some(
        (address) =>
          !address ||
          typeof address.hostId !== "string" ||
          typeof address.sessionId !== "string" ||
          !Number.isSafeInteger(address.epoch),
      )
    )
      throw new Error("Invalid runtime usage");
    if (usage.sequence < client.sequence) return false;
    if (usage.sequence > client.sequence) {
      client.sequence = usage.sequence;
      client.protected = new Set(usage.protected.map(sessionKey));
    }
    client.deadline = this.now() + UI_CONNECTION_LEASE_MS;
    return true;
  }
  disconnect(id: string) {
    this.clients.delete(id);
  }
  clear() {
    this.clients.clear();
  }
  protects(address: SessionAddress) {
    if (!this.connected) return true;
    const key = sessionKey(address);
    for (const client of this.clients.values())
      if (
        !client.protected ||
        client.deadline <= this.now() ||
        client.protected.has(key)
      )
        return true;
    return false;
  }
}
