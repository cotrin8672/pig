import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type Refresh = ModelRuntime["refresh"];
type Result = Awaited<ReturnType<Refresh>>;

/** SDK registration requests a full offline refresh for each provider. Batch only
 * those identical requests, per runtime; explicit network/scoped/cancellable
 * refreshes keep their options and wait for older registration work, so a late
 * offline pass cannot overwrite freshly fetched catalogs. No credentials are cached. */
export function coalesceModelRefresh(runtime: Pick<ModelRuntime, "refresh">) {
  const refresh = runtime.refresh.bind(runtime);
  let pending:
    | {
        promise: Promise<Result>;
        resolve: (result: Result) => void;
        reject: (error: unknown) => void;
        revision: number;
      }
    | undefined;
  const schedule = () => setTimeout(run, 0);
  async function run() {
    const batch = pending;
    if (!batch) return;
    const revision = batch.revision;
    try {
      const result = await refresh({ allowNetwork: false });
      // Registration during a running pass must be observed by a later pass.
      if (revision !== batch.revision) schedule();
      else {
        pending = undefined;
        batch.resolve(result);
      }
    } catch (error) {
      pending = undefined;
      batch.reject(error);
    }
  }
  runtime.refresh = (options) => {
    if (options?.allowNetwork !== false || Object.keys(options).length !== 1)
      return pending
        ? pending.promise.then(() => refresh(options))
        : refresh(options);
    if (pending) {
      pending.revision++;
      return pending.promise;
    }
    const deferred = Promise.withResolvers<Result>();
    pending = { ...deferred, revision: 0 };
    schedule();
    return pending.promise;
  };
}
