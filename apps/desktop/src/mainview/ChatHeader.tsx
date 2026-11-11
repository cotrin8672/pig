import { Folder } from "lucide-react";
import { useT } from "./i18n";
import { useStore } from "./store";

export function ChatHeader({ cwd, title }: { cwd?: string; title: string }) {
  const t = useT();
  const general = useStore((s) => s.bootstrap.generalCwd === cwd);
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
    </header>
  );
}
