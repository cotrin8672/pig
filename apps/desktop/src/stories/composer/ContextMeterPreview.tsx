import { ArrowUp } from "lucide-react";
import { ContextIndicator, contextTip } from "../../mainview/ContextIndicator";
import { useStore } from "../../mainview/store";
import {
  TooltipBody,
  TooltipLayer,
  tooltipClass,
} from "../../mainview/Tooltip";
import { contextSummary } from "../../shared/context";
import type { ContextUsage } from "../../shared/rpc-schema";
import "../tooltips/tooltips.css";
import "./model-trigger.css";
import "./context-meter.css";

/** Context ring + its hover Tooltip (shipped ContextIndicator). */
export const states: Record<string, ContextUsage | null> = {
  通常: { tokens: 42_300, contextWindow: 200_000, percent: null },
  逼迫: { tokens: 184_000, contextWindow: 200_000, percent: null },
  不明: null,
};

/** Every state with its Tooltip statically open above the ring. */
export function ContextMeterStates() {
  const { contextDisplay, language } = useStore((s) => s.settings);
  return (
    <div className="cm-row">
      {Object.entries(states).map(([name, usage]) => {
        const content = contextTip(
          contextSummary(usage, contextDisplay, language),
        );
        return (
          <figure key={name}>
            <figcaption>{name}</figcaption>
            <div className="cm-cell">
              <div className={`${tooltipClass(content.tier)} cm-static`}>
                <TooltipBody content={content} />
              </div>
              <ContextIndicator usage={usage} />
            </div>
          </figure>
        );
      })}
    </div>
  );
}

export type HoverArgs = { state: keyof typeof states };

/** Composer shell with the shipped ring; hover it. */
export function ContextMeterHover({ state }: HoverArgs) {
  return (
    <TooltipLayer>
      <div className="composer cm-composer">
        <div className="mt-text">メッセージを入力…</div>
        <div className="composer-toolbar">
          <div className="composer-pickers">
            <ContextIndicator usage={states[state]} />
          </div>
          <div className="send-controls">
            <button type="button" className="send-button" aria-label="送信">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </TooltipLayer>
  );
}
