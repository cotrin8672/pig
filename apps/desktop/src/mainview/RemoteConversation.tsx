import { useEffect, useMemo, useRef, useState } from "react";
import type { RemoteTranscript } from "../shared/remote-workspace";
import { ChatLayout } from "./ChatLayout";
import { navigate } from "./navigation";
import { Button } from "./primitives/Button";
import {
  type RemotePending,
  remote,
  remoteDraftKey,
  saveRemoteDraft,
} from "./remote-workspace";
import { showError, useStore } from "./store";
import "./remote-workspace.css";

type Target = NonNullable<ReturnType<typeof useStore.getState>["remoteThread"]>;
export function RemoteConversation() {
  const target = useStore((s) => s.remoteThread);
  return target ? (
    <Thread key={`${target.host}:${target.view}`} target={target} />
  ) : (
    <Button onClick={() => navigate("pairing")}>接続先を選ぶ</Button>
  );
}
function Thread({ target }: { target: Target }) {
  const { host } = target;
  const [view, setView] = useState(target.view);
  const storageKey = remoteDraftKey(host, target.chat);
  const outbox = `${storageKey}:pending:`;
  const [saved] = useState(() => {
    try {
      const pendingKey = Object.keys(localStorage).find((k) =>
        k.startsWith(outbox),
      );
      return JSON.parse(
        (pendingKey && localStorage.getItem(pendingKey)) ||
          sessionStorage.getItem(storageKey) ||
          "{}",
      ) as {
        text?: string;
        pending?: RemotePending;
      };
    } catch {
      return {};
    }
  });
  const [page, setPage] = useState<RemoteTranscript>();
  const [past, setPast] = useState<RemoteTranscript[]>([]);
  const [draft, setDraft] = useState(saved.text ?? "");
  const [pending, setPending] = useState(saved.pending);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function save(
    text: string,
    unresolved?: RemotePending,
    settled = pending?.id,
  ) {
    saveRemoteDraft(storageKey, text, unresolved, settled);
    setDraft(text);
    setPending(unresolved);
  }
  const [firstSend] = useState(target.firstSend);
  const [busy, setBusy] = useState(!!firstSend);
  const [olderBusy, setOlderBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const thread = useRef<HTMLElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!firstSend) return;
    let active = true;
    void firstSend.then((accepted) => {
      if (!active) return;
      setBusy(false);
      if (accepted) {
        setDraft("");
        setPending(undefined);
        setRefresh((x) => x + 1);
      }
    });
    return () => {
      active = false;
    };
  }, [firstSend]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh requests an immediate snapshot after an accepted send.
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 5000;
      try {
        const next = await remote(host, { op: "read", view });
        if (!active) return;
        setPage(next);
        if (next.view && next.view !== view) {
          setPast([]);
          setView(next.view);
        }
        setOffline(false);
        delay = next.running ? 1500 : 5000;
      } catch {
        if (active) setOffline(true);
      }
      if (active) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [host, view, refresh]);
  async function send() {
    if (
      lock.current ||
      busy ||
      pending ||
      !draft.trim() ||
      /^[!/]/.test(draft.trimStart())
    )
      return;
    const id = crypto.randomUUID();
    lock.current = true;
    setBusy(true);
    try {
      save(draft, { view, id });
      await remote(host, { op: "send", view, id, text: draft });
      if (!mounted.current) return;
      save("", undefined, id);
      setRefresh((x) => x + 1);
    } catch (e) {
      if (mounted.current) showError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function receipt() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const r = await remote(host, { op: "receipt", view, id: pending.id });
      if (!mounted.current) return;
      if (r.state === "accepted") {
        save("");
        setRefresh((x) => x + 1);
      } else if (r.state === "rejected") {
        save(draft);
        showError("送信は受け付けられませんでした。");
      } else showError("受付はまだ確認できません。会話を確認してください。");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  const cursor = past.length ? past[0].history : page?.history;
  async function earlier() {
    if (!cursor?.before || olderBusy) return;
    setOlderBusy(true);
    try {
      const result = await remote(host, {
        op: "history",
        view,
        before: cursor.before,
        revision: cursor.revision,
      });
      setPast((old) => [result, ...old]);
    } catch (e) {
      showError(e);
    } finally {
      setOlderBusy(false);
    }
  }
  const blocked = /^[!/]/.test(draft.trimStart());
  const messages = useMemo(
    () =>
      [...past, ...(page ? [page] : [])].map((p, i) => (
        <div key={p.history?.before ?? i}>
          {p.messages.map((m) => (
            <div key={m.id} className="remote-message">
              <strong>{m.role === "user" ? "あなた" : target.hostName}</strong>
              <p>{m.text}</p>
            </div>
          ))}
          {p.truncated && <span>一部の本文は省略されています。</span>}
        </div>
      )),
    [past, page, target.hostName],
  );
  return (
    <ChatLayout
      threadRef={thread}
      onContentResize={(atBottom) => {
        if (atBottom && thread.current)
          thread.current.scrollTop = thread.current.scrollHeight;
      }}
      composer={
        <form
          className="remote-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <strong>
            {target.hostName} · {target.projectName}
          </strong>
          <span role="status">
            {pending && !busy
              ? "受付不明です。自動再送はしません。"
              : offline
                ? "接続できません。ホストを確認し、必要なら会話を開き直してください。"
                : page?.waitingForHost
                  ? "接続先で承認を待っています。"
                  : page?.failed
                    ? "接続先で処理に失敗しました。"
                    : page?.running
                      ? "接続先で応答中…"
                      : blocked
                        ? "通常のテキストのみ送信できます。"
                        : ""}
          </span>
          {pending && !busy && (
            <>
              <Button disabled={busy} onClick={() => void receipt()}>
                受付を確認
              </Button>
              <Button disabled={busy} onClick={() => save(draft)}>
                再送せず下書きに戻す
              </Button>
            </>
          )}
          <textarea
            aria-label={`${target.hostName}へのメッセージ`}
            placeholder="メッセージ"
            rows={2}
            maxLength={16000}
            value={draft}
            disabled={busy || !!pending}
            onChange={(e) => save(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={
              !page || offline || busy || !!pending || blocked || !draft.trim()
            }
          >
            送信
          </Button>
        </form>
      }
    >
      <h2>{target.title}</h2>
      {cursor?.before && (
        <Button disabled={olderBusy} onClick={() => void earlier()}>
          以前の履歴を読む
        </Button>
      )}
      {messages}
    </ChatLayout>
  );
}
