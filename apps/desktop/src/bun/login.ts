import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { AuthMethod, LoginFrame } from "../shared/rpc-schema";
import { authOperations } from "./auth-operations";
import { deviceId } from "./desktop-config";
import { refreshModels, runtime } from "./pi-service";

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
  push: (frame: LoginFrame) => void,
  open: (url: string) => void,
) {
  const auth =
    typeof provider === "string"
      ? runtime.getProvider(provider)?.auth
      : undefined;
  if (!auth || (method === "oauth" ? !auth.oauth : !auth.apiKey?.login)) {
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
      if (event.type === "auth_url") open(event.url);
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
    await authOperations.login(provider, login.abort, async () => {
      const id = await deviceId();
      await runtime.login(provider, method, interaction, {
        getDeviceId: () => id,
        agentName: "pig",
      });
      await refreshModels({
        providers: [provider],
        signal: login.abort.signal,
      });
      login.abort.signal.throwIfAborted();
    });
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
export function logoutProvider(provider: string) {
  return authOperations.logout(provider, async () => {
    await runtime.logout(provider);
    await refreshModels({ providers: [provider], allowNetwork: false });
  });
}
