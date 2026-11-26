import "./count-badge.css";

export function CountBadge({
  count,
  decorative,
}: {
  count: number;
  decorative?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span className="notification-badge" aria-hidden={decorative}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
