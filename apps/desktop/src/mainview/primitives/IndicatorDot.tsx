import "./indicator-dot.css";

type State = "running" | "completed" | "waiting" | "failed" | "unread";

/** Omit label when the surrounding control already announces the state. */
export function IndicatorDot({
  state,
  label,
}: {
  state: State;
  label?: string;
}) {
  const className =
    state === "unread" ? "notification-unread-dot" : `session-dot ${state}`;
  return label ? (
    <span className={className} role="img" aria-label={label} />
  ) : (
    <span className={className} aria-hidden="true" />
  );
}
