import {
  type TerminalClientCommand,
  type TerminalHostEvent,
  terminalAddressKey,
  type UIAddress,
} from "../shared/terminal-ui";

export const TERMINAL_IN_USE = "This terminal is open in another window.";

type Entry = { address: UIAddress; owner?: string; refused: Set<string> };

/** A hosted terminal has one input/ack stream. The first UI client that sends
 * `ready` owns it; other windows see it but cannot drive or close it. */
export class TerminalRouter {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly deliver: {
      broadcast: (event: TerminalHostEvent) => void;
      to: (client: string, event: TerminalHostEvent) => void;
    },
    private readonly cancel: (address: UIAddress) => void,
  ) {}
  event(event: TerminalHostEvent) {
    const key = terminalAddressKey(event);
    if (event.type === "open")
      this.entries.set(key, {
        address: {
          sessionId: event.sessionId,
          epoch: event.epoch,
          uiId: event.uiId,
        },
        refused: new Set(),
      });
    const owner = this.entries.get(key)?.owner;
    if (event.type === "close") this.entries.delete(key);
    if (owner && event.type === "data") this.deliver.to(owner, event);
    else this.deliver.broadcast(event);
  }
  /** True when the command should reach the host. Throws once per refused client. */
  accept(client: string, command: TerminalClientCommand): boolean {
    const entry = this.entries.get(terminalAddressKey(command));
    if (!entry) return true;
    if (!entry.owner) {
      if (command.type === "ready") entry.owner = client;
      return true;
    }
    if (entry.owner === client) return true;
    // Closing a mirrored dialog is a local dismissal, never the owner's terminal.
    if (command.type === "cancel" || entry.refused.has(client)) return false;
    entry.refused.add(client);
    throw new Error(TERMINAL_IN_USE);
  }
  /** The owner's page went away: its terminal has no replay, so end it. */
  drop(client: string) {
    for (const entry of this.entries.values()) {
      entry.refused.delete(client);
      if (entry.owner !== client) continue;
      entry.owner = undefined;
      try {
        this.cancel(entry.address);
      } catch (error) {
        console.error("Cannot cancel terminal of a closed window", error);
      }
    }
  }
}
