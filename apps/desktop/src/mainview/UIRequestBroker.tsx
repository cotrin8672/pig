import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { UIReply, UIRequest } from "../shared/extension-ui";
import { addressKey, sameAddress } from "./chat-snapshot";
import { useT } from "./i18n";
import { navigationRevision } from "./navigation";
import { cancelOpening, rpc } from "./rpc";
import {
  liveAddress,
  ownedTerminalCommand,
  subscribeTerminal,
} from "./runtime-events";
import { showError, useStore } from "./store";
import { TerminalDialog } from "./TerminalDialog";
import {
  focusedRequest,
  foregroundRequests,
  uiKey,
  validReply,
} from "./ui-request-state";
import { selectBrokerView, selectRequestPreviews } from "./ui-selectors";
import "./sdk-ui.css";

/** Root-owned: startup/trust UI must not depend on a Chat or Composer mounting. */
export const UIRequestBroker = memo(function UIRequestBroker() {
  const state = useStore(useShallow(selectBrokerView));
  const previews = useStore(useShallow(selectRequestPreviews));
  const { pendingUI: requests, terminals } = state;
  const [selected, setSelected] = useState<{ key: string; revision: number }>();
  const [started, setStarted] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismiss = (key: string) =>
    setDismissed((previous) => new Set([...previous, key]));
  const selectedKey =
    selected?.revision === navigationRevision ? selected.key : undefined;
  const focus = focusedRequest(
    foregroundRequests(
      requests.filter((request) => !dismissed.has(uiKey(request))),
      {
        page: state.page,
        active: state.active,
        snapshots: previews,
        openingAddress:
          state.opening && state.openingViewRevision === navigationRevision
            ? state.openingAddress
            : undefined,
      },
      selectedKey,
    ),
    selectedKey,
  );
  const focusKey = focus && uiKey(focus);
  useEffect(() => {
    if (focus?.kind === "terminal") {
      const key = uiKey(focus);
      setStarted((previous) =>
        previous.has(key) ? previous : new Set([...previous, key]),
      );
    }
  }, [focus]);
  return (
    <>
      {requests.length > 0 && (!focus || requests.length > 1) && (
        <RequestQueue
          requests={requests}
          focusKey={focusKey}
          select={(key) => {
            setDismissed(
              (previous) => new Set([...previous].filter((id) => id !== key)),
            );
            setSelected({ key, revision: navigationRevision });
          }}
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
              modal={false}
              onDismiss={() => dismiss(key)}
            />
          );
        const terminal = terminals[key];
        if (!started.has(key) && key !== focusKey) return null;
        return (
          <TerminalDialog
            key={key}
            request={terminal ?? { ...request, type: "open" }}
            ready={!!terminal && !dismissed.has(key)}
            active={key === focusKey}
            modal={false}
            onDismiss={() => dismiss(key)}
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
    </>
  );
});
function NativeRequest({
  request,
  active,
  modal,
  onDismiss,
}: {
  request: Exclude<UIRequest, { kind: "terminal" }>;
  active: boolean;
  modal: boolean;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    "initialValue" in request ? (request.initialValue ?? "") : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  const [error, setError] = useState<string>();
  const [remember, setRemember] = useState(true);
  const t = useT();
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
      showError(failure);
    }
  }
  const cancel = () => {
    onDismiss();
    // Once submitted, closing the view must not send a contradictory reply.
    if (!submitted.current) void reply({ ...request, kind: "cancel" });
  };
  useEffect(() => {
    dialog.current?.close();
    if (active) {
      if (modal) dialog.current?.showModal();
      else dialog.current?.show();
    }
  }, [active, modal]);
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
      aria-modal={modal}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <h2>{request.kind === "project-trust" ? t.trustTitle : request.title}</h2>
      {request.expiresAt && (
        <p className="muted">
          Expires {new Date(request.expiresAt).toLocaleTimeString()}
        </p>
      )}
      {request.kind === "confirm" && <p>{request.message}</p>}
      {request.kind === "project-trust" && (
        <>
          <p>{t.trustBody}</p>
          <p>
            <code>{request.cwd}</code>
          </p>
          <details>
            <summary>{t.trustFiles(request.resources.length)}</summary>
            <ul>
              {request.resources.map((resource) => (
                <li key={`${resource.kind}:${resource.path}`}>
                  <strong>{resource.kind}</strong> {resource.path}
                </li>
              ))}
            </ul>
          </details>
          <label className="sdk-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            {t.trustRemember}
          </label>
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
        <button type="button" onClick={cancel}>
          {t.cancel}
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
              {t.trustOpenSafe}
            </button>
            <button
              type="button"
              className="primary"
              disabled={submitting}
              onClick={() =>
                void reply({
                  ...request,
                  kind: "project-trust",
                  value: remember ? "persist" : "once",
                })
              }
            >
              {t.trustAccept}
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
  const pendingOpens = useStore((s) => s.pendingOpens);
  const focus = requests.find((request) => uiKey(request) === focusKey);
  const openingId =
    focus &&
    Object.keys(pendingOpens).find(
      (id) =>
        pendingOpens[id].address &&
        sameAddress(pendingOpens[id].address, focus),
    );
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
    <nav
      className={`ui-waiting${target ? "" : " ui-waiting-floating"}`}
      aria-label="Waiting extension requests"
    >
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
          {openingId && (
            <button
              type="button"
              onClick={() => void cancelOpening(openingId).catch(showError)}
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
