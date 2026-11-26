import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import type { McpAppPreviewResult, McpAppRef } from "../shared/mcp-app";
import type { SessionAddress } from "../shared/runtime-contract";
import type { WidgetBlock } from "../shared/widget";
import type { McpWidgetData } from "./InteractiveWidgetFrame";
import { rpc } from "./rpc";
import { WidgetFrame } from "./WidgetFrame";

export const McpAppContext = createContext<SessionAddress | undefined>(
  undefined,
);

/** Stable per epoch, so snapshot updates do not reload frames. */
export function McpAppScope({
  address: { hostId, sessionId, epoch },
  children,
}: {
  address: SessionAddress;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ hostId, sessionId, epoch }),
    [hostId, sessionId, epoch],
  );
  return (
    <McpAppContext.Provider value={value}>{children}</McpAppContext.Provider>
  );
}

/** Scrolling back reuses HTML instead of asking the host again. */
const MAX_CACHED = 32;
const cache = new Map<string, Promise<McpAppPreviewResult>>();
function load(
  address: SessionAddress,
  appId: string,
  toolCallId: string,
  interactive: boolean,
) {
  const key = JSON.stringify([
    address.hostId,
    address.sessionId,
    address.epoch,
    appId,
    toolCallId,
    interactive,
  ]);
  let html = cache.get(key);
  if (!html) {
    html = rpc.request
      .getMcpAppPreview({
        ...address,
        appId,
        toolCallId,
        ...(interactive && { interactive: true }),
      })
      .catch(() => null);
    // Failures are not cached, so Retry asks again.
    const flight = html;
    void flight.then((value) => {
      if (!value && cache.get(key) === flight) cache.delete(key);
    });
  } else cache.delete(key);
  cache.set(key, html);
  while (cache.size > MAX_CACHED)
    cache.delete(cache.keys().next().value as string);
  return html;
}

export const McpAppPreview = memo(function McpAppPreview({
  address,
  appRef,
  toolCallId,
  data,
}: {
  address: SessionAddress;
  appRef: McpAppRef;
  toolCallId: string;
  data: McpWidgetData;
}) {
  const { id, title } = appRef;
  const block = useMemo<WidgetBlock>(
    () => ({
      id,
      title,
      source: "",
      format: "html",
      origin: "mcp",
      interactive: false,
      width: "regular",
    }),
    [id, title],
  );
  const read = useCallback(
    async (interactive: boolean) =>
      (await load(address, id, toolCallId, interactive)) ?? undefined,
    [address, id, toolCallId],
  );
  return <WidgetFrame block={block} load={read} mcp={data} />;
});
