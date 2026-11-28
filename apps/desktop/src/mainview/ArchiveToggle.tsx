import { Archive } from "lucide-react";
import "./archive-toggle.css";

export function ArchiveToggle({
  active,
  count,
  archiveLabel,
  backLabel,
  onToggle,
}: {
  active: boolean;
  count: number;
  archiveLabel: string;
  backLabel: string;
  onToggle: () => void;
}) {
  if (count <= 0 && !active) return null;
  return (
    <button
      type="button"
      className="archived-chats"
      aria-pressed={active}
      onClick={onToggle}
    >
      <Archive size={12} aria-hidden="true" />
      {active ? backLabel : `${archiveLabel} (${count})`}
    </button>
  );
}
