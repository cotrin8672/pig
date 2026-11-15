import { Chat } from "../../mainview/App";
import { Notifications } from "../../mainview/Notifications";
import { useStore } from "../../mainview/store";

export default function ChatScreenPreview() {
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  return (
    <div className="app-shell current-ui-screen">
      <Chat snapshot={snapshot} />
      <Notifications />
    </div>
  );
}
