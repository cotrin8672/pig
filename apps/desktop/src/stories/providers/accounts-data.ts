/** Preview fixtures. Provider stays canonical; an account is only a label + credential. */
export type AccountState = "online" | "signed-out";
export type Account = {
  key: string;
  provider: string;
  providerName: string;
  label: string;
  /** pi's standard auth.json credential, shared with the pi CLI. */
  standard?: true;
  state: AccountState;
};
export type PreviewModel = {
  provider: string;
  id: string;
  name: string;
  context: number;
  reasoning?: true;
  vision?: true;
};

export const accounts: Account[] = [
  {
    key: "codex",
    provider: "openai-codex",
    providerName: "OpenAI Codex",
    label: "Codex Private",
    standard: true,
    state: "online",
  },
  {
    key: "codex-work",
    provider: "openai-codex",
    providerName: "OpenAI Codex",
    label: "Codex Work",
    state: "online",
  },
  {
    key: "claude",
    provider: "anthropic",
    providerName: "Anthropic",
    label: "Claude Private",
    standard: true,
    state: "online",
  },
  {
    key: "claude-work",
    provider: "anthropic",
    providerName: "Anthropic",
    label: "Claude Work",
    state: "signed-out",
  },
  {
    key: "mistral",
    provider: "mistral",
    providerName: "Mistral",
    label: "Mistral",
    standard: true,
    state: "online",
  },
];
/** Providers without a subscription sign-in keep today's single-entry behaviour. */
export const otherProviders = [
  { id: "openrouter", name: "OpenRouter" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "google", name: "Google Gemini" },
];

export const models: PreviewModel[] = [
  {
    provider: "openai-codex",
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    context: 500_000,
    reasoning: true,
    vision: true,
  },
  {
    provider: "openai-codex",
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    context: 500_000,
    reasoning: true,
    vision: true,
  },
  {
    provider: "openai-codex",
    id: "gpt-6-codex",
    name: "GPT-6 Codex",
    context: 400_000,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-opus-5.5",
    name: "Claude Opus 5.5",
    context: 1_000_000,
    reasoning: true,
    vision: true,
  },
  {
    provider: "anthropic",
    id: "claude-fable-5.2",
    name: "Claude Fable 5.2",
    context: 1_000_000,
    reasoning: true,
    vision: true,
  },
  {
    provider: "mistral",
    id: "devstral-3",
    name: "Devstral 3",
    context: 256_000,
  },
];

export const accountsOf = (provider: string) =>
  accounts.filter((a) => a.provider === provider);
export const modelsOf = (account: Account) =>
  models.filter((m) => m.provider === account.provider);
/** The account suffix is only needed when a Provider has several entries. */
export const needsAccountLabel = (account: Account) =>
  accountsOf(account.provider).length > 1;
export const shortLabel = (account: Account) =>
  needsAccountLabel(account)
    ? account.label
        .replace(`${account.providerName} `, "")
        .replace(/^(Codex|Claude)\s+/, "")
    : undefined;
export type Choice = { account: Account; model: PreviewModel };
export const choiceKey = ({ account, model }: Choice) =>
  `${account.key}/${model.id}`;
