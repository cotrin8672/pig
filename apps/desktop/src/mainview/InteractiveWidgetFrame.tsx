import { useEffect, useRef } from "react";
import { WIDGET_MAX_BYTES } from "../shared/widget";
import { SIZE_MESSAGE } from "./widget-frame";

export type McpWidgetData = { args: unknown; result: unknown };

function mcpResult(value: unknown) {
  if (!value || typeof value !== "object") return { content: [] };
  const { content, structuredContent, isError } = value as Record<
    string,
    unknown
  >;
  // In particular, do not forward SDK details, resource readers, or _meta.
  return {
    content: Array.isArray(content) ? content : [],
    ...(structuredContent !== undefined && { structuredContent }),
    ...(isError === true && { isError }),
  };
}

export function InteractiveWidgetFrame({
  html,
  label,
  onHeight,
  onUnavailable,
  mcp,
}: {
  html: string;
  label: string;
  onHeight: (height: number) => void;
  onUnavailable: () => void;
  mcp?: McpWidgetData;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ onHeight, onUnavailable, mcp });
  latest.current = { onHeight, onUnavailable, mcp };
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let phase: "shell" | "document" | "initialize" | "ready" = "shell";
    const send = (message: object) =>
      element.contentWindow?.postMessage(message, "*");
    const unavailable = setTimeout(() => latest.current.onUnavailable(), 2500);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== element.contentWindow ||
        event.origin !== "null" ||
        !event.data ||
        typeof event.data !== "object"
      )
        return;
      const message = event.data;
      if (phase === "shell") {
        if (message.type !== "pig:widget-ready") return;
        clearTimeout(unavailable);
        phase = "document";
        send({ type: "pig:widget-document", html });
        return;
      }
      if (
        message.type === SIZE_MESSAGE &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      ) {
        latest.current.onHeight(Math.min(message.height, 20_000));
      }
      const data = latest.current.mcp;
      if (!data || message.jsonrpc !== "2.0") return;
      const { id, method } = message;
      const request =
        Number.isSafeInteger(id) || (typeof id === "string" && id.length < 256);
      if (
        phase === "document" &&
        request &&
        method === "ui/initialize" &&
        typeof message.params?.protocolVersion === "string"
      ) {
        phase = "initialize";
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2026-01-26",
            hostInfo: { name: "PiG", version: "1" },
            hostCapabilities: {},
            hostContext: {
              displayMode: "inline",
              availableDisplayModes: ["inline"],
              platform: "desktop",
            },
          },
        });
      } else if (
        phase === "initialize" &&
        method === "ui/notifications/initialized" &&
        !Object.hasOwn(message, "id")
      ) {
        phase = "ready";
        const args = data.args ?? {};
        const result = mcpResult(data.result);
        const fits = (value: unknown) =>
          new TextEncoder().encode(JSON.stringify(value)).byteLength <=
          WIDGET_MAX_BYTES;
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: fits(args) ? args : {} },
        });
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: fits(result) ? result : { content: [], isError: true },
        });
      } else if (request && typeof method === "string") {
        // No app-to-host tool/resource calls, links, messages, or native IPC.
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not available in PiG" },
        });
      }
    };
    window.addEventListener("message", receive);
    element.src = "http://pig-widget.localhost/frame";
    return () => {
      clearTimeout(unavailable);
      window.removeEventListener("message", receive);
    };
  }, [html]);
  // biome-ignore lint/a11y/useIframeTitle: named via aria-label; native title tooltips are banned (lint:ui).
  return <iframe ref={frame} aria-label={label} sandbox="allow-scripts" />;
}
