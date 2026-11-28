import "./indicator-dot.css";

type State =
  | "running"
  | "completed"
  | "waiting"
  | "failed"
  | "unread"
  | "connected"
  | "offline";

/** Omit label when the surrounding control already announces the state. */
export function IndicatorDot({
  state,
  label,
  className,
}: {
  state: State;
  label?: string;
  className?: string;
}) {
  const face =
    state === "unread"
      ? "notification-unread-dot"
      : state === "connected" || state === "offline"
        ? `connection-dot ${state}`
        : `session-dot ${state}`;
  const classes = className ? `${face} ${className}` : face;
  return label ? (
    <span className={classes} role="img" aria-label={label} />
  ) : (
    <span className={classes} aria-hidden="true" />
  );
}
