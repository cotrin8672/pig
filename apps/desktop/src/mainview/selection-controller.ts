import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";

const selectionOf = ({
  model,
  effort,
  effortLevels,
  contextUsage,
}: ModelSelection): ModelSelection => ({
  model,
  effort,
  effortLevels,
  contextUsage,
});

type Pending = {
  confirmed: ModelSelection;
  desired: ModelSelection;
  revision: number;
  task: Promise<void>;
};
/** Selection belongs to a session, not to whichever picker is currently mounted. */
export class SelectionController {
  private pending = new Map<string, Pending>();
  constructor(
    private publish: (
      address: SessionAddress,
      selection: ModelSelection,
    ) => void,
    private report: (error: unknown) => void,
    private sequence: (
      address: SessionAddress,
      issue: () => unknown,
    ) => unknown = (_, issue) => issue(),
  ) {}
  overlay(snapshot: Snapshot): Snapshot {
    const pending = this.pending.get(addressKey(snapshot.address));
    if (!pending) return snapshot;
    pending.confirmed = selectionOf(snapshot);
    return { ...snapshot, ...pending.desired };
  }
  take(address: SessionAddress) {
    const key = addressKey(address);
    const pending = this.pending.get(key);
    this.pending.delete(key);
    return pending?.desired;
  }
  async flush(address: SessionAddress) {
    while (this.pending.has(addressKey(address)))
      await this.pending.get(addressKey(address))?.task;
  }
  change(
    address: SessionAddress,
    current: ModelSelection,
    desired: ModelSelection,
    request: () => Promise<ModelSelection>,
  ) {
    const key = addressKey(address);
    const pending = this.pending.get(key) ?? {
      confirmed: selectionOf(current),
      desired,
      revision: 0,
      task: Promise.resolve(),
    };
    pending.desired = selectionOf(desired);
    const revision = ++pending.revision;
    this.pending.set(key, pending);
    this.publish(address, pending.desired);
    // Issue in click order with sends; never wait for an earlier response first.
    const response = new Promise<ModelSelection>((resolve, reject) => {
      this.sequence(address, () => {
        try {
          request().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    });
    const previous = pending.task;
    const task = (async () => {
      try {
        const selection = await response;
        await previous;
        pending.confirmed = selectionOf(selection);
      } catch (error) {
        await previous;
        if (this.pending.get(key) === pending) this.report(error);
      } finally {
        if (
          this.pending.get(key) === pending &&
          pending.revision === revision
        ) {
          this.pending.delete(key);
          this.publish(address, pending.confirmed);
        }
      }
    })();
    pending.task = task;
    return task;
  }
}
