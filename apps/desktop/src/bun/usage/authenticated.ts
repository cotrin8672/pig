import type { UsageData } from "../../shared/provider-usage";
import type { HttpUsageAdapter } from "./adapters";
import { type UsageAuth, UsageError, type UsageHttp } from "./contracts";

/** SDK-independent boundary: token refresh/persistence remains owned by the supplied resolver. */
export interface UsageCredentials {
  revision(signal: AbortSignal): Promise<string>;
  resolve(
    forceRefresh: boolean,
    signal: AbortSignal,
  ): Promise<{ auth: UsageAuth; revision: string }>;
  current(): boolean;
}
export function authenticatedUsageRead(
  adapter: HttpUsageAdapter,
  http: UsageHttp,
  credentials: UsageCredentials,
  initialRevision: string,
) {
  return async (signal: AbortSignal): Promise<UsageData> => {
    let expected = initialRevision;
    const check = async () => {
      signal.throwIfAborted();
      if (
        !credentials.current() ||
        (await credentials.revision(signal)) !== expected
      )
        throw new UsageError("auth");
    };
    await check();
    let resolved = await credentials.resolve(false, signal);
    expected = resolved.revision; // The owning SDK may have refreshed under its lock.
    await check();
    let data: UsageData;
    try {
      data = await adapter.read(resolved.auth, http, signal);
    } catch (error) {
      if (
        !(error instanceof UsageError) ||
        error.code !== "auth" ||
        resolved.auth.kind !== "oauth"
      )
        throw error;
      await check(); // Never refresh a credential that was removed/replaced during the request.
      resolved = await credentials.resolve(true, signal);
      expected = resolved.revision;
      await check();
      data = await adapter.read(resolved.auth, http, signal); // Exactly one replay.
    }
    await check();
    return data;
  };
}
