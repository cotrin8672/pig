import type { ProviderUsage } from "../../shared/provider-usage";

export const usageFixtureTime = new Date(2026, 10, 12, 14).getTime();
const now = usageFixtureTime;
export const usageFixtures: ProviderUsage[] = [
  {
    key: "codex-work",
    provider: "openai-codex",
    label: "OpenAI Work",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [
        {
          id: "5h",
          label: "5h",
          usedPercent: 88,
          resetsAt: now + 72 * 60_000,
          durationMs: 18_000_000,
        },
        {
          id: "7d",
          label: "7d",
          usedPercent: 36,
          resetsAt: now + 5 * 86400000,
          durationMs: 604800000,
        },
      ],
      balances: [],
      details: ["Reset tickets: 2"],
    },
  },
  {
    key: "mistral",
    provider: "mistral",
    label: "Mistral Vibe",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [
        {
          id: "vibe",
          label: "Vibe",
          usedPercent: 52,
          resetsAt: new Date(2026, 11, 1).getTime(),
          durationMs: 30 * 86400000,
        },
      ],
      balances: [],
    },
  },
  {
    key: "codex-personal",
    provider: "openai-codex",
    label: "OpenAI Personal",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [
        {
          id: "5h",
          label: "5h",
          usedPercent: 9,
          resetsAt: now + 280 * 60000,
          durationMs: 18000000,
        },
        {
          id: "7d",
          label: "7d",
          usedPercent: 23,
          resetsAt: now + 12 * 3600000,
          durationMs: 604800000,
        },
      ],
      balances: [],
    },
  },
  {
    key: "anthropic",
    provider: "anthropic",
    label: "Anthropic",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [{ id: "5h", label: "5h", usedPercent: 23 }],
      balances: [],
    },
  },
  {
    key: "deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [],
      balances: [{ label: "Balance", amount: "3.20", currency: "CNY" }],
    },
  },
  {
    key: "router",
    provider: "openrouter",
    label: "OpenRouter",
    source: "api",
    status: "ready",
    observedAt: now - 60_000,
    data: {
      windows: [],
      balances: [{ label: "Key budget", amount: "12.40", currency: "USD" }],
    },
  },
  {
    key: "qwen",
    provider: "qwen-token-plan",
    label: "Qwen CLI",
    source: "cli",
    status: "error",
    problem: "auth",
  },
  {
    key: "vercel",
    provider: "vercel-ai-gateway",
    label: "Vercel",
    source: "api",
    status: "loading",
  },
];
