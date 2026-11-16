import type { RuntimeCursor } from "../shared/runtime-contract";

export type PublicationPhase = "live" | "before-state" | "covered";
type Buffered = RuntimeCursor & {
  apply: (phase: PublicationPhase) => void;
};

/** A read is a fixed boundary in the event stream, not a wait for a quiet host. */
export class RuntimeSync {
  private cursor?: RuntimeCursor;
  private pending?: Buffered[];
  private retiredHosts = new Set<string>();
  private observedHosts = new Set<string>();
  private hostsAtRead = new Set<string>();

  begin() {
    this.pending ??= [];
    this.hostsAtRead = new Set(this.observedHosts);
  }

  receive(cursor: RuntimeCursor, apply: Buffered["apply"]): boolean {
    if (this.retiredHosts.has(cursor.hostId)) return true;
    this.observedHosts.add(cursor.hostId);
    if (this.pending) {
      this.pending.push({
        hostId: cursor.hostId,
        publicationSeq: cursor.publicationSeq,
        apply,
      });
      return true;
    }
    if (this.cursor && this.cursor.hostId !== cursor.hostId) return false;
    this.cursor ??= {
      hostId: cursor.hostId,
      publicationSeq: 0,
    };
    apply(
      this.cursor && cursor.publicationSeq <= this.cursor.publicationSeq
        ? "covered"
        : "live",
    );
    return true;
  }

  finish(cursor: RuntimeCursor, applyState: () => void): Buffered[] {
    const buffered = this.pending ?? [];
    // A read started after seeing another host confirms that host is obsolete.
    for (const host of this.hostsAtRead)
      if (host !== cursor.hostId) this.retiredHosts.add(host);
    if (this.cursor && this.cursor.hostId !== cursor.hostId)
      this.retiredHosts.add(this.cursor.hostId);
    this.observedHosts.add(cursor.hostId);
    const events = buffered
      .filter((event) => event.hostId === cursor.hostId)
      .sort((a, b) => a.publicationSeq - b.publicationSeq);
    // Notifications, terminal opens and ownership transfers are not all in the
    // snapshot. Deliver the covered prefix before installing the authoritative state.
    for (const event of events)
      if (event.publicationSeq <= cursor.publicationSeq)
        event.apply("before-state");
    applyState();
    this.cursor = {
      hostId: cursor.hostId,
      publicationSeq: cursor.publicationSeq,
    };
    this.pending = undefined;
    for (const event of events)
      if (event.publicationSeq > cursor.publicationSeq) event.apply("live");
    return buffered.filter(
      (event) =>
        event.hostId !== cursor.hostId && !this.retiredHosts.has(event.hostId),
    );
  }

  cancel() {
    const events = this.pending ?? [];
    this.pending = undefined;
    for (const event of events)
      if (!this.cursor || event.hostId === this.cursor.hostId)
        this.receive(event, event.apply);
  }
}
