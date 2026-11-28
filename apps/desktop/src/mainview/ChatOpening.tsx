import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { composerAction } from "../shared/keymap";
import { editFoldedText } from "../shared/paste";
import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import type { DraftContent, PromptDelivery } from "../shared/runtime-contract";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ComposerAttachments } from "./ComposerAttachments";
import { ComposerEditor, insertEditorNewline } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { attachmentReads, clipboardFiles } from "./composer-attachments";
import { composerHistory } from "./composer-input-history";
import { drafts, emptyContent } from "./draft-store";
import { useT } from "./i18n";
import { MessageQueue, usePendingArrival } from "./MessageQueue";
import { ModelPicker } from "./ModelPicker";
import { NewChatTarget } from "./NewChatTarget";
import { navigate, navigationRevision } from "./navigation";
import {
  editOpeningSend,
  openingDraftKey,
  openingSends,
  queueOpeningSelection,
  queueOpeningSend,
  reorderOpeningSends,
  restoreOpeningSends,
  steerOpeningSend,
  withdrawOpeningSend,
} from "./opening-sends";
import { PendingUserMessage } from "./PendingUserMessage";
import { ComposerForm } from "./patterns/ComposerForm";
import {
  acceptRemoteSend,
  remote,
  remoteDraftKey,
  saveRemoteDraft,
} from "./remote-workspace";
import { openChat, rpc, startOpeningChat } from "./rpc";
import { showError, useStore } from "./store";
import "./composer.css";

