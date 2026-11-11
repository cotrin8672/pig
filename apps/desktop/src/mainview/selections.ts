import type { ModelSelection } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import { sameAddress } from "./chat-snapshot";
import { SelectionController } from "./selection-controller";
import { lane } from "./session-lane";
import { showError, useStore } from "./store";

export const selections = new SelectionController(
  (address, selection) => {
    useStore.setState((state) => {
      const snapshot = state.snapshots[address.sessionId];
      if (!snapshot || !sameAddress(snapshot.address, address)) return {};
      return {
        snapshots: {
          ...state.snapshots,
          [address.sessionId]: { ...snapshot, ...selection },
        },
      };
    });
  },
  showError,
  (address, issue) => lane.enqueue(address, issue),
);

export function changeSelection(
  address: SessionAddress,
  desired: ModelSelection,
  request: () => Promise<ModelSelection>,
) {
  const snapshot = useStore.getState().snapshots[address.sessionId];
  if (!snapshot || !sameAddress(snapshot.address, address))
    return Promise.resolve();
  return selections.change(address, snapshot, desired, request);
}
