import { Bot, ChevronDown, ChevronUp, Puzzle } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { useT } from "./i18n";
import { inboundMessage } from "./inbound-message";
import "./sender-bubble.css";

/** The label riding on top of a bubble the user did not type. */
export function SenderHead({
  icon,
  label,
  name,
  detail,
  failed,
}: {
  icon: ReactNode;
  label?: string;
  name: string;
  detail?: string;
  failed?: boolean;
}) {
  return (
    <span className="sender-head" data-failed={failed || undefined}>
      {icon}
      {label && <span>{label}</span>}
      <strong>{name}</strong>
      {detail && <span className="sender-detail">{detail}</span>}
    </span>
  );
}

/** An extension message to the agent: drawn as someone else's message, not as a tool card. */
export function InboundMessage({
  record,
  images,
}: {
  record: TranscriptRecord;
  images?: ReactNode;
}) {
  const t = useT().agentTools;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const inbound = inboundMessage(record);
  // The toggle exists only when the clamp hides text; resizes (width, new text) re-measure.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || open) return;
    const measure = () =>
      setLong(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  if (!inbound) return null;
  const head = (
    <SenderHead
      icon={
        inbound.subagent ? (
          <Bot size={12} aria-hidden="true" />
        ) : (
          <Puzzle size={12} aria-hidden="true" />
        )
      }
      name={inbound.sender}
      detail={inbound.status && (t.statuses[inbound.status] ?? inbound.status)}
      failed={inbound.status === "failed"}
    />
  );
  return (
    <div className="response-turn" data-record-id={record.id}>
      <article className="message user">
        <div className="user-turn">
          {images}
          <div className="user-bubble sender-bubble">
            {head}
            {inbound.text && (
              <div
                ref={body}
                className="sender-body"
                data-open={open || undefined}
              >
                {inbound.text}
              </div>
            )}
            {(long || open) && (
              <button
                type="button"
                className="sender-toggle"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? t.collapse : t.expand}
                {open ? (
                  <ChevronUp size={13} aria-hidden="true" />
                ) : (
                  <ChevronDown size={13} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
