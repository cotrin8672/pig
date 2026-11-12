import type { AccountTarget } from "../shared/provider-accounts";
import type { AuthMethod } from "../shared/rpc-schema";
import { rpc } from "./rpc";
import { useStore } from "./store";

/** All entry points use the existing root OAuthLoginDialog. No account is created yet. */
export function startProviderLogin(
  target: AccountTarget & { addAccount?: boolean },
  method: AuthMethod = "oauth",
) {
  const previous = useStore.getState().login;
  if (previous) rpc.send.cancelLogin({ loginId: previous.loginId });
  const login = { ...target, method, loginId: crypto.randomUUID() };
  useStore.setState({ login });
  rpc.send.startLogin(login);
}
