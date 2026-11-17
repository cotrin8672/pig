import { useT } from "../../mainview/i18n";
import { ResponseFooter, usageTip } from "../../mainview/ResponseFooter";
import { useStore } from "../../mainview/store";
import {
  TooltipBody,
  TooltipLayer,
  tooltipClass,
} from "../../mainview/Tooltip";
import type { ResponseStats } from "../../shared/transcript";
import { stats } from "../proposals/data";
import "../tooltips/tooltips.css";
import "../composer/context-meter.css";

export const usages: Record<string, ResponseStats> = {
  通常: stats,
  キャッシュなし: {
    ...stats,
    totalTokens: 19_720,
    input: 18_900,
    output: 820,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 1,
    tokensPerSecond: 64,
    cost: 0.0612,
  },
  "速度・料金不明": {
    ...stats,
    totalTokens: 35_740,
    input: 4_200,
    output: 540,
    cacheRead: 31_000,
    cacheWrite: 0,
    requests: 2,
    tokensPerSecond: undefined,
    cost: 0,
  },
};

/** Every fixture with the shipped Tooltip statically open. */
export function FooterTokenStates() {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  return (
    <div className="cm-row">
      {Object.entries(usages).map(([name, u]) => {
        const content = usageTip(u, t, language);
        return (
          <figure key={name}>
            <figcaption>{name}</figcaption>
            <div className="cm-cell">
              <div className={`${tooltipClass(content.tier)} cm-static`}>
                <TooltipBody content={content} />
              </div>
            </div>
          </figure>
        );
      })}
    </div>
  );
}

export type FooterTokenArgs = { state: keyof typeof usages };

/** Shipped response footer; hover the speed/total chip. */
export function FooterTokenHover({ state }: FooterTokenArgs) {
  return (
    <TooltipLayer>
      <div className="cm-composer">
        <ResponseFooter
          sessionId="preview"
          canRegenerate={false}
          stats={usages[state]}
        />
      </div>
    </TooltipLayer>
  );
}
