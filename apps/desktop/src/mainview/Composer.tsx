import {
  BookOpen,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as GenericFile,
  LoaderCircle,
  Puzzle,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { composerAction } from "../shared/keymap";
import { filterModels } from "../shared/models";
import {
  editFoldedText,
  makeMarker,
  shouldCollapse,
  unfoldPastes,
} from "../shared/paste";
import type { SlashCommand, Snapshot } from "../shared/rpc-schema";
import type { PromptDelivery } from "../shared/runtime-contract";
import { AnnotationDrafts } from "./AnnotationCards";
import { AnnotationPopover } from "./AnnotationPopover";
import { rememberAnnotationRange } from "./annotation-highlights";
import { AttachmentReads, maxImageBase64 } from "./attachment-reads";
import { ComposerEditor, insertEditorNewline } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { createDraftMirror } from "./draft-mirror";
import { drafts, expandedDraft } from "./draft-store";
import { ExtensionWidgets } from "./extension-status";
import { useT } from "./i18n";
import { MessageQueue } from "./MessageQueue";
import { ModelPicker } from "./ModelPicker";
import { rpc, sends } from "./rpc";
import { subscribeOwnership } from "./runtime-events";
import {
  applySlashCompletion,
  extensionCommand,
  matchesSlashCommand,
  type SlashArgument,
  slashContext,
} from "./slash-completion";
import { showError, useStore } from "./store";
import "./composer.css";

const categoryIcons = { extension: Puzzle, skill: BookOpen, prompt: FileText };

const fileIcons: [RegExp, typeof GenericFile][] = [
  [/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i, FileArchive],
  [/\.(mp3|wav|flac|ogg|m4a|aac)$/i, FileAudio],
  [/\.(mp4|mov|mkv|webm|avi)$/i, FileVideo],
  [/\.(csv|tsv|xlsx?|ods)$/i, FileSpreadsheet],
  [/\.(md|txt|pdf|docx?|rtf|log)$/i, FileText],
  [
    /\.(ts|tsx|js|jsx|json|ya?ml|toml|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|sh|ps1|html|css|sql|xml)$/i,
    FileCode,
  ],
];
const fileIcon = (name: string) =>
  fileIcons.find(([pattern]) => pattern.test(name))?.[1] ?? GenericFile;

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const attachmentReads = new AttachmentReads(drafts, showError);
subscribeOwnership((previous, next) =>
  attachmentReads.transfer(previous, next),
);
export function Composer({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { address, transcript } = snapshot;
  const key = addressKey(address);
  const keybindings = useStore((s) => s.settings.keybindings);
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const models = filterModels(
    snapshot.modelCatalog ?? available,
    disabledModels,
  );
  const slashAddress = useMemo(
    () => ({
      hostId: address.hostId,
      sessionId: address.sessionId,
      epoch: address.epoch,
    }),
    [address.hostId, address.sessionId, address.epoch],
  );
  const canSend = models.length > 0;
  const draft = useSyncExternalStore(drafts.subscribe, () =>
    drafts.read(address),
  );
  const sendState = useSyncExternalStore(sends.subscribe, () =>
    sends.read(address),
  );
  useSyncExternalStore(attachmentReads.subscribe, attachmentReads.getTick);
  const loads = attachmentReads.read(address);
  const loading = loads.some((load) => load.state === "pending");
  const { text, images, pastes, files = [], annotations = [] } = draft.content;
  const [stopping, setStopping] = useState<string>();
  function stop() {
    if (stopping === key) return;
    setStopping(key);
    void sends
      .stop(address, () => rpc.request.abort(address))
      .catch(showError)
      .finally(() => {
        setStopping((current) => (current === key ? undefined : current));
      });
  }
  const nextPaste = useRef(1);
  const expanded = expandedDraft(draft.content);
  useSyncExternalStore(sends.subscribe, sends.getTick);
  // Sent but not started yet: the host has the message, the response has not begun.
  const echoed = new Set(transcript.records.map((record) => record.requestId));
  const waiting =
    sendState?.state === "sending" ||
    sendState?.state === "checking" ||
    sends
      .optimistic(address)
      .some(
        (send) => send.state !== "unknown" && !echoed.has(send.key.requestId),
      );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [commandState, setCommandState] = useState<{
    key: string;
    commands: SlashCommand[];
  }>({ key: "", commands: [] });
  const commands = commandState.key === key ? commandState.commands : [];
  const [selection, setSelection] = useState({ key, start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [argumentState, setArgumentState] = useState<{
    owner: string;
    query: string;
    items: SlashArgument[];
  }>({ owner: "", query: "", items: [] });
  const context =
    selection.key === key && focused && !composing && !dismissed
      ? slashContext(text, selection.start, selection.end)
      : undefined;
  const open = !!context;
  useEffect(() => {
    if (open) return;
    let live = true;
    void rpc.request
      .listSlashCommands(slashAddress)
      .then((commands) => {
        if (live) setCommandState({ key, commands });
      })
      .catch((error) => {
        if (live) showError(error);
      });
    return () => {
      live = false;
    };
  }, [key, slashAddress, open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void rpc.request
      .listSlashCommands(slashAddress)
      .then((commands) => {
        if (live) setCommandState({ key, commands });
      })
      .catch((error) => {
        if (live) showError(error);
      });
    return () => {
      live = false;
    };
  }, [key, slashAddress, open]);
  const name = context?.kind === "argument" ? context.name : undefined;
  const prefix = context?.kind === "argument" ? context.prefix : undefined;
  const query = name === undefined ? "" : JSON.stringify([key, name, prefix]);
  const argumentOwner = name === undefined ? "" : JSON.stringify([key, name]);
  const hasExtension = commands.some(
    (c) => c.name === name && c.category === "extension",
  );
  useEffect(() => {
    let live = true;
    if (name !== undefined && prefix !== undefined && hasExtension) {
      void rpc.request
        .completeSlashArguments({
          ...slashAddress,
          name,
          argumentPrefix: prefix,
        })
        .then((items) => {
          if (live) setArgumentState({ owner: argumentOwner, query, items });
        })
        .catch((error) => {
          if (!live) return;
          setArgumentState({ owner: argumentOwner, query, items: [] });
          showError(error);
        });
    }
    return () => {
      live = false;
    };
  }, [query, name, prefix, hasExtension, slashAddress, argumentOwner]);
  const argumentsPending =
    !!query && hasExtension && argumentState.query !== query;
  const options =
    context?.kind === "command"
      ? commands
          .filter((c) => matchesSlashCommand(c, context.prefix))
          .map((c) => ({
            label: `/${c.name}`,
            value: `/${c.name}`,
            description: c.description,
            category: c.category,
          }))
      : query && hasExtension && argumentState.owner === argumentOwner
        ? argumentState.items.map((item) => ({ ...item, category: undefined }))
        : [];
  const active = argumentsPending ? -1 : Math.min(selected, options.length - 1);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  const extensionSend =
    !images.length &&
    !files.length &&
    !annotations.length &&
    extensionCommand(expanded, commands);
  function updateSelection(target: HTMLTextAreaElement) {
    setSelection({
      key,
      start: target.selectionStart,
      end: target.selectionEnd,
    });
    setDismissed(false);
    setSelected(0);
  }
  function acceptOption(index: number) {
    if (!context || argumentsPending || !options[index]) return;
    const { text: next, cursor } = applySlashCompletion(
      text,
      context,
      options[index].value,
    );
    drafts.edit(address, (content) => ({ ...content, text: next }));
    setSelection({ key, start: cursor, end: cursor });
    setSelected(0);
    setDismissed(context.kind === "argument");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }
  const mirror = useMemo(
    () => createDraftMirror((params) => rpc.request.syncDraft(params)),
    [],
  );
  useEffect(
    () => () => {
      const latest = drafts.read(slashAddress);
      if (latest.dirty && !latest.conflict && !latest.retired)
        void drafts.flush(slashAddress, mirror, latest).catch(showError);
    },
    [slashAddress, mirror],
  );
  // Background mirror is not the command barrier: send still awaits the ordered CAS queue.
  useEffect(() => {
    if (!draft.dirty || draft.conflict || draft.retired) return;
    const timer = setTimeout(() => {
      void drafts.flush(slashAddress, mirror).catch(showError);
    }, 120);
    return () => clearTimeout(timer);
  }, [slashAddress, draft, mirror]);
  function send(delivery: PromptDelivery = "steer") {
    const loading = attachmentReads.pending(address) > 0;
    if (
      (!expanded && !images.length && !loading) ||
      (!canSend && !extensionSend) ||
      draft.conflict
    )
      return;
    // In-flight attachments move with this message; it is sent once they load.
    void sends
      .send(address, undefined, attachmentReads.claim(address), delivery)
      .catch(showError);
  }
  function attach(files: File[]) {
    // Capture the address, not whichever session happens to be active at FileReader completion.
    for (const file of files) {
      if (!imageTypes.has(file.type)) {
        attachmentReads.startFile(address, file, (name, data) =>
          rpc.request.storeAttachment({ name, data }),
        );
        continue;
      }
      if (
        drafts.read(address).content.images.length +
          attachmentReads
            .read(address)
            .filter((load) => load.kind === "image" && load.state === "pending")
            .length >=
        8
      ) {
        showError(t["You can attach up to 8 images."]);
        continue;
      }
      if (4 * Math.ceil(file.size / 3) > maxImageBase64) {
        showError(t["Each image must be at most 4.5 MiB of base64 data."]);
        continue;
      }
      attachmentReads.start(address, file);
    }
  }
  return (
    <ComposerFrame>
      <AnnotationPopover
        onAdd={(annotation, range) => {
          const id = crypto.randomUUID();
          rememberAnnotationRange(id, range);
          drafts.edit(address, (content) => ({
            ...content,
            annotations: [
              ...(content.annotations ?? []),
              { id, ...annotation },
            ],
          }));
          textareaRef.current?.focus();
        }}
      />
      <ExtensionWidgets address={address} />
      <MessageQueue
        items={sends
          .queued(address)
          .flatMap((item) =>
            item.content
              ? [{ id: item.key.requestId, content: item.content }]
              : [],
          )}
        onEdit={async (requestId) => {
          if (
            await sends.withdrawQueued(address, { ...address, requestId }, true)
          )
            textareaRef.current?.focus();
          else showError(t["Already sending"]);
        }}
        onDelete={async (requestId) => {
          if (!(await sends.withdrawQueued(address, { ...address, requestId })))
            showError(t["Already sending"]);
          else if (!sends.queued(address).length) textareaRef.current?.focus();
        }}
      />
      {draft.conflict && (
        <section className="draft-conflict" role="alert">
          <p>
            An extension changed this editor while you were typing. Both drafts
            were retained.
          </p>
          <details>
            <summary>Extension draft</summary>
            <pre>{draft.conflict.text}</pre>
          </details>
          <button
            type="button"
            onClick={() => drafts.resolve(address, "local")}
          >
            Keep my draft
          </button>
          <button
            type="button"
            onClick={() => drafts.resolve(address, "extension")}
          >
            Use extension draft
          </button>
        </section>
      )}
      <form
        className="composer"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          void attach(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {pastes.some((p) => text.includes(p.marker)) && (
          <button
            type="button"
            onClick={() => {
              drafts.edit(address, (content) => ({
                ...content,
                text: unfoldPastes(content.text, content.pastes),
                pastes: [],
              }));
              textareaRef.current?.focus();
            }}
          >
            {t.editPastes}
          </button>
        )}
        <AnnotationDrafts
          annotations={annotations}
          onRemove={(id) =>
            drafts.edit(address, (content) => ({
              ...content,
              annotations: content.annotations?.filter(
                (item) => item.id !== id,
              ),
            }))
          }
        />
        {images.length + files.length + Number(loading) > 0 && (
          <div className="composer-attachments">
            {images.map(({ id, image }, index) => (
              <div className="composer-attachment" key={id}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                />
                <button
                  type="button"
                  aria-label={`${t["Remove attachment"]}: ${t.imageN(index + 1, images.length)}`}
                  title={t["Remove attachment"]}
                  onClick={() =>
                    drafts.edit(address, (content) => ({
                      ...content,
                      images: content.images.filter((item) => item.id !== id),
                    }))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {files.map(({ id, name, path }) => {
              const Icon = fileIcon(name);
              return (
                <div className="composer-attachment file" key={id} title={path}>
                  <Icon size={28} aria-hidden />
                  <span>{name}</span>
                  <button
                    type="button"
                    aria-label={`${t["Remove attachment"]}: ${name}`}
                    title={t["Remove attachment"]}
                    onClick={() =>
                      drafts.edit(address, (content) => ({
                        ...content,
                        files: content.files?.filter((item) => item.id !== id),
                      }))
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            {loads
              .filter((load) => load.state === "pending")
              .map((load) => (
                <div
                  className="composer-attachment file loading"
                  key={load.id}
                  title={load.name}
                  aria-busy="true"
                >
                  <LoaderCircle size={22} className="spinner" aria-hidden />
                  <span>{load.name}</span>
                  <button
                    type="button"
                    aria-label={`${t["Remove attachment"]}: ${load.name}`}
                    title={t["Remove attachment"]}
                    onClick={() => attachmentReads.cancel(load.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
          </div>
        )}
        {loads
          .filter((load) => load.state === "error")
          .map((load) => (
            <p className="composer-hint" key={load.id} role="alert">
              {load.name}: {load.error}{" "}
              <button
                type="button"
                onClick={() => attachmentReads.cancel(load.id)}
              >
                {t["Remove attachment"]}: {load.name}
              </button>
            </p>
          ))}
        {options.length > 0 && (
          <div
            className="slash-options"
            id={listId}
            role="listbox"
            aria-label={t.slashSuggestions}
            aria-busy={argumentsPending}
          >
            {options.map((option, index) => (
              <div
                key={`${option.category ?? "argument"}-${option.value}-${option.label}`}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                aria-disabled={argumentsPending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    acceptOption(index);
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => acceptOption(index)}
              >
                {option.category &&
                  (() => {
                    const Icon = categoryIcons[option.category];
                    return (
                      <span
                        role="img"
                        className="slash-category"
                        title={t[option.category]}
                        aria-label={t[option.category]}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </span>
                    );
                  })()}
                <span className="slash-name" title={option.label}>
                  {option.label}
                </span>
                {option.description && (
                  <small
                    className="slash-description"
                    title={option.description}
                  >
                    {option.description}
                  </small>
                )}
              </div>
            ))}
          </div>
        )}
        <ComposerEditor
          viewKey={key}
          inputRef={textareaRef}
          aria-autocomplete="list"
          aria-controls={options.length ? listId : undefined}
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          onFocus={(event) => {
            setFocused(true);
            updateSelection(event.currentTarget);
          }}
          onBlur={() => setFocused(false)}
          onSelect={(event) => updateSelection(event.currentTarget)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            updateSelection(event.currentTarget);
          }}
          aria-label={t.Message}
          placeholder={
            transcript.running
              ? t["Send a follow-up…"]
              : t["Ask anything, or describe what to build…"]
          }
          value={text}
          onChange={(event) => {
            const target = event.currentTarget;
            updateSelection(target);
            drafts.edit(address, (content) => ({
              ...content,
              ...editFoldedText(content.text, target.value, content.pastes),
            }));
          }}
          onCopy={(event) => {
            const field = event.currentTarget;
            const selected = field.value.slice(
              field.selectionStart,
              field.selectionEnd,
            );
            const copied = unfoldPastes(selected, pastes);
            if (copied === selected) return;
            event.clipboardData.setData("text/plain", copied);
            event.preventDefault();
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length)
              for (const item of Array.from(event.clipboardData.items)) {
                const file = item.kind === "file" ? item.getAsFile() : null;
                if (file) files.push(file);
              }
            if (files.length) {
              event.preventDefault();
              void attach(files);
              return;
            }
            const pasted = event.clipboardData
              .getData("text/plain")
              .replace(/\r\n/g, "\n");
            if (!pasted && !event.clipboardData.getData("text/html")) {
              event.preventDefault();
              if (
                images.length +
                  loads.filter(
                    (load) => load.kind === "image" && load.state === "pending",
                  ).length >=
                8
              ) {
                showError(t["You can attach up to 8 images."]);
                return;
              }
              attachmentReads.startClipboard(address, () =>
                rpc.request.readClipboardImage({}),
              );
              return;
            }
            if (!shouldCollapse(pasted)) return;
            let id = nextPaste.current++;
            while (
              text.includes(makeMarker(id, pasted)) ||
              pastes.some((paste) => paste.marker === makeMarker(id, pasted))
            )
              id = nextPaste.current++;
            const marker = makeMarker(id, pasted);
            const textarea = event.currentTarget;
            const {
              selectionStart: start,
              selectionEnd: end,
              value,
            } = textarea;
            const next = editFoldedText(
              value,
              value.slice(0, start) + marker + value.slice(end),
              pastes,
            );
            if (next.pastes !== pastes) return;
            event.preventDefault();
            drafts.edit(address, (content) => ({
              ...content,
              text: next.text,
              pastes: [
                ...content.pastes,
                { id: crypto.randomUUID(), marker, text: pasted },
              ],
            }));
            requestAnimationFrame(() =>
              textarea.setSelectionRange(
                start + marker.length,
                start + marker.length,
              ),
            );
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.keyCode === 229 ||
              composing
            )
              return;
            if (
              options.length &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!argumentsPending)
                  setSelected(
                    (active +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                      options.length,
                  );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                acceptOption(active);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissed(true);
                return;
              }
            }
            if (
              event.key === "Escape" &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              (transcript.running || waiting)
            ) {
              event.preventDefault();
              stop();
              return;
            }
            const action = composerAction(event, keybindings);
            if (!action) return;
            event.preventDefault();
            if (action === "composer.newline") {
              insertEditorNewline(event.currentTarget, (value) =>
                drafts.edit(address, (content) => ({
                  ...content,
                  ...editFoldedText(content.text, value, content.pastes),
                })),
              );
            } else if (!event.repeat)
              send(
                action === "composer.queue" && transcript.running
                  ? "followUp"
                  : "steer",
              );
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot.contextUsage} />
            <ModelPicker snapshot={snapshot} />
          </div>
          <div className="send-controls">
            <ComposerSubmit
              busy={transcript.running}
              waiting={waiting}
              stopping={stopping === key}
              hasContent={!!expanded || images.length > 0 || loading}
              onStop={stop}
              disabled={
                (!expanded && !images.length && !loading) ||
                (!canSend && !extensionSend) ||
                !!draft.conflict
              }
            />
          </div>
        </div>
      </form>
    </ComposerFrame>
  );
}
