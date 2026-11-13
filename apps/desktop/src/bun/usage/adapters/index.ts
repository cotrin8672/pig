import type { UsageData } from "../../../shared/provider-usage";
import {
  nonempty,
  object,
  type UsageAuth,
  UsageError,
  type UsageHttp,
} from "../contracts";
import {
  deepseekUsage,
  minimaxUsage,
  moonshotUsage,
  openrouterUsage,
  radiusBalance,
  vercelUsage,
  zaiUsage,
} from "./balances";
import {
  claudeUsage,
  codexUsage,
  copilotUsage,
  goUsage,
  kimiUsage,
  mistralUsage,
} from "./subscriptions";

export interface HttpUsageAdapter {
  provider: string;
  origins: readonly string[];
  kind?: UsageAuth["kind"];
  read(
    auth: UsageAuth,
    http: UsageHttp,
    signal: AbortSignal,
  ): Promise<UsageData>;
}
function endpoint(
  provider: string,
  origin: string,
  path: string,
  parse: (value: unknown) => UsageData,
  kind?: UsageAuth["kind"],
): HttpUsageAdapter {
  return {
    provider,
    origins: [origin],
    kind,
    async read(auth, http, signal) {
      if (kind && auth.kind !== kind) throw new UsageError("unavailable");
      return nonempty(
        parse(
          await http.get(
            origin + path,
            { Authorization: `Bearer ${auth.token}` },
            signal,
          ),
        ),
      );
    },
  };
}
export const httpAdapters: readonly HttpUsageAdapter[] = [
  {
    ...endpoint(
      "openai-codex",
      "https://chatgpt.com",
      "/backend-api/wham/usage",
      codexUsage,
      "oauth",
    ),
    async read(auth, http, signal) {
      if (auth.kind !== "oauth" || !auth.accountId)
        throw new UsageError("auth");
      return nonempty(
        codexUsage(
          await http.get(
            "https://chatgpt.com/backend-api/wham/usage",
            {
              Authorization: `Bearer ${auth.token}`,
              "ChatGPT-Account-Id": auth.accountId,
            },
            signal,
          ),
        ),
      );
    },
  },
  {
    ...endpoint(
      "anthropic",
      "https://api.anthropic.com",
      "/api/oauth/usage",
      claudeUsage,
      "oauth",
    ),
    async read(auth, http, signal) {
      if (auth.kind !== "oauth") throw new UsageError("unavailable");
      return nonempty(
        claudeUsage(
          await http.get(
            "https://api.anthropic.com/api/oauth/usage",
            {
              Authorization: `Bearer ${auth.token}`,
              "anthropic-beta": "oauth-2025-04-20",
            },
            signal,
          ),
        ),
      );
    },
  },
  endpoint(
    "mistral",
    "https://api.mistral.ai",
    "/v1/billing/budget",
    mistralUsage,
  ),
  endpoint(
    "deepseek",
    "https://api.deepseek.com",
    "/user/balance",
    deepseekUsage,
  ),
  endpoint(
    "moonshotai",
    "https://api.moonshot.ai",
    "/v1/users/me/balance",
    (v) => moonshotUsage(v, "USD"),
  ),
  endpoint(
    "moonshotai-cn",
    "https://api.moonshot.cn",
    "/v1/users/me/balance",
    (v) => moonshotUsage(v, "CNY"),
  ),
  endpoint(
    "vercel-ai-gateway",
    "https://ai-gateway.vercel.sh",
    "/v1/credits",
    vercelUsage,
  ),
  endpoint(
    "openrouter",
    "https://openrouter.ai",
    "/api/v1/key",
    openrouterUsage,
  ),
  ...(
    [
      ["minimax", "https://api.minimax.io", "USD"],
      ["minimax-cn", "https://api.minimaxi.com", "CNY"],
    ] as const
  ).map(
    ([provider, origin, currency]): HttpUsageAdapter => ({
      provider,
      origins: [origin],
      async read(auth, http, signal) {
        const path = auth.token.startsWith("sk-api-")
          ? "/account/query_balance"
          : "/v1/token_plan/remains";
        return nonempty(
          minimaxUsage(
            await http.get(
              origin + path,
              { Authorization: `Bearer ${auth.token}` },
              signal,
            ),
            currency,
          ),
        );
      },
    }),
  ),
  ...(
    [
      ["zai", "https://api.z.ai"],
      ["zai-coding-cn", "https://open.bigmodel.cn"],
    ] as const
  ).map(
    ([provider, origin]): HttpUsageAdapter => ({
      provider,
      origins: [origin],
      async read(auth, http, signal) {
        return nonempty(
          zaiUsage(
            await http.get(
              `${origin}/api/monitor/usage/quota/limit`,
              { Authorization: auth.token },
              signal,
            ),
          ),
        );
      },
    }),
  ),
  endpoint(
    "kimi-coding",
    "https://api.kimi.com",
    "/coding/v1/usages",
    kimiUsage,
  ),
  {
    provider: "opencode-go",
    origins: ["https://opencode.ai"],
    async read(auth, http, signal) {
      const headers = { Authorization: `Bearer ${auth.token}` };
      let body: unknown;
      try {
        body = await http.get(
          "https://opencode.ai/inference/go/v1/usage",
          headers,
          signal,
        );
      } catch (error) {
        // Only a missing route permits the same-origin legacy path; never auth/429/schema errors.
        if (!(error instanceof UsageError) || error.code !== "unavailable")
          throw error;
        body = await http.get(
          "https://opencode.ai/zen/go/v1/usage",
          headers,
          signal,
        );
      }
      return nonempty(goUsage(body));
    },
  },
  {
    provider: "github-copilot",
    origins: [
      "https://api.githubcopilot.com",
      "https://api.individual.githubcopilot.com",
      "https://api.business.githubcopilot.com",
      "https://api.enterprise.githubcopilot.com",
    ],
    kind: "oauth",
    async read(auth, http, signal) {
      if (!auth.githubToken) throw new UsageError("auth");
      return nonempty(
        copilotUsage(
          await http.get(
            "https://api.github.com/copilot_internal/user",
            {
              Authorization: `token ${auth.githubToken}`,
              "Editor-Version": "vscode/1.96.2",
              "Editor-Plugin-Version": "copilot-chat/0.26.7",
            },
            signal,
          ),
        ),
      );
    },
  },
  {
    provider: "radius",
    origins: ["https://radius.pi.dev"],
    async read(auth, http, signal) {
      const headers = { Authorization: `Bearer ${auth.token}` };
      const context = object(
        await http.get("https://radius.pi.dev/v1/context", headers, signal),
      );
      const org = object(context.organization).id;
      if (typeof org !== "string" || !org) throw new UsageError("format");
      return nonempty(
        radiusBalance(
          await http.get(
            `https://radius.pi.dev/v1/organizations/${encodeURIComponent(org)}/billing/balance`,
            headers,
            signal,
          ),
        ),
      );
    },
  },
];

/** Never send an unofficial/custom-endpoint credential to a built-in billing service. */
export function approvedOrigin(
  adapter: HttpUsageAdapter,
  baseUrl: string | undefined,
) {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return (
      !url.username && !url.password && adapter.origins.includes(url.origin)
    );
  } catch {
    return false;
  }
}
