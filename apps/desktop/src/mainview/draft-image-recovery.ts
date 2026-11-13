import type { DraftState, SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";

/** Missing compact-draft bases fetch one authoritative draft, not all sessions.
 * Concurrent misses share a read; a newer notification raises its revision bar. */
export function createDraftImageRecovery(
  read: (address: SessionAddress) => Promise<DraftState>,
  apply: (address: SessionAddress, draft: DraftState) => void,
  current: (address: SessionAddress) => boolean,
) {
  const flights = new Map<
    string,
    { revision: number; done: boolean; promise: Promise<void> }
  >();
  return (address: SessionAddress, revision: number): Promise<void> => {
    const key = addressKey(address);
    const existing = flights.get(key);
    if (existing && !existing.done) {
      existing.revision = Math.max(existing.revision, revision);
      return existing.promise;
    }
    const flight = { revision, done: false, promise: Promise.resolve() };
    flights.set(key, flight);
    flight.promise = Promise.resolve()
      .then(async () => {
        let previous = -1;
        while (current(address)) {
          const draft = await read(address);
          if (!current(address)) return;
          if (draft.revision < flight.revision && draft.revision <= previous)
            throw new Error(
              "Draft image recovery did not advance; local draft was retained.",
            );
          apply(address, draft);
          previous = draft.revision;
          if (draft.revision >= flight.revision) {
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
