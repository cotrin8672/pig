import { Composer } from "../../mainview/Composer";
import { Notifications } from "../../mainview/Notifications";
import { useStore } from "../../mainview/store";

export default function ComposerUIPreview() {
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  return (
    <div className="app-shell current-ui-screen">
      <div className="chat-shell current-ui-composer">
        <Composer snapshot={snapshot} />
      </div>
      <Notifications />
    </div>
  );
}
