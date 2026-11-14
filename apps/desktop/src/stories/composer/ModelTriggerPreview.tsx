import { ArrowUp, ChevronDown } from "lucide-react";
import { ContextIndicator } from "../../mainview/ContextIndicator";
import { EffortChip } from "../../mainview/EffortChip";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import { effortLabels } from "../../shared/effort";
import type { Effort } from "../../shared/rpc-schema";
import "./model-trigger.css";

/** Representative level sets from the pi catalog after `effortOptions`. */
export const presets = {
  gpt: {
    label: "GPT-5.4（off〜xhigh, 5段）",
    provider: "openai",
    model: "GPT-5.4",
    levels: ["off", "low", "medium", "high", "xhigh"],
  },
  claude: {
    label: "Claude Opus 5.5（low〜max, 5段）",
    provider: "anthropic",
    model: "Claude Opus 5.5",
    levels: ["low", "medium", "high", "xhigh", "max"],
  },
  deepseek: {
    label: "DeepSeek V4.1 Flash（off / high / max）",
    provider: "deepseek",
    model: "DeepSeek V4.1 Flash",
    levels: ["off", "high", "max"],
  },
  glm: {
    label: "GLM-5.3（low / high / max）",
    provider: "zai",
    model: "GLM-5.3",
    levels: ["low", "high", "max"],
  },
  pair: {
    label: "DeepSeek V4 Pro（high / max）",
    provider: "opencode",
    model: "DeepSeek V4 Pro",
    levels: ["high", "max"],
  },
  full: {
    label: "Claude Haiku 5.5 on Bedrock（全7段）",
    provider: "amazon-bedrock",
    model: "Claude Haiku 5.5",
    levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  },
} satisfies Record<
  string,
  { label: string; provider: string; model: string; levels: Effort[] }
>;
type PresetKey = keyof typeof presets;
export type TriggerArgs = { preset: PresetKey; effort: Effort };

const canonical: Effort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
/** Story controls may choose a level the preset does not offer. */
function clamp(effort: Effort, levels: readonly Effort[]): Effort {
  const at = canonical.indexOf(effort);
  return [...levels].sort(
    (a, b) =>
      Math.abs(canonical.indexOf(a) - at) - Math.abs(canonical.indexOf(b) - at),
  )[0] as Effort;
}

/** Preview shell only; provider, context and effort use the shipped components. */
export function ModelTriggerPreview({ preset, effort }: TriggerArgs) {
  const { provider, model, levels } = presets[preset];
  const value = clamp(effort, levels);
  const title = `${model} / ${effortLabels[value]}`;
  return (
    <div className="composer mt-composer">
      <div className="mt-text">メッセージを入力…</div>
      <div className="composer-toolbar">
        <div className="composer-pickers">
          <ContextIndicator />
          <button
            type="button"
            className="picker-trigger"
            title={title}
            aria-label={title}
          >
            <ProviderIcon provider={provider} size={12} />
            <span className="picker-model-label">{model}</span>
            <EffortChip levels={levels} effort={value} />
            <ChevronDown size={12} />
          </button>
        </div>
        <div className="send-controls">
          <button type="button" className="send-button" aria-label="送信">
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keep all offered levels visible for checking sparse sets and fixed label widths. */
export function EffortLevelsPreview() {
  return (
    <div className="mt-levels">
      {(Object.keys(presets) as PresetKey[]).map((key) => (
        <section key={key}>
          <h3>{presets[key].label}</h3>
          <div className="mt-level-row">
            {presets[key].levels.map((level) => (
              <span key={level} className="mt-cell" title={effortLabels[level]}>
                <EffortChip levels={presets[key].levels} effort={level} />
                <span className="sr-only">{effortLabels[level]}</span>
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
