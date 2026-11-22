// biome-ignore-all lint/suspicious/noArrayIndexKey: Questions and options keep their order.
import { Check, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AskAnswer, AskQuestion } from "../shared/ask-user";
import type { UIReply, UIRequest } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { sameAddress } from "./chat-snapshot";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { SolidBlurFilter } from "./SolidBlurFilter";
import { showError, useStore } from "./store";
import { uiKey, validReply } from "./ui-request-state";
import "./agent-tools.css";

type Ask = Extract<UIRequest, { kind: "ask" }>;
/** `text` is the free answer, or the comment once an option is picked. */
type Draft = { picked: string[]; text: string };
const empty: Draft = { picked: [], text: "" };

function answerOf(
  entry: AskQuestion,
  draft: Draft,
  allowComment: boolean,
): AskAnswer | undefined {
  const text = draft.text.trim();
  if (draft.picked.length)
    return {
      kind: "selection",
      selections: draft.picked,
      ...(allowComment && text ? { comment: text } : {}),
    };
  if (text && (entry.allowFreeform || !entry.options.length))
    return { kind: "freeform", text };
}

/**
 * pi-ask-user's prompt as a panel above this chat's Composer. Clicking a
 * single-choice option answers at once; one text field takes the free answer
 * or the comment. Absolutely placed, so it never moves the Composer or the
 * conversation.
 */
export function AskUserPanel({ address }: { address: SessionAddress }) {
  const request = useStore((s) =>
    s.pendingUI.find(
      (item): item is Ask => item.kind === "ask" && sameAddress(item, address),
    ),
  );
  return request ? <AskForm key={uiKey(request)} request={request} /> : null;
}

export function AskForm({ request }: { request: Ask }) {
  const t = useT();
  const at = t.agentTools;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    request.questions.map(() => empty),
  );
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const sent = useRef(false);
  const total = request.questions.length;
  const answersOf = (list: Draft[]) =>
    request.questions.map((entry, i) =>
      answerOf(entry, list[i] ?? empty, request.allowComment),
    );
  const answers = answersOf(drafts);
  const entry = request.questions[step];
  const draft = drafts[step] ?? empty;
  const free = entry.allowFreeform || !entry.options.length;
  const complete = answers.every(Boolean);
  async function reply(answer: UIReply) {
    if (sent.current || !validReply(request, answer)) return;
    sent.current = true;
    setSubmitting(true);
    try {
      await rpc.request.resolveExtensionUI(answer);
    } catch (failure) {
      sent.current = false;
      setSubmitting(false);
      showError(failure);
    }
  }
  const submit = (value: (AskAnswer | undefined)[]) =>
    void reply({ ...request, kind: "ask", value: value as AskAnswer[] });
  const cancel = () => void reply({ ...request, kind: "cancel" });
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    // Deadline is cancellation, as for every other extension dialog.
    const timer = setTimeout(
      () => {
        if (sent.current) return;
        sent.current = true;
        void rpc.request
          .resolveExtensionUI({ ...request, kind: "cancel" })
          .catch(showError);
      },
      Math.max(0, request.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [request]);
  const edit = (index: number, change: (draft: Draft) => Draft) => {
    const next = drafts.map((draft, i) =>
      i === index ? change(draft) : draft,
    );
    setDrafts(next);
    return next;
  };
  /** Send once every question has an answer, else go to the next open one. */
  function advance(list: Draft[]) {
    const value = answersOf(list);
    if (value.every(Boolean)) return submit(value);
    const order = [...value.keys()].map((i) => (step + 1 + i) % total);
    setStep(order.find((i) => !value[i]) ?? step);
  }
  function pick(index: number, entry: AskQuestion, title: string) {
    if (!entry.allowMultiple)
      return advance(
        edit(index, (draft) => ({
          picked: [title],
          text: request.allowComment ? draft.text : "",
        })),
      );
    edit(index, (draft) => ({
      ...draft,
      picked: draft.picked.includes(title)
        ? draft.picked.filter((item) => item !== title)
        : [...draft.picked, title],
    }));
  }
  return (
    <form
      className="ask-panel"
      aria-label={request.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (answers[step]) advance(drafts);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          cancel();
        }
      }}
    >
      {/* Panels in other panes repeat the same filter; any copy resolves. */}
      <SolidBlurFilter id="ask-panel-solid" />
      <fieldset key={step} disabled={submitting}>
        {/* The question is the header: no separate title row. */}
        <legend>
          <MessageCircleQuestion size={13} aria-hidden="true" />
          <span>{entry.question}</span>
          {total > 1 && (
            <small>
              {step + 1}/{total}
            </small>
          )}
        </legend>
        <div className="ask-panel-body">
          {total > 1 && request.title && (
            <p className="agent-context">{request.title}</p>
          )}
          {entry.context && <p className="agent-context">{entry.context}</p>}
          {entry.options.length > 0 && (
            <ul className="agent-options">
              {entry.options.map((option, i) => {
                const picked = draft.picked.includes(option.title);
                return (
                  <li key={i} data-picked={picked}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => pick(step, entry, option.title)}
                    >
                      <span className="agent-key" aria-hidden="true">
                        {picked ? <Check size={11} /> : i + 1}
                      </span>
                      <strong>{option.title}</strong>
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </fieldset>
      {/* Text field and actions share one row. */}
      <div className="ask-panel-actions">
        {(free || request.allowComment) && (
          <input
            aria-label={free ? at.answer : at.comment}
            placeholder={free ? at.answer : at.comment}
            value={draft.text}
            disabled={submitting}
            onChange={(event) => {
              const text = event.target.value;
              // Without comments, typing switches to a free answer.
              edit(step, (current) => ({
                picked: request.allowComment ? current.picked : [],
                text,
              }));
            }}
          />
        )}
        <button type="button" onClick={cancel} disabled={submitting}>
          {t.cancel}
        </button>
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={submitting}
          >
            {t.Back}
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={submitting || !answers[step]}
        >
          {complete ? t.Send : at.nextQuestion}
        </button>
      </div>
    </form>
  );
}
