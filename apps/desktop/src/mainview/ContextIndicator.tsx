import { contextSummary } from "../shared/context";
import type { ContextUsage } from "../shared/rpc-schema";
import { ContextMeter } from "./ContextMeter";
import { useStore } from "./store";

export function ContextIndicator({ usage }: { usage?: ContextUsage | null }) {
  const { contextDisplay, language } = useStore((s) => s.settings);
  return (
    <ContextMeter
      summary={contextSummary(usage, contextDisplay, language)}
      mode={contextDisplay}
    />
  );
}
