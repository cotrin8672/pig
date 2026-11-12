import icon from "../../assets/icon.png";

export const designData = {
  answer:
    '### Findings\n\nThe **greeting** module exports one value:\n\n```ts\nexport const greeting = "Hello, world!";\n```\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |\n\nInline math: $a^2 + b^2 = c^2$.',
  request: "Show me where the greeting is defined.",
  reasoning: "First, look for the **greeting** export.",
  images: [icon, new URL("../../assets/icon.svg", import.meta.url).href],
  record: { file: "src/greeting.ts", status: "reviewed" },
  annotations: [
    {
      quote: 'export const greeting = "Hello, world!";',
      comment: "Keep this export name — the docs reference it.",
    },
    {
      quote:
        "The greeting module exports one value, and every caller in the workspace reads it from the barrel file rather than the source module, so renaming the export means touching the barrel too.",
      comment:
        "This sentence is doing too much. Split it, and name the barrel file instead of saying “the barrel”.",
    },
    { quote: "All checks passed.", comment: "" },
  ],
  stats: {
    stopReason: "stop" as const,
    durationMs: 5700,
    endedAt: Date.UTC(2026, 0, 1, 12),
    timestamp: Date.UTC(2026, 0, 1, 12),
    tools: 2,
    totalTokens: 340,
    tokensPerSecond: 42,
    model: "Preview model",
    text: "All checks passed.",
  },
};
