import { ContextMeter, contextTip } from "../../mainview/ContextMeter";
import { useStore } from "../../mainview/store";
import { TooltipBody, tooltipClass } from "../../mainview/Tooltip";
import { contextSummary } from "../../shared/context";
import { states } from "./context-meter-fixtures";

export function ContextMeterStates() {
  const language = useStore((s) => s.settings.language);
  return (
    <div className="cm-row">
      {Object.entries(states).flatMap(([name, usage]) =>
        (["used", "remaining"] as const).map((mode) => {
          const summary = contextSummary(usage, mode, language);
          const content = contextTip(summary);
          return (
            <figure key={`${name}-${mode}`}>
              <figcaption>
                {name} · {mode === "used" ? "使用済み" : "残り"}
              </figcaption>
              <div className="cm-cell">
                <div className={`${tooltipClass(content.tier)} cm-static`}>
                  <TooltipBody content={content} />
                </div>
                <ContextMeter summary={summary} mode={mode} />
              </div>
            </figure>
          );
        }),
      )}
    </div>
  );
}
