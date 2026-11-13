import { createHash } from "node:crypto";
import {
  type Credential,
  createModels,
  InMemoryCredentialStore,
  type Provider,
} from "@earendil-works/pi-ai";
import { usageKey } from "../../shared/provider-usage";
import { isExtensionProvider, runtimeAccounts } from "../model-runtime";
import { providerName, runtime } from "../pi-service";
import { AccountCredentials, providerAccounts } from "../provider-accounts";
import { approvedOrigin, httpAdapters } from "./adapters";
import { authenticatedUsageRead } from "./authenticated";
import { runUsageCommand, usageCommands } from "./cli";
import { type UsageAuth, UsageError, type UsageTarget } from "./contracts";
import { usageHttp } from "./http";
import { type UsageObservation, usageFromHeaders } from "./observation";
import type { UsageService } from "./service";

const http = usageHttp();
const ids = new WeakMap<Provider, number>();
let sequence = 0;
const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex");
function registration(provider: Provider) {
  if (!ids.has(provider)) ids.set(provider, ++sequence);
  return ids.get(provider);
}
function token(auth: {
  apiKey?: string;
  headers?: Record<string, string | null | undefined>;
}) {
  if (auth.apiKey) return auth.apiKey;
  const header = Object.entries(auth.headers ?? {}).find(
    ([key]) => key.toLowerCase() === "authorization",
  )?.[1];
  return header?.replace(/^Bearer\s+/i, "");
}
function accountId(credential: Credential | undefined) {
  if (credential?.type !== "oauth") return undefined;
  return typeof credential.accountId === "string"
    ? credential.accountId
    : undefined;
}

/** Glue only: SDK/account ownership stays here, not in adapters or the polling service. */
export async function discoverUsageTargets(
  signal: AbortSignal,
): Promise<UsageTarget[]> {
  const targets: UsageTarget[] = [];
  const [saved, labels] = await Promise.all([
    providerAccounts.list({ signal }),
    providerAccounts.defaultNames(),
  ]);
  for (const adapter of httpAdapters) {
    signal.throwIfAborted();
    const definition = runtime.getProvider(adapter.provider);
    if (!definition || isExtensionProvider(runtime, adapter.provider)) continue;
    const model = runtime.getModels(adapter.provider)[0];
    if (!approvedOrigin(adapter, model?.baseUrl ?? definition.baseUrl))
      continue;
    const defaults = runtimeAccounts(runtime);
    const rows: { id?: string; label: string }[] = [];
    if (
      await runtime
        .checkAuth(adapter.provider, { signal })
        .catch(() => undefined)
    )
      rows.push({
        label: labels[adapter.provider] ?? providerName(adapter.provider),
      });
    for (const account of saved.filter(
      (a) => a.provider === adapter.provider && a.configured,
    ))
      rows.push({ id: account.id, label: account.label });
    for (const row of rows) {
      const credentials = row.id
        ? new AccountCredentials(
            new InMemoryCredentialStore(),
            providerAccounts,
            { [adapter.provider]: row.id },
          )
        : defaults;
      const stored = await credentials.read(adapter.provider, { signal });
      if (
        adapter.kind &&
        (stored?.type === "oauth" ? "oauth" : "api-key") !== adapter.kind
      )
        continue;
      // Enterprise Copilot credentials must never be silently sent to public GitHub.
      if (
        adapter.provider === "github-copilot" &&
        stored?.type === "oauth" &&
        stored.enterpriseUrl
      )
        continue;
      const scoped = row.id ? createModels({ credentials }) : undefined;
      scoped?.setProvider(definition);
      const getAuth = async (force: boolean, requestSignal: AbortSignal) => {
        const overrides = {
          signal: requestSignal,
          ...(force ? { minOAuthValidityMs: Number.MAX_SAFE_INTEGER } : {}),
        };
        return scoped
          ? scoped.getAuth(adapter.provider, overrides)
          : runtime.getAuth(model ?? adapter.provider, overrides);
      };
      const ownerRevision = async (requestSignal: AbortSignal) => {
        const owner = await credentials.read(adapter.provider, {
          signal: requestSignal,
        });
        return fingerprint(
          owner ?? (await getAuth(false, requestSignal))?.auth,
        );
      };
      const initialOwner = await ownerRevision(signal);
      targets.push({
        key: usageKey(adapter.provider, row.id),
        provider: adapter.provider,
        label: row.label,
        accountId: row.id,
        source: "api",
        revision: `${registration(definition)}:${initialOwner}`,
        read: authenticatedUsageRead(
          adapter,
          http,
          {
            current: () => runtime.getProvider(adapter.provider) === definition,
            revision: ownerRevision,
            resolve: async (force, requestSignal) => {
              const resolved = await getAuth(force, requestSignal);
              const secret = resolved && token(resolved.auth);
              if (
                !resolved ||
                !secret ||
                (resolved.auth.baseUrl &&
                  !approvedOrigin(adapter, resolved.auth.baseUrl))
              )
                throw new UsageError("auth");
              const owner = await credentials.read(adapter.provider, {
                signal: requestSignal,
              });
              if (
                (stored && !owner) ||
                (owner?.type === "oauth" && owner.access !== secret) ||
                (owner?.type === "api_key" && owner.key && owner.key !== secret)
              )
                throw new UsageError("auth");
              const auth: UsageAuth = {
                token: secret,
                kind: owner?.type === "oauth" ? "oauth" : "api-key",
                accountId: accountId(owner),
                githubToken:
                  owner?.type === "oauth" ? owner.refresh : undefined,
              };
              return { auth, revision: fingerprint(owner ?? resolved.auth) };
            },
          },
          initialOwner,
        ),
      });
    }
  }
  // CLI identities remain separate from pig accounts. Discover once per cycle, never per render.
  for (const spec of usageCommands) {
    const path = Bun.which(spec.command);
    if (!path) continue;
    targets.push({
      key: usageKey(spec.provider, `cli:${spec.command}`),
      provider: spec.provider,
      label: spec.label,
      source: "cli",
      revision: path,
      intervalMs: 300_000,
      read: async (requestSignal) =>
        spec.parse(await runUsageCommand(path, spec.args, requestSignal)),
    });
  }
  return targets;
}

/** Accept a response only while the exact credential used by that request is still owned. */
export async function receiveUsageObservation(
  service: UsageService,
  event: UsageObservation,
) {
  if (!event.token) return;
  const credential = event.accountId
    ? await providerAccounts.read(event.accountId, event.provider)
    : await runtimeAccounts(runtime).read(event.provider);
  if (credential?.type !== "oauth" || credential.access !== event.token) return;
  const definition = runtime.getProvider(event.provider);
  if (!definition) return;
  service.observe(
    usageKey(event.provider, event.accountId),
    usageFromHeaders(event.provider, event.response.headers, Date.now()),
    `${registration(definition)}:${fingerprint(credential)}`,
  );
}
