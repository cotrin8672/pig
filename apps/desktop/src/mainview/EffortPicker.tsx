import type { Effort, Snapshot } from "../shared/rpc-schema";
import { EffortSlider } from "./EffortSlider";
import { changeSelection } from "./Picker";
import { requestSelection, rpc } from "./rpc";
import { useStore } from "./store";

export function EffortPicker({ snapshot }: { snapshot: Snapshot }) {
  const id = snapshot.info.id;
  return (
    <EffortSlider
      levels={snapshot.effortLevels}
      value={snapshot.effort}
      onCommit={async (effort: Effort) => {
        // changeSelection reports errors itself; reject so the slider snaps back.
        await changeSelection(snapshot.address, { ...snapshot, effort }, () =>
          requestSelection(snapshot.address, () =>
            rpc.request.setEffort({ ...snapshot.address, effort }),
          ),
        );
        if (useStore.getState().snapshots[id]?.effort !== effort)
          throw new Error("Effort not applied");
      }}
    />
  );
}
