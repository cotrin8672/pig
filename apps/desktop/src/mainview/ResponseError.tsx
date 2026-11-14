import type { ChatRendererProps } from "@pig/chat-renderers";
import { Check, CircleAlert, CircleStop, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { responseErrorKind } from "../shared/response-error";
import { ChatContent } from "./ChatContent";
import { useT } from "./i18n";
import { LazyDetails } from "./LazyDetails";
import "./response-error.css";

export function BuiltinResponseError({ data }: ChatRendererProps<"error">) {
  const t = useT();
  const reason = responseErrorKind(data.message, data.stopReason);
  const stopped = reason === "stopped";
  const Icon = stopped ? CircleStop : CircleAlert;
  const { title, detail } = t.responseFailure(reason);
  return (
    <section
      className="response-error"
      data-reason={reason}
      role={stopped ? "status" : "alert"}
    >
      <div className="response-error-heading">
        <Icon size={16} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      <p>{detail}</p>
      {!stopped && data.message && (
        <LazyDetails summary={t.responseErrorDetails} name="error">
          {() => <pre>{data.message}</pre>}
        </LazyDetails>
      )}
    </section>
  );
}

const secondsUntil = (at?: number) =>
  at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0;
function useSecondsUntil(at?: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [at]);
  return secondsUntil(at);
}

export function BuiltinRetryNotice({ data }: ChatRendererProps<"retry">) {
  const t = useT();
  const seconds = useSecondsUntil(data.waiting?.retryAt);
  return (
    <span
      className="response-retry"
      data-waiting={data.waiting ? "" : undefined}
      role="status"
      title={data.message}
    >
      {data.waiting ? (
        <RotateCw size={12} aria-hidden="true" />
      ) : (
        <Check size={12} aria-hidden="true" />
      )}
      {data.waiting
        ? t.retryWaiting(data.attempt, data.waiting.maxAttempts, seconds)
        : t.retryDone(data.attempt)}
    </span>
  );
}

export function RetryNotice(data: ChatRendererProps<"retry">["data"]) {
  return (
    <ChatContent
      kind="retry"
      contentKey={`retry:${data.attempt}:${data.message}`}
      builtin={BuiltinRetryNotice}
      data={data}
    />
  );
}

export function ResponseError({
  message,
  stopReason,
}: {
  message: string;
  stopReason?: string;
}) {
  return (
    <ChatContent
      kind="error"
      contentKey={`${stopReason ?? "error"}:${message}`}
      builtin={BuiltinResponseError}
      data={{ message, stopReason }}
    />
  );
}
