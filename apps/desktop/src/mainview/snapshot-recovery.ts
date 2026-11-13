import type { Snapshot } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";

/** One bounded in-flight read per owner. A missing/dropped delta never clears
 * the visible transcript or reopens/replays a prompt. */
export function createSnapshotRecovery(
  read: (address: SessionAddress) => Promise<Snapshot>,
  current: (address: SessionAddress) => boolean,
) {
  const flights = new Map<
    string,
    { sequence: number; done: boolean; promise: Promise<void> }
  >();
  return (
    address: SessionAddress,
    sequence: number,
    apply: (snapshot: Snapshot) => void,
  ) => {
    const key = addressKey(address);
    const existing = flights.get(key);
    if (existing && !existing.done) {
      existing.sequence = Math.max(existing.sequence, sequence);
      return existing.promise;
    }
    const flight = { sequence, done: false, promise: Promise.resolve() };
    flights.set(key, flight);
    flight.promise = Promise.resolve()
      .then(async () => {
        let previous = -1;
        while (current(address)) {
          const snapshot = await read(address);
          if (!current(address)) return;
          if (addressKey(snapshot.address) !== key)
            throw new Error("Snapshot recovery returned another owner");
          if (
            snapshot.snapshotSeq < flight.sequence &&
            snapshot.snapshotSeq <= previous
          )
            throw new Error(
              "Snapshot recovery did not advance; current conversation was retained",
            );
          apply(snapshot);
          previous = snapshot.snapshotSeq;
          if (previous >= flight.sequence) {
            flight.done = true;
            return;
          }
        }
      })
      .finally(() => {
        flight.done = true;
        if (flights.get(key) === flight) flights.delete(key);
      });
    return flight.promise;
  };
}
