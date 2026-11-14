import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import { composerAction } from "../shared/keymap";
import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import type { PromptDelivery } from "../shared/runtime-contract";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ComposerEditor, insertEditorNewline } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { drafts, emptyContent, expandedDraft } from "./draft-store";
import { useT } from "./i18n";
import { UserMessage } from "./MessageContent";
import { MessageQueue } from "./MessageQueue";
import { ModelPicker } from "./ModelPicker";
import {
  openingDraftKey,
  openingSends,
  queueOpeningSelection,
  queueOpeningSend,
  reorderOpeningSends,
  restoreOpeningSends,
  steerOpeningSend,
  withdrawOpeningSend,
} from "./opening-sends";
import { openChat, startOpeningChat } from "./rpc";
import { useStore } from "./store";
import "./composer.css";

const OpeningId = createContext<string | undefined>(undefined);
function useOpeningTarget() {
  const id = useContext(OpeningId);
  return useStore((s) => (id ? s.pendingOpens[id] : s.openingTarget));
}

export function OpeningComposer({ preview }: { preview?: Snapshot }) {
  const t = useT();
  const keybindings = useStore((s) => s.settings.keybindings);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paneOpenId = useContext(OpeningId);
  const currentOpenId = () => paneOpenId ?? useStore.getState().openId;
  const target = useOpeningTarget();
  const stored = useStore((s) =>
    target?.id ? s.snapshots[target.id] : undefined,
  );
  const snapshot = preview ?? stored;
  const selectModel = useCallback(
    (selection: ModelSelection) => {
      if (!(paneOpenId ?? useStore.getState().openId) && preview)
        void openChat(preview.info.cwd, preview.info.id);
      const id = paneOpenId ?? useStore.getState().openId;
      if (id) queueOpeningSelection(id, selection);
    },
    [preview, paneOpenId],
  );
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
  const queued = openingSends(target).length > 0;
  const existing = !!preview || !!target?.id;
  const text = existing
    ? [existingText, newText].filter(Boolean).join("\n")
    : newText;
  function changeText(value: string) {
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
  }
  function send(delivery: PromptDelivery = "steer") {
    if (!text.trim()) return;
    if (!currentOpenId() && preview)
      void openChat(preview.info.cwd, preview.info.id);
    const state = useStore.getState();
    const id = currentOpenId();
    const opening = id && state.pendingOpens[id];
    if (!id || !opening) return;
    const content = snapshot
      ? { ...drafts.read(snapshot.address).content, text }
      : { ...emptyContent(), text };
    queueOpeningSend(id, content, delivery);
    if (snapshot) drafts.edit(snapshot.address, emptyContent, true);
    useStore.setState((s) => ({
      newChatDrafts: { ...s.newChatDrafts, [openingDraftKey(opening)]: "" },
    }));
    void startOpeningChat(id);
  }
  const viewKey = snapshot
    ? addressKey(snapshot.address)
    : target?.id
      ? `opening:${target.id}`
      : `new:${target?.draftId ?? target?.cwd}`;
  return (
    <ComposerFrame>
      <MessageQueue
        items={openingSends(target).filter(
          (send) => send.delivery === "followUp",
        )}
        onDelete={(id) => {
          const openId = currentOpenId();
          if (openId) withdrawOpeningSend(openId, id);
        }}
        onMove={(ids) => {
          const openId = currentOpenId();
          if (openId) reorderOpeningSends(openId, ids);
        }}
        onSteer={(id) => {
          const openId = currentOpenId();
          if (openId) steerOpeningSend(openId, id);
          textareaRef.current?.focus();
        }}
        onEdit={(id) => {
          const openId = currentOpenId();
          const send = openId && withdrawOpeningSend(openId, id);
          if (!send) return;
          if (snapshot) drafts.restoreSent(snapshot.address, send.content);
          else
            changeText([send.content.text, text].filter(Boolean).join("\n\n"));
          textareaRef.current?.focus();
        }}
      />
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <ComposerEditor
          viewKey={viewKey}
          inputRef={textareaRef}
          aria-label={t.Message}
          placeholder={t["Ask anything, or describe what to build…"]}
          value={text}
          onChange={(event) => changeText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const action = composerAction(event, keybindings);
            if (!action) return;
            event.preventDefault();
            if (action === "composer.newline")
              insertEditorNewline(event.currentTarget, changeText);
            else if (!event.repeat)
              send(
                action === "composer.queue" && snapshot?.transcript.running
                  ? "followUp"
                  : "steer",
              );
          }}
        />
        <div className="composer-toolbar">
          {(!target?.draftId || queued) && (
            <span className="sr-only" role="status">
              {t["Opening chat…"]}
            </span>
          )}
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot?.contextUsage} />
            <ModelPicker
              selection={target?.selection ?? snapshot}
              onSelect={selectModel}
            />
          </div>
          <div className="send-controls">
            <ComposerSubmit
              busy={false}
              waiting={queued}
              hasContent={!!text}
              disabled={!text.trim()}
              onStop={() => {
                const id = currentOpenId();
                if (id) restoreOpeningSends(id);
              }}
            />
          </div>
        </div>
      </form>
    </ComposerFrame>
  );
}

export function OpeningMessages() {
  const target = useOpeningTarget();
  return openingSends(target)
    .filter((send) => send.delivery !== "followUp")
    .map((send) => (
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

export function ChatOpening({ openId }: { openId?: string }) {
  return (
    <OpeningId.Provider value={openId}>
      <OpeningView />
    </OpeningId.Provider>
  );
}

function OpeningView() {
  const target = useOpeningTarget();
  const id = useContext(OpeningId);
  const message = useStore((s) =>
    id ? s.pendingOpens[id]?.message : s.openMessage,
  );
  const deferred = useStore((s) =>
    id
      ? s.pendingOpens[id]?.deferred
      : s.openId
        ? s.pendingOpens[s.openId]?.deferred
        : false,
  );
  return (
    <ChatLayout loading={!deferred} composer={<OpeningComposer />}>
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
