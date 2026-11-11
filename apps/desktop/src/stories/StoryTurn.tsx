import type { ReactNode } from "react";

export function StoryTurn({
  role = "assistant",
  children,
}: {
  role?: string;
  children: ReactNode;
}) {
  return (
    <div className="response-turn">
      <article className={`message ${role}`}>{children}</article>
    </div>
  );
}
