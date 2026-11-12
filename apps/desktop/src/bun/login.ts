import type { AuthInteraction } from "@earendil-works/pi-ai";
import {
  validateAccountId,
  validateProviderId,
} from "../shared/provider-accounts";
import type { AuthMethod, LoginFrame } from "../shared/rpc-schema";
import { authOperations } from "./auth-operations";
import { deviceId } from "./desktop-config";
import { refreshModels, runtime } from "./pi-service";
import { providerAccounts } from "./provider-accounts";

function authKey(provider: string, accountId?: string) {
  validateProviderId(provider);
  if (accountId !== undefined) validateAccountId(accountId);
  return JSON.stringify([provider, accountId ?? null]);
}
export function createProviderAccount(provider: string, label: string) {
  validateProviderId(provider);
  if (!runtime.getProvider(provider)?.auth.oauth?.isSubscription)
    throw new Error("Only subscription accounts are supported.");
  return providerAccounts.create(provider, label);
}
export function renameProviderAccount(
  provider: string,
  accountId: string,
  label: string,
) {
  return providerAccounts.rename(accountId, provider, label);
}
export function removeProviderAccount(provider: string, accountId: string) {
  return authOperations.logout(
    authKey(provider, accountId),
    async () => {
      await providerAccounts.remove(accountId, provider);
      await refreshModels({ providers: [provider], allowNetwork: false });
    },
    provider,
  );
}

const logins = new Map<
  string,
  { abort: AbortController; resolve?: (value: string | undefined) => void }
>();
export function cancelLogin(loginId: string) {
  const login = logins.get(loginId);
  login?.abort.abort();
  login?.resolve?.(undefined);
}
export function resolveLogin(loginId: string, value: string) {
  logins.get(loginId)?.resolve?.(value);
}
export function cancelAllLogins() {
  for (const id of logins.keys()) cancelLogin(id);
}
export async function startLogin(
  provider: string,
  method: AuthMethod,
  loginId: string,
  emit: (frame: LoginFrame) => void,
  /** false/throw when the OS refused the URL; true only means it was handed off. */
  open: (url: string) => boolean,
  accountId?: string,
) {
  const push = (frame: LoginFrame) =>
    emit({ ...frame, ...(accountId !== undefined ? { accountId } : {}) });
  if (
    typeof loginId !== "string" ||
    !loginId ||
    loginId.length > 128 ||
    logins.has(loginId)
  ) {
    push({
      loginId,
      provider,
      kind: "error",
      message: "Invalid or duplicate login ID.",
    });
    return;
  }
  const auth =
    typeof provider === "string"
      ? runtime.getProvider(provider)?.auth
      : undefined;
  if (
    !auth ||
    (method !== "oauth" && method !== "api_key") ||
    (method === "oauth" ? !auth.oauth : !auth.apiKey?.login) ||
    (accountId !== undefined &&
      (method !== "oauth" || !auth.oauth?.isSubscription))
  ) {
    push({
      loginId,
      provider: String(provider),
      kind: "error",
      message: "This provider does not support that sign-in method.",
    });
    return;
  }
  const login: {
    abort: AbortController;
    resolve?: (value: string | undefined) => void;
  } = { abort: new AbortController() };
  logins.set(loginId, login);
  const interaction: AuthInteraction = {
    signal: login.abort.signal,
    notify(event) {
      push({ loginId, provider, kind: "event", event });
      if (event.type !== "auth_url") return;
      let opened = false;
      try {
        opened = open(event.url);
      } catch (error) {
        console.error("Opening sign-in URL failed:", error);
      }
      push({ loginId, provider, kind: "browser", opened });
    },
    prompt: ({ signal, ...prompt }) =>
      new Promise<string>((resolve, reject) => {
        const settle = (value: string | undefined) => {
          login.resolve = undefined;
          signal?.removeEventListener("abort", abort);
          login.abort.signal.removeEventListener("abort", abort);
          push({ loginId, provider, kind: "promptEnd" });
          if (value === undefined) reject(new Error("Login cancelled"));
          else resolve(value);
        };
        const abort = () => settle(undefined);
        login.resolve = settle;
        signal?.addEventListener("abort", abort, { once: true });
        login.abort.signal.addEventListener("abort", abort, { once: true });
        push({ loginId, provider, kind: "prompt", prompt });
        if (signal?.aborted || login.abort.signal.aborted) abort();
      }),
  };
  try {
    await authOperations.login(
      authKey(provider, accountId),
      login.abort,
      async () => {
        if (accountId !== undefined)
          await providerAccounts.read(accountId, provider, {
            signal: login.abort.signal,
          });
        const id = await deviceId();
        const options = { getDeviceId: () => id, agentName: "pig" };
        if (accountId === undefined) {
          await runtime.login(provider, method, interaction, options);
        } else {
          if (!auth.oauth)
            throw new Error("Subscription login is unavailable.");
          const credential = await auth.oauth.login(
            { ...interaction, signal: login.abort.signal },
            options,
          );
          login.abort.signal.throwIfAborted();
          await providerAccounts.modify(
            accountId,
            provider,
            async () => credential,
            { signal: login.abort.signal },
          );
        }
        await refreshModels({
          providers: [provider],
          signal: login.abort.signal,
        });
        login.abort.signal.throwIfAborted();
      },
      provider,
    );
    push({ loginId, provider, kind: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push(
      login.abort.signal.aborted || message === "Login cancelled"
        ? { loginId, provider, kind: "cancelled" }
        : { loginId, provider, kind: "error", message },
    );
  } finally {
    logins.delete(loginId);
  }
}
export function logoutProvider(provider: string, accountId?: string) {
  return authOperations.logout(
    authKey(provider, accountId),
    async () => {
      if (accountId === undefined) await runtime.logout(provider);
      else await providerAccounts.logout(accountId, provider);
      await refreshModels({ providers: [provider], allowNetwork: false });
    },
    provider,
  );
}
