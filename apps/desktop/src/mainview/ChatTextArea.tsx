import type { ComponentProps } from "react";
import "./chat-text-area.css";

export function ChatTextArea({
  className,
  rows = 1,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={className ? `chat-text-area ${className}` : "chat-text-area"}
    />
  );
}
