import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";
import "../primitives/button.css";
import "./chat-list-row.css";

export function ChatListRow({
  label,
  active,
  indicator,
  trailing,
  editor,
  actions,
  rowRef,
  ...button
}: Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-current" | "children" | "className" | "title" | "type"
> & {
  label: string;
  active?: boolean;
  indicator?: ReactNode;
  trailing?: ReactNode;
  editor?: ReactNode;
  actions?: ReactNode;
  rowRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={rowRef}
      className={`thread-row ${active ? "active" : ""}`}
      data-actions={actions ? "" : undefined}
    >
      {editor ?? (
        <button
          {...button}
          type="button"
          className="thread"
          aria-current={active ? "page" : undefined}
        >
          <span className="session-status-slot">{indicator}</span>
          <span className="thread-title">{label}</span>
          {trailing}
        </button>
      )}
      {actions}
    </div>
  );
}
