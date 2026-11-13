import { useEffect, useState } from "react";
import { ProviderUsageView } from "./ProviderUsageView";
import { rpc } from "./rpc";
import { useStore } from "./store";

/** Subscription lifecycle only; all scheduling and acquisition live in the Host. */
export function ProviderUsage() {
  const entries = useStore((s) => s.providerUsage);
  const display = useStore((s) => s.settings.usageDisplay);
  const initialized = useStore((s) => s.initialized);
  const host = useStore((s) => s.hostId);
  const [now, setNow] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!initialized || !host) return;
    let live = true;
    const before = useStore.getState().providerUsage;
    void rpc.request
      .providerUsage()
      .then((providerUsage) => {
        if (live && useStore.getState().providerUsage === before)
          useStore.setState({ providerUsage });
      })
      .catch(() => {});
    const visibility = () => rpc.send.usageActive({ active: !document.hidden });
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", visibility);
      rpc.send.usageActive({ active: false });
    };
  }, [initialized, host]);
  useEffect(() => {
    if (!entries.length) return;
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [entries.length]);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await rpc.request.refreshProviderUsage();
    } catch {
      /* Usage is best-effort; the host publishes safe per-source errors. */
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <ProviderUsageView
      entries={entries}
      display={display}
      now={now}
      refreshing={refreshing}
      onRefresh={() => {
        void refresh();
      }}
    />
  );
}
