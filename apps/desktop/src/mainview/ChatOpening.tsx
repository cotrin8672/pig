import {
  createContext,
  useCallback,
  useContext,
  useRef,
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
    if (!hasContent) return;
    if (!currentOpenId() && preview)
      void openChat(preview.info.cwd, preview.info.id);
    const state = useStore.getState();
    const id = currentOpenId();
    const opening = id && state.pendingOpens[id];
    if (!id || !opening) return;
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
  const viewKey = snapshot
    ? addressKey(snapshot.address)
    : target?.id
      ? `opening:${target.id}`
      : `new:${target?.draftId ?? target?.cwd}`;
  return (
    <ComposerFrame onFiles={imageKey || snapshot ? attach : undefined}>
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
          pastes={
            snapshot ? drafts.read(snapshot.address).content.pastes : undefined
          }
          onRestore={(edit) => changeText(edit.text, edit.pastes)}
          messageHistory={() =>
            snapshot ? composerHistory(snapshot.transcript.records) : []
          }
          onChange={(event) => changeText(event.currentTarget.value)}
          onPaste={(event) => {
            if (!imageKey && !snapshot) return;
            const pasted = Array.from(event.clipboardData.files);
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
