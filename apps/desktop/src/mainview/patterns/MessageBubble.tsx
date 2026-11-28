import type { FormEventHandler, ReactNode } from "react";
import "./message-bubble.css";

export function MessageBubble({
  children,
  sender,
  onSubmit,
}: {
  children: ReactNode;
  sender?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}) {
  if (onSubmit)
    return (
      <form className="user-edit user-bubble" onSubmit={onSubmit}>
        {children}
      </form>
    );
  return (
    <div className={sender ? "user-bubble sender-bubble" : "user-bubble"}>
      {sender}
      {children}
    </div>
  );
}
