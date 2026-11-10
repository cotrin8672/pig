import { Folder, MoveHorizontal, X } from "lucide-react";
import { DEFAULT_CHAT_WIDTH } from "../shared/chat-width";
import { useChatWidth } from "./ChatWidth";
import { useT } from "./i18n";
import { useStore } from "./store";

export function ChatHeader({
  cwd,
  title,
  closeLabel,
  onClose,
}: {
  cwd?: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const t = useT();
  const general = useStore((s) => s.bootstrap.generalCwd === cwd);
  const { setWidth } = useChatWidth();
  const project = general
    ? t.Chats
    : cwd?.split(/[\\/]/).filter(Boolean).pop() || t.Chats;
  return (
    <header className="chat-header">
      <div className="chat-heading">
        <Folder size={14} aria-hidden="true" />
        <span title={project}>{project}</span>
        <small title={title}>{title}</small>
      </div>
      <div className="chat-header-actions electrobun-webkit-app-region-no-drag">
        <button
          type="button"
          aria-label={t["Reset chat width"]}
          title={t["Reset chat width (drag either edge to resize)"]}
          onClick={() => setWidth(DEFAULT_CHAT_WIDTH)}
        >
          <MoveHorizontal size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
