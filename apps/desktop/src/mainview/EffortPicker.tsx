import type { Effort, Snapshot } from "../shared/rpc-schema";
import { EffortSlider } from "./EffortSlider";
import { changeSelection } from "./Picker";
import { rpc } from "./rpc";
import { useStore } from "./store";

export function EffortPicker({ snapshot }: { snapshot: Snapshot }) {
  const pending = useStore((state) => state.modelPending);
  const id = snapshot.info.id;
  return (
    <EffortSlider
      levels={snapshot.effortLevels}
      value={snapshot.effort}
      disabled={snapshot.transcript.running || pending}
      onCommit={async (effort: Effort) => {
        // changeSelection reports errors itself; reject so the slider snaps back.
        await changeSelection(id, () =>
          rpc.request.setEffort({ sessionId: id, effort }),
        );
        if (useStore.getState().snapshots[id]?.effort !== effort)
          throw new Error("Effort not applied");
      }}
    />
  );
}
