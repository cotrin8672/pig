import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UIReply, UIRequest } from "../shared/extension-ui";
import { addressKey, sameAddress } from "./chat-snapshot";
import { cancelOpening, rpc } from "./rpc";
import {
  liveAddress,
  ownedTerminalCommand,
  subscribeTerminal,
} from "./runtime-events";
import { showError, useStore } from "./store";
import { TerminalDialog } from "./TerminalDialog";
import { focusedRequest, uiKey, validReply } from "./ui-request-state";
import "./sdk-ui.css";

/** Root-owned: startup/trust UI must not depend on a Chat or Composer mounting. */
export function UIRequestBroker() {
  const requests = useStore((s) => s.pendingUI);
  const terminals = useStore((s) => s.terminals);
  const [selected, setSelected] = useState<string>();
  const [started, setStarted] = useState<Set<string>>(() => new Set());
  const focus = focusedRequest(requests, selected);
  const focusKey = focus && uiKey(focus);
  useEffect(() => {
    if (focus?.kind === "terminal" && terminals[uiKey(focus)]) {
      const key = uiKey(focus);
      setStarted((previous) =>
        previous.has(key) ? previous : new Set([...previous, key]),
      );
    }
  }, [focus, terminals]);
  return (
    <>
      {focus && (
        <RequestQueue
          requests={requests}
          focusKey={focusKey}
          select={setSelected}
        />
      )}
      {requests.map((request) => {
        const key = uiKey(request);
        if (request.kind !== "terminal")
          return (
            <NativeRequest
              key={key}
              request={request}
              active={key === focusKey}
            />
          );
        const terminal = terminals[key];
        if (!terminal || (!started.has(key) && key !== focusKey)) return null;
        return (
          <TerminalDialog
            key={key}
            request={terminal}
            active={key === focusKey}
            subscribe={subscribeTerminal}
            onError={showError}
            openExternal={(url) => rpc.send.openExternal({ url })}
            send={(command) => {
              try {
                void rpc.request
                  .terminalCommand(ownedTerminalCommand(request, command))
                  .catch(showError);
              } catch (error) {
                showError(error);
              }
            }}
          />
        );
      })}
      {focus?.kind === "terminal" && !terminals[uiKey(focus)] && (
        <div className="ui-starting" role="status">
          Preparing {focus.title}…{" "}
          <button
            type="button"
            onClick={() => {
              void rpc.request
                .terminalCommand({ ...focus, type: "cancel" })
                .catch(showError);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
function NativeRequest({
  request,
  active,
}: {
  request: Exclude<UIRequest, { kind: "terminal" }>;
  active: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    "initialValue" in request ? (request.initialValue ?? "") : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  const [error, setError] = useState<string>();
  async function reply(answer: UIReply) {
    if (submitted.current || !validReply(request, answer)) return;
    submitted.current = true;
    setSubmitting(true);
    try {
      await rpc.request.resolveExtensionUI(answer);
      if (
        request.kind === "project-trust" &&
        answer.kind === "project-trust" &&
        liveAddress(request)
      ) {
        const key = addressKey(request);
        useStore.setState((state) => ({
          capabilities: {
            ...state.capabilities,
            [key]: [
              ...(state.capabilities[key] ?? []).filter(
                (message) => !message.startsWith("Safe mode:"),
              ),
              ...(answer.value === "safe"
                ? [
                    `Safe mode: project resources were not granted trust for ${request.cwd}. Review and reload to trust them.`,
                    ...request.resources.map(
                      (resource) =>
                        `Safe mode: not approved — ${resource.kind}: ${resource.path}`,
                    ),
                  ]
                : []),
            ],
          },
        }));
      }
    } catch (failure) {
      submitted.current = false;
      setSubmitting(false);
      setError(String(failure));
    }
  }
  const cancel = () => {
    void reply({ ...request, kind: "cancel" });
  };
  useEffect(() => {
    if (active) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else dialog.current?.close();
  }, [active]);
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    const timer = setTimeout(
      () => {
        // Deadline is cancellation, never implicit permission.
        if (!submitted.current) {
          submitted.current = true;
          setSubmitting(true);
          void rpc.request
            .resolveExtensionUI({ ...request, kind: "cancel" })
            .catch(showError);
        }
      },
      Math.max(0, request.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [request]);
  return (
    <dialog
      ref={dialog}
      className="sdk-request"
      aria-label={request.title}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2>{request.title}</h2>
      <small className="muted">
        Session {request.sessionId} · epoch {request.epoch}
      </small>
      {request.expiresAt && (
        <p className="muted">
          Expires {new Date(request.expiresAt).toLocaleTimeString()}
        </p>
      )}
      {request.kind === "confirm" && <p>{request.message}</p>}
      {request.kind === "project-trust" && (
        <>
          <p>
            Allow this project's resources to load? Extensions can execute code
            with your user privileges. Trust is not an OS sandbox.
          </p>
          <p>
            <code>{request.cwd}</code>
          </p>
          <small>Fingerprint: {request.fingerprint}</small>
          <ul>
            {request.resources.map((resource) => (
              <li key={`${resource.kind}:${resource.path}`}>
                <strong>{resource.kind}</strong> {resource.path}
              </li>
            ))}
          </ul>
          <p>
            Open safe omits untrusted project
            code/settings/instructions/skills/prompts. You can explicitly trust
            and reload later.
          </p>
        </>
      )}
      {request.kind === "select" && (
        <div className="sdk-options">
          {request.options.map((option) => (
            <button
              type="button"
              key={option}
              disabled={submitting}
              onClick={() =>
                void reply({ ...request, kind: "select", value: option })
              }
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {(request.kind === "input" || request.kind === "editor") && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void reply({ ...request, kind: request.kind, value });
          }}
        >
          {request.kind === "editor" ? (
            <textarea
              aria-label={request.title}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={12}
            />
          ) : (
            <input
              aria-label={request.title}
              placeholder={request.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          <button type="submit" disabled={submitting}>
            Submit
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={cancel} disabled={submitting}>
          Cancel
        </button>
        {request.kind === "confirm" && (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void reply({ ...request, kind: "confirm", value: false })
              }
            >
              No
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void reply({ ...request, kind: "confirm", value: true })
              }
            >
              Yes
            </button>
          </>
        )}
        {request.kind === "project-trust" && (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void reply({ ...request, kind: "project-trust", value: "safe" })
              }
            >
              Open safe
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void reply({ ...request, kind: "project-trust", value: "once" })
              }
            >
              Trust once
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void reply({
                  ...request,
                  kind: "project-trust",
                  value: "persist",
                })
              }
            >
              Trust and remember
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

/** Put the single waiting list inside the current modal's top layer; controls
 * outside a showModal dialog are inert and cannot switch independent requests. */
function RequestQueue({
  requests,
  focusKey,
  select,
}: {
  requests: UIRequest[];
  focusKey?: string;
  select: (key: string) => void;
}) {
  const [target, setTarget] = useState<Element | null>(null);
  const openingAddress = useStore((s) =>
    s.opening ? s.openingAddress : undefined,
  );
  const focus = requests.find((request) => uiKey(request) === focusKey);
  useEffect(() => {
    const update = () =>
      setTarget(
        document.querySelector(".sdk-request[open], [data-terminal-ui][open]"),
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  const queue = (
    <nav className="ui-waiting" aria-label="Waiting extension requests">
      {requests.map((request) => (
        <button
          key={uiKey(request)}
          type="button"
          aria-pressed={focusKey === uiKey(request)}
          onClick={() => select(uiKey(request))}
        >
          {request.title} · {request.sessionId.slice(0, 12)}
        </button>
      ))}
      {focus && (
        <>
          <button
            type="button"
            onClick={() => void rpc.request.abort(focus).catch(showError)}
          >
            Stop session
          </button>
          <button
            type="button"
            onClick={() =>
              void rpc.request.closeSession(focus).catch(showError)
            }
          >
            Close session
          </button>
          {openingAddress && sameAddress(openingAddress, focus) && (
            <button
              type="button"
              onClick={() => void cancelOpening().catch(showError)}
            >
              Cancel startup
            </button>
          )}
        </>
      )}
    </nav>
  );
  return target ? createPortal(queue, target) : queue;
}
