import type { ReactNode } from "react";

export function StoryTurn({
  speaker = "assistant",
  children,
}: {
  speaker?: "assistant" | "user";
  children: ReactNode;
}) {
  return (
    <div className="response-turn">
      <article className={`message ${speaker}`}>{children}</article>
    </div>
  );
}
