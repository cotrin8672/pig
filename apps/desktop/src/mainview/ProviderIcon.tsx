import Azure from "@lobehub/icons/es/Azure/components/Color.js";
import Baseten from "@lobehub/icons/es/Baseten/components/Mono.js";
import Bedrock from "@lobehub/icons/es/Bedrock/components/Color.js";
import Cerebras from "@lobehub/icons/es/Cerebras/components/Color.js";
import Claude from "@lobehub/icons/es/Claude/components/Color.js";
import Cloudflare from "@lobehub/icons/es/Cloudflare/components/Color.js";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Color.js";
import Fireworks from "@lobehub/icons/es/Fireworks/components/Color.js";
import GithubCopilot from "@lobehub/icons/es/GithubCopilot/components/Mono.js";
import Google from "@lobehub/icons/es/Google/components/Color.js";
import Groq from "@lobehub/icons/es/Groq/components/Mono.js";
import HuggingFace from "@lobehub/icons/es/HuggingFace/components/Color.js";
import Kimi from "@lobehub/icons/es/Kimi/components/Color.js";
import AntLing from "@lobehub/icons/es/Ling/components/Color.js";
import Meta from "@lobehub/icons/es/Meta/components/Color.js";
import Minimax from "@lobehub/icons/es/Minimax/components/Color.js";
import Mistral from "@lobehub/icons/es/Mistral/components/Color.js";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono.js";
import Nvidia from "@lobehub/icons/es/Nvidia/components/Color.js";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono.js";
import OpenCode from "@lobehub/icons/es/OpenCode/components/Mono.js";
import OpenRouter from "@lobehub/icons/es/OpenRouter/components/Mono.js";
import Qwen from "@lobehub/icons/es/Qwen/components/Color.js";
import Together from "@lobehub/icons/es/Together/components/Color.js";
import TypeSafe from "@lobehub/icons/es/TypeSafeAI/components/Mono.js";
import Vercel from "@lobehub/icons/es/Vercel/components/Mono.js";
import VertexAI from "@lobehub/icons/es/VertexAI/components/Color.js";
import XAI from "@lobehub/icons/es/XAI/components/Mono.js";
import Xiaomi from "@lobehub/icons/es/XiaomiMiMo/components/Mono.js";
import ZAI from "@lobehub/icons/es/ZAI/components/Mono.js";
import { Box } from "lucide-react";
import { useStore } from "./store";

// Keys match a provider id exactly or as a prefix before "-" (regional/plan variants).
// Order matters: "google-vertex" must precede "google".
const icons: [string, typeof OpenAI][] = [
  ["amazon-bedrock", Bedrock],
  ["ant-ling", AntLing],
  ["anthropic", Claude],
  ["azure", Azure],
  ["baseten", Baseten],
  ["cerebras", Cerebras],
  ["cloudflare", Cloudflare],
  ["deepseek", DeepSeek],
  ["fireworks", Fireworks],
  ["github-copilot", GithubCopilot],
  ["google-vertex", VertexAI],
  ["google", Google],
  ["groq", Groq],
  ["huggingface", HuggingFace],
  ["kimi", Kimi],
  ["meta", Meta],
  ["minimax", Minimax],
  ["mistral", Mistral],
  ["moonshotai", Moonshot],
  ["nvidia", Nvidia],
  ["openai", OpenAI],
  ["opencode", OpenCode],
  ["openrouter", OpenRouter],
  ["qwen", Qwen],
  ["together", Together],
  ["typesafe", TypeSafe],
  ["vercel", Vercel],
  ["xai", XAI],
  ["xiaomi", Xiaomi],
  ["zai", ZAI],
];

export function ProviderIcon({
  provider,
  size = 24,
}: {
  provider: string;
  size?: number;
}) {
  const Icon = icons.find(
    ([key]) => provider === key || provider.startsWith(`${key}-`),
  )?.[1];
  return Icon ? (
    <Icon size={size} aria-hidden="true" />
  ) : (
    <Box size={size} aria-hidden="true" className="provider-fallback-icon" />
  );
}

export function useProviderName(provider: string) {
  return useStore(
    (s) =>
      s.bootstrap.providers.find((p) => p.id === provider)?.name ?? provider,
  );
}
