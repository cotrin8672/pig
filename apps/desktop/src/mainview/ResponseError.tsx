import type { ChatRendererProps } from "@pig/chat-renderers";
import { CircleAlert, CircleStop } from "lucide-react";
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