const OpeningId = createContext<string | undefined>(undefined);
const noContent = emptyContent();
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
  const openId = useStore((s) => paneOpenId ?? s.openId);
  const deferred = useStore(
    (s) => !!(openId && s.pendingOpens[openId]?.deferred),
  );
  const target = useOpeningTarget();
  const remoteLock = useRef(false);
  const [remoteSending, setRemoteSending] = useState(false);
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
  const draftKey = target && openingDraftKey(target);
  const newText = useStore((s) =>
    draftKey === undefined ? "" : (s.newChatDrafts[draftKey] ?? ""),
  );
  const owner = snapshot?.address ?? draftKey;
  const readContent = () =>
    owner === undefined ? noContent : drafts.read(owner).content;
  const content = useSyncExternalStore(
    drafts.subscribe,
    readContent,
    readContent,
  );
  useSyncExternalStore(
    attachmentReads.subscribe,
    attachmentReads.getTick,
    attachmentReads.getTick,
  );
  const loads = owner === undefined ? [] : attachmentReads.read(owner);
  const { images, files } = content;
  const queued = openingSends(target).length > 0;
  const text = [content.text, newText].filter(Boolean).join("\n");
  const hasContent =
    !!text.trim() || images.length > 0 || !!files?.length || loads.length > 0;
  function changeText(value: string, pastes?: DraftContent["pastes"]) {
    if (snapshot)
      drafts.edit(
        snapshot.address,
        (content) => ({
          ...content,
          ...(pastes === undefined
            ? editFoldedText(text, value, content.pastes)
            : { text: value, pastes }),
        }),
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
  function editAttachments(change: (content: DraftContent) => DraftContent) {
    if (owner !== undefined) drafts.edit(owner, change, true);
  }
  function attach(dropped: File[]) {
    if (owner !== undefined)
      attachmentReads.startFiles(owner, dropped, (name, data) =>
        rpc.request.storeAttachment({ name, data }),
      );
  }
  function send(delivery: PromptDelivery = "steer") {
    if (owner === undefined || remoteLock.current) return;
    const current = drafts.read(owner).content;
    const pending = attachmentReads.pending(owner);
    if (
      !text.trim() &&
      !current.images.length &&
      !current.files?.length &&
      !pending
    )
      return;
    if (!currentOpenId() && preview)
      void openChat(preview.info.cwd, preview.info.id);
    const state = useStore.getState();
    const id = currentOpenId();
    const opening = id && state.pendingOpens[id];
    if (!id || !opening) return;
    if (opening.remote) {
      if (
        current.images.length ||
        current.files?.length ||
        pending ||
        text.length > 16000 ||
        /^[!/]/.test(text.trimStart())
      )
        return showError(t.chatTargetRemoteText);
      const host = state.remoteHosts.find(
        (pc) => pc.id === opening.remote?.host,
      );
      const project = host?.projects?.find(
        (p) => p.id === opening.remote?.project,
      );
      if (!host || host.online === false || !project)
        return showError(t.chatTargetUnavailable);
      void sendRemote(id, host, project);
      return;
    }
    queueOpeningSend(
      id,
      { ...current, text },
      delivery,
      attachmentReads.claim(owner),
    );
    drafts.edit(owner, emptyContent, true);
    useStore.setState((s) => ({
      newChatDrafts: { ...s.newChatDrafts, [openingDraftKey(opening)]: "" },
    }));
    void startOpeningChat(id);
  }
  async function sendRemote(
    openId: string,
    host: { id: string; name: string },
    project: { id: string; name: string },
  ) {
    const revision = navigationRevision;
    const { activePane } = useStore.getState();
    const stillHere = () => {
      const s = useStore.getState();
      return (
        revision === navigationRevision &&
        s.page === "chat" &&
        s.activePane === activePane &&
        (paneOpenId ? s.panes[activePane]?.openId : s.openId) === openId
      );
    };
    remoteLock.current = true;
    setRemoteSending(true);
    try {
      const { view, chat } = await remote(host.id, {
        op: "new",
        project: project.id,
      });
      if (!stillHere()) return;
      const key = remoteDraftKey(host.id, chat);
      const id = crypto.randomUUID();
      saveRemoteDraft(key, text, { view, id });
      const draftKey = target && openingDraftKey(target);
      if (draftKey)
        useStore.setState((s) =>
          s.newChatDrafts[draftKey] === text
            ? { newChatDrafts: { ...s.newChatDrafts, [draftKey]: "" } }
            : s,
        );
      const firstSend = remote(host.id, { op: "send", view, id, text })
        .then(() => {
          acceptRemoteSend(key, id);
          return true;
        })
        .catch((e) => {
          // The send may have arrived. Leave its receipt and text for RemoteConversation.
          showError(e);
          return false;
        });
      useStore.setState({
        remoteThread: {
          chat,
          view,
          host: host.id,
          hostName: host.name,
          project: project.id,
          projectName: project.name,
          title: t["New chat"],
          firstSend,
        },
      });
      navigate("remoteChat");
      void firstSend.then(() => {
        window.dispatchEvent(new Event("remote-chat-created"));
        useStore.setState((s) =>
          s.remoteThread?.firstSend === firstSend
            ? { remoteThread: { ...s.remoteThread, firstSend: undefined } }
            : s,
        );
      });
    } catch (e) {
      showError(e);
    } finally {
      remoteLock.current = false;
      setRemoteSending(false);
    }
  }
  const viewKey = snapshot
    ? addressKey(snapshot.address)
    : target?.id
      ? `opening:${target.id}`
      : `new:${target?.draftId ?? target?.cwd}`;
  return (
    <ComposerFrame
      onFiles={!target?.remote && owner !== undefined ? attach : undefined}
    >
      {openId && deferred && (
        <NewChatTarget openId={openId} busy={remoteSending} />
      )}
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
          if (openId) editOpeningSend(openId, id);
          textareaRef.current?.focus();
        }}
      />
      <ComposerForm
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        toolbar={
          <>
            {(!target?.draftId || queued) && (
              <span className="sr-only" role="status">
                {t["Opening chat…"]}
              </span>
            )}
            <div className="composer-pickers">
              {!target?.remote && (
                <>
                  <ContextIndicator usage={snapshot?.contextUsage} />
                  <ModelPicker
                    selection={target?.selection ?? snapshot}
                    onSelect={selectModel}
                  />
                </>
              )}
            </div>
          </>
        }
        submit={
          <ComposerSubmit
            busy={false}
            waiting={queued || remoteSending}
            hasContent={hasContent}
            disabled={!hasContent}
            onStop={() => {
              const id = currentOpenId();
              if (id) restoreOpeningSends(id);
            }}
          />
        }
      >
        {(images.length > 0 ||
          files?.length ||
          loads.some((load) => load.preview)) && (
          <div className="composer-attachments">
            <ComposerAttachments
              images={images}
              files={files}
              loads={loads}
              onRemoveImage={(id) =>
                editAttachments((content) => ({
                  ...content,
                  images: content.images.filter((item) => item.id !== id),
                }))
              }
              onRemoveFile={(id) =>
                editAttachments((content) => ({
                  ...content,
                  files: content.files?.filter((item) => item.id !== id),
                }))
              }
            />
          </div>
        )}
        <ComposerEditor
          viewKey={viewKey}
          inputRef={textareaRef}
          aria-label={t.Message}
          placeholder={t["Ask anything, or describe what to build…"]}
          value={text}
          readOnly={remoteSending}
          pastes={snapshot ? content.pastes : undefined}
          onRestore={(edit) => {
            if (!remoteLock.current) changeText(edit.text, edit.pastes);
          }}
          messageHistory={() =>
            snapshot ? composerHistory(snapshot.transcript.records) : []
          }
          onChange={(event) => changeText(event.currentTarget.value)}
          onPaste={(event) => {
            if (remoteLock.current) {
              event.preventDefault();
              return;
            }
            const pasted = clipboardFiles(event.clipboardData);
            if (target?.remote) {
              if (pasted.length) {
                event.preventDefault();
                showError(t.chatTargetRemoteText);
              }
              return;
            }
            if (owner === undefined) return;
            if (pasted.length) {
              event.preventDefault();
              attach(pasted);
              return;
            }
            // Windows screenshots can arrive as native-only clipboard data.
            if (
              !event.clipboardData.getData("text/plain") &&
              !event.clipboardData.getData("text/html")
            ) {
              event.preventDefault();
              attachmentReads.startClipboard(owner, () =>
                rpc.request.readClipboardImage({}),
              );
            }
          }}
          onKeyDown={(event) => {
            if (
              remoteLock.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
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
      </ComposerForm>
    </ComposerFrame>
  );
}

export function OpeningMessages() {
  const target = useOpeningTarget();
  const arrival = usePendingArrival();
  return openingSends(target)
    .filter((send) => send.delivery !== "followUp")
    .map((send) => (
      <PendingUserMessage
        key={send.id}
        arrivalRef={arrival(send.id, send.content)}
        sessionId="opening"
        timestamp={send.timestamp}
        content={send.content}
      />
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
  const remoteProject = useStore((s) =>
    target?.remote
      ? (s.remoteHosts
          .find((host) => host.id === target.remote?.host)
          ?.projects?.find((p) => p.id === target.remote?.project)?.name ?? "")
      : undefined,
  );
  return (
    <ChatLayout loading={!deferred} composer={<OpeningComposer />}>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {!target?.id && (
        <ChatEmpty cwd={target?.cwd} remoteProject={remoteProject} />
      )}
      <OpeningMessages />
    </ChatLayout>
  );
}
