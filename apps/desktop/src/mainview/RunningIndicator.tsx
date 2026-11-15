import { memo } from "react";
import { useT } from "./i18n";

export const RunningIndicator = memo(function RunningIndicator({
  symbol,
  message,
}: {
  symbol?: string;
  message?: string;
}) {
  const t = useT();
  return (
    <p className="muted running" role="status">
      {[symbol, message ?? t["Working…"]].filter(Boolean).join(" ")}
    </p>
  );
});
