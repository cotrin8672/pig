import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DraftFile } from "../shared/attachments";
import { composerAction } from "../shared/keymap";
import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import type { DraftContent, PromptDelivery } from "../shared/runtime-contract";
import { imageTypes, maxImageBase64 } from "./attachment-reads";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ComposerAttachments } from "./ComposerAttachments";
import { ComposerEditor, insertEditorNewline } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { composerHistory } from "./composer-input-history";
import { drafts, emptyContent, expandedDraft } from "./draft-store";
import { useT } from "./i18n";
import { UserMessage } from "./MessageContent";
import { MessageQueue, usePendingArrival } from "./MessageQueue";
import { ModelPicker } from "./ModelPicker";
import { NewChatTarget } from "./NewChatTarget";
import { navigate, navigationRevision } from "./navigation";
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
import { remote, remoteDraftKey, saveRemoteDraft } from "./remote-workspace";
import { openChat, rpc, startOpeningChat } from "./rpc";
import { showError, useStore } from "./store";
import "./composer.css";

const OpeningId = createContext<string | undefined>(undefined);
const noImages: DraftContent["images"] = [];
const noFiles: DraftFile[] = [];
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
  const newText = useStore((s) =>
    target ? (s.newChatDrafts[openingDraftKey(target)] ?? "") : "",
  );
  const readContent = () =>
    snapshot ? drafts.read(snapshot.address).content : undefined;
  const existingContent = useSyncExternalStore(
    drafts.subscribe,
    readContent,
    readContent,
  );
  const existingText = existingContent?.text ?? "";
  // Only a chat that does not exist yet holds attachments here; existing chats use their draft.
  const imageKey = target && !snapshot ? openingDraftKey(target) : undefined;
  const newImages = useStore((s) =>
    imageKey ? (s.newChatImages[imageKey] ?? noImages) : noImages,
  );
  const newFiles = useStore((s) =>
    imageKey ? (s.newChatFiles[imageKey] ?? noFiles) : noFiles,
  );
  const images = existingContent ? existingContent.images : newImages;
  const files = existingContent ? (existingContent.files ?? noFiles) : newFiles;
  const queued = openingSends(target).length > 0;
  const existing = !!preview || !!target?.id;
  const text = existing
    ? [existingText, newText].filter(Boolean).join("\n")
    : newText;
  const hasContent = !!text.trim() || images.length + files.length > 0;
  function changeText(value: string, pastes?: DraftContent["pastes"]) {
    if (snapshot)
      drafts.edit(
        snapshot.address,
        (content) => ({
          ...content,
          text: value,
          pastes: pastes ?? content.pastes,
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
  function setImages(
    change: (images: DraftContent["images"]) => DraftContent["images"],
  ) {
    if (snapshot)
      drafts.edit(
        snapshot.address,
        (content) => ({ ...content, images: change(content.images) }),
        true,
      );
    else if (imageKey)
      useStore.setState((s) => ({
        newChatImages: {
          ...s.newChatImages,
          [imageKey]: change(s.newChatImages[imageKey] ?? []),
        },
      }));
  }
  function setFiles(change: (files: DraftFile[]) => DraftFile[]) {
    if (snapshot)
      drafts.edit(
        snapshot.address,
        (content) => ({ ...content, files: change(content.files ?? []) }),
        true,
      );
    else if (imageKey)
      useStore.setState((s) => ({
        newChatFiles: {
          ...s.newChatFiles,
          [imageKey]: change(s.newChatFiles[imageKey] ?? []),
        },
      }));
  }
  function addImage(data: string | null, mimeType: string) {
    if (!data) return showError("No image could be read from the clipboard.");
    if (data.length > maxImageBase64)
      return showError(t["Each image must be at most 4.5 MiB of base64 data."]);
    if (images.length >= 8)
      return showError(t["You can attach up to 8 images."]);
    setImages((current) => [
      ...current,
      { id: crypto.randomUUID(), image: { type: "image", data, mimeType } },
    ]);
  }
  function attach(dropped: File[]) {
    for (const file of dropped) {
      const image = imageTypes.has(file.type);
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result).replace(/^data:[^,]*;base64,/, "");
        if (image) return addImage(data, file.type);
        // Non-image files go to the agent as a stored path, like the chat composer.
        void rpc.request
          .storeAttachment({ name: file.name, data })
          .then(
            (path) =>
              setFiles((current) => [
                ...current,
                { id: crypto.randomUUID(), path, name: file.name },
              ]),
            showError,
          );
      };
      reader.onerror = () => showError(`Could not read ${file.name}`);
      reader.readAsDataURL(file);
    }
  }
  function send(delivery: PromptDelivery = "steer") {
    if (!hasContent || remoteLock.current) return;
    if (!currentOpenId() && preview)
      void openChat(preview.info.cwd, preview.info.id);
    const state = useStore.getState();
    const id = currentOpenId();
    const opening = id && state.pendingOpens[id];
    if (!id || !opening) return;
    if (opening.remote) {
      if (
        images.length ||
        files.length ||
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
    const content = snapshot
      ? { ...drafts.read(snapshot.address).content, text }
      : { ...emptyContent(), text, images, files };
    queueOpeningSend(id, content, delivery);
    setImages(() => []);
    setFiles(() => []);
    if (snapshot) drafts.edit(snapshot.address, emptyContent, true);
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
          saveRemoteDraft(key, "", undefined, id);
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
      onFiles={!target?.remote && (imageKey || snapshot) ? attach : undefined}
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
          const send = openId && withdrawOpeningSend(openId, id);
          if (!send) return;
          if (snapshot) drafts.restoreSent(snapshot.address, send.content);
          else {
            changeText([send.content.text, text].filter(Boolean).join("\n\n"));
            setImages((current) => [...send.content.images, ...current]);
            setFiles((current) => [...(send.content.files ?? []), ...current]);
          }
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
        {images.length + files.length > 0 && (
          <div className="composer-attachments">
            <ComposerAttachments
              images={images}
              files={files}
              onRemoveImage={(id) =>
                setImages((items) => items.filter((item) => item.id !== id))
              }
              onRemoveFile={(id) =>
                setFiles((items) => items.filter((item) => item.id !== id))
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
          pastes={
            snapshot ? drafts.read(snapshot.address).content.pastes : undefined
          }
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
            const pasted = Array.from(event.clipboardData.files);
            if (target?.remote) {
              if (pasted.length) {
                event.preventDefault();
                showError(t.chatTargetRemoteText);
              }
              return;
            }
            if (!imageKey && !snapshot) return;
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
              void rpc.request
                .readClipboardImage({})
                .then((data) => addImage(data, "image/png"), showError);
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
        <div className="composer-toolbar">
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
          <div className="send-controls">
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
          </div>
        </div>
      </form>
    </ComposerFrame>
  );
}

export function OpeningMessages() {
  const target = useOpeningTarget();
  const arrival = usePendingArrival();
  return openingSends(target)
    .filter((send) => send.delivery !== "followUp")
    .map((send) => (
      <div className="response-turn" key={send.id}>
        <article ref={arrival(send.id, send.content)} className="message user">
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
