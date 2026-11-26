import { contextSummary } from "../shared/context";
import type { ContextUsage } from "../shared/rpc-schema";
import { ContextMeter } from "./ContextMeter";
import { useStore } from "./store";
import type { TipContent } from "./Tooltip";

export function ContextIndicator({
  usage,
  action,
}: {
  usage?: ContextUsage | null;
  action?: TipContent["action"];
}) {
  const { contextDisplay, language } = useStore((s) => s.settings);
  return (
    <ContextMeter
      summary={contextSummary(usage, contextDisplay, language)}
      mode={contextDisplay}
      action={action}
    />
  );
}
