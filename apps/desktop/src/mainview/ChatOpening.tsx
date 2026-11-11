import { useSyncExternalStore } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ComposerEditor } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { drafts, emptyContent, expandedDraft } from "./draft-store";
import { useT } from "./i18n";
import { UserMessage } from "./MessageContent";
import { ModelPicker } from "./ModelPicker";
import { openingDraftKey, queueOpeningSend } from "./opening-sends";
import { openChat } from "./rpc";
import { useStore } from "./store";
import "./composer.css";

export function OpeningComposer({ preview }: { preview?: Snapshot }) {
  const t = useT();
  const target = useStore((s) => s.openingTarget);
  const stored = useStore((s) =>
    target?.id ? s.snapshots[target.id] : undefined,
  );
  const snapshot = preview ?? stored;
  const newText = useStore((s) =>
    target ? (s.newChatDrafts[openingDraftKey(target)] ?? "") : "",
  );
  const readText = () =>
    snapshot ? drafts.read(snapshot.address).content.text : "";
  const existingText = useSyncExternalStore(
    drafts.subscribe,
    readText,
    readText,
  );
  const existing = !!preview || !!target?.id;
  const text = existing
    ? [existingText, newText].filter(Boolean).join("\n")
    : newText;
  function send() {
    if (!text.trim()) return;
    if (!useStore.getState().openId && preview)
      void openChat(preview.info.cwd, preview.info.id);
    const state = useStore.getState();
    const id = state.openId;
    const opening = id && state.pendingOpens[id];
    if (!id || !opening) return;
    const content = snapshot
      ? { ...drafts.read(snapshot.address).content, text }
      : { ...emptyContent(), text };
    queueOpeningSend(id, content);
    if (snapshot) drafts.edit(snapshot.address, emptyContent, true);
    useStore.setState((s) => ({
      newChatDrafts: { ...s.newChatDrafts, [openingDraftKey(opening)]: "" },
    }));
  }
  const viewKey = snapshot
    ? addressKey(snapshot.address)
    : target?.id
      ? `opening:${target.id}`
      : `new:${target?.cwd}`;
  return (
    <ComposerFrame>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <ComposerEditor
          viewKey={viewKey}
          aria-label={t.Message}
          placeholder={t["Ask anything, or describe what to build…"]}
          value={text}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (snapshot)
              drafts.edit(
                snapshot.address,
                (content) => ({ ...content, text: value }),
                true,
              );
            if (target)
              useStore.setState((s) => ({
                newChatDrafts: {
                  ...s.newChatDrafts,
                  [openingDraftKey(target)]: snapshot ? "" : value,
                },
              }));
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-toolbar">
          <span className="sr-only" role="status">
            {t["Opening chat…"]}
          </span>
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot?.contextUsage} />
            <ModelPicker
              selection={target?.selection ?? snapshot}
              onSelect={(selection) => {
                if (!useStore.getState().openId && preview)
                  void openChat(preview.info.cwd, preview.info.id);
                useStore.setState((s) => {
                  const id = s.openId;
                  const pending = id && s.pendingOpens[id];
                  if (!id || !pending) return {};
                  const updated = {
                    ...pending,
                    selection,
                    selectionChanged: true,
                  };
                  return {
                    openingTarget: updated,
                    pendingOpens: { ...s.pendingOpens, [id]: updated },
                  };
                });
              }}
            />
          </div>
          <div className="send-controls">
            <ComposerSubmit
              busy={false}
              hasContent={!!text}
              disabled={!text.trim()}
              onStop={() => {}}
            />
          </div>
        </div>
      </form>
    </ComposerFrame>
  );
}

export function OpeningMessages() {
  const queued = useStore((state) => state.openingTarget?.queuedSends);
  return queued?.map((send) => (
    <div className="response-turn" key={send.id}>
      <article className="message user">
        <UserMessage
          sessionId="opening"
          disabled
          message={{
            role: "user",
            timestamp: send.timestamp,
            content: [
              { type: "text", text: expandedDraft(send.content) },
              ...send.content.images.map(({ image }) => image),
            ],
          }}
        />
      </article>
    </div>
  ));
}

export function ChatOpening() {
  const target = useStore((s) => s.openingTarget);
  const message = useStore((s) => s.openMessage);
  return (
    <ChatLayout loading composer={<OpeningComposer />}>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {!target?.id && <ChatEmpty cwd={target?.cwd} />}
      <OpeningMessages />
    </ChatLayout>
  );
}
