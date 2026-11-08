import type { AuthInteraction } from "@earendil-works/pi-ai";
import {
  type LoginFrame,
  type ProviderId,
  providers,
} from "../shared/rpc-schema";
import { runtime } from "./pi-service";

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
  provider: ProviderId,
  loginId: string,
  push: (frame: LoginFrame) => void,
  open: (url: string) => void,
) {
  if (!providers.some((p) => p.id === provider))
    throw new Error("Invalid provider.");
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
    await runtime.login(provider, "oauth", interaction);
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
