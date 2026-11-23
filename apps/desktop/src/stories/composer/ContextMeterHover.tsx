import { ArrowUp } from "lucide-react";
import { ContextIndicator } from "../../mainview/ContextIndicator";
import { TooltipLayer } from "../../mainview/Tooltip";
import { type HoverArgs, states } from "./context-meter-fixtures";

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
