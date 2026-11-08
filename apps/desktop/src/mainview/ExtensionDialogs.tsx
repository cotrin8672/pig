import { useId, useRef, useState } from "react";
import type { ExtensionDialogRequest } from "../shared/rpc-schema";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { useStore } from "./store";

export function ExtensionDialogs({ sessionId }: { sessionId: string }) {
  const requests = useStore((s) => s.dialogs[sessionId]);
  if (!requests?.length) return null;
  return (
    <div className="extension-dialogs">
      {requests.map((request) => (
        <ExtensionQuestion key={request.id} request={request} />
      ))}
    </div>
  );
}

function ExtensionQuestion({ request }: { request: ExtensionDialogRequest }) {
  const t = useT();
  const titleId = useId();
  const inputId = useId();
  const [value, setValue] = useState(
    request.kind === "editor" ? (request.prefill ?? "") : "",
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string>();
  async function answer(value?: string | boolean, cancelled = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await rpc.request.answerExtensionDialog({
        sessionId: request.sessionId,
        id: request.id,
        value,
        cancelled,
      });
      useStore.setState((s) => ({
        dialogs: {
          ...s.dialogs,
          [request.sessionId]: (s.dialogs[request.sessionId] ?? []).filter(
            (item) => item.id !== request.id,
          ),
        },
      }));
    } catch (error) {
      setError(String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="extension-question"
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <div className="extension-question-heading">
        <span className="session-dot waiting" aria-hidden="true" />
        <span className="muted">{t["Waiting for your answer"]}</span>
      </div>
      <h2 id={titleId}>{request.title}</h2>
      {request.kind === "confirm" && <p>{request.message}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (request.kind === "input" || request.kind === "editor")
            void answer(value);
        }}
      >
        <fieldset disabled={busy}>
          {request.kind === "select" && (
            <div className="extension-options">
              {request.options.map((option, index) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: SDK options have fixed order and may contain duplicate labels.
                  key={index}
                  type="button"
                  onClick={() => void answer(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {(request.kind === "input" || request.kind === "editor") && (
            <>
              <label htmlFor={inputId}>{t["Your answer"]}</label>
              {request.kind === "editor" ? (
                <textarea
                  id={inputId}
                  rows={4}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  id={inputId}
                  value={value}
                  placeholder={request.placeholder}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </>
          )}
          <div className="extension-answer-actions">
            <button type="button" onClick={() => void answer(undefined, true)}>
              {t.Cancel}
            </button>
            {request.kind === "confirm" ? (
              <>
                <button type="button" onClick={() => void answer(false)}>
                  {t.No}
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void answer(true)}
                >
                  {t.Yes}
                </button>
              </>
            ) : (
              request.kind !== "select" && (
                <button className="primary" type="submit">
                  {t.Submit}
                </button>
              )
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
