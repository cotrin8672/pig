import { BookOpen, FileText, Puzzle, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { filterModels } from "../shared/models";
import { makeMarker, shouldCollapse } from "../shared/paste";
import type { SlashCommand, Snapshot } from "../shared/rpc-schema";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { drafts, expandedDraft } from "./draft-store";
import { ExtensionWidgets } from "./extension-status";
import { useT } from "./i18n";
import { ModelPicker } from "./ModelPicker";
import { navigate } from "./navigation";
import { rpc, sends } from "./rpc";
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

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const maxBase64 = 4.5 * 1024 * 1024;
const pendingReads = new Map<string, number>();
const readListeners = new Set<() => void>();
const subscribeReads = (listener: () => void) => {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
};
function changeReads(key: string, delta: number) {
  pendingReads.set(key, (pendingReads.get(key) ?? 0) + delta);
  for (const listener of readListeners) listener();
}
export function Composer({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const shell = dock?.closest<HTMLElement>(".chat-shell");
    if (!dock || !shell) return;
    const measure = () => {
      shell.style.setProperty(
        "--composer-height",
        `${dock.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--composer-height");
    };
  }, []);
  const { address, transcript, model } = snapshot;
  const key = addressKey(address);
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const models = filterModels(available, disabledModels);
  const slashAddress = useMemo(
    () => ({
      hostId: address.hostId,
      sessionId: address.sessionId,
      epoch: address.epoch,
    }),
    [address.hostId, address.sessionId, address.epoch],
  );
  const modelPending = useStore((s) => s.modelPending);
  const canSend = models.some(
    (m) => m.provider === model?.provider && m.id === model.id,
  );
  const draft = useSyncExternalStore(drafts.subscribe, () =>
    drafts.read(address),
  );
  const sendState = useSyncExternalStore(sends.subscribe, () =>
    sends.read(address),
  );
  const reading = useSyncExternalStore(
    subscribeReads,
    () => pendingReads.get(key) ?? 0,
  );
  const { text, images, pastes } = draft.content;
  const [mirrorError, setMirrorError] = useState<string>();
  const nextPaste = useRef(1);
  const imageBlocked = images.length > 0 && model?.vision !== true;
  const expanded = expandedDraft(draft.content);
  const submitting =
    sendState?.state === "sending" || sendState?.state === "checking";
  const uncertain = sendState?.state === "unknown";
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
    query: string;
    items: SlashArgument[];
  }>({ query: "", items: [] });
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
  const hasExtension = commands.some(
    (c) => c.name === name && c.category === "extension",
  );
  useEffect(() => {
    let live = true;
    setArgumentState({ query: "", items: [] });
    if (name !== undefined && prefix !== undefined && hasExtension) {
      void rpc.request
        .completeSlashArguments({
          ...slashAddress,
          name,
          argumentPrefix: prefix,
        })
        .then((items) => {
          if (live) setArgumentState({ query, items });
        })
        .catch((error) => {
          if (live) showError(error);
        });
    }
    return () => {
      live = false;
    };
  }, [query, name, prefix, hasExtension, slashAddress]);
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
      : query && argumentState.query === query
        ? argumentState.items.map((item) => ({ ...item, category: undefined }))
        : [];
  const active = Math.min(selected, options.length - 1);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  const extensionSend = !images.length && extensionCommand(expanded, commands);
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
    if (!context || !options[index]) return;
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
  // Background mirror is not the command barrier: send still awaits the ordered CAS queue.
  useEffect(() => {
    if (!draft.dirty || draft.conflict || draft.retired) return;
    const timer = setTimeout(() => {
      void drafts
        .flush(address, (params) => rpc.request.syncDraft(params))
        .then(
          () => setMirrorError(undefined),
          (error) => setMirrorError(String(error)),
        );
    }, 120);
    return () => clearTimeout(timer);
  }, [address, draft]);
  function send() {
    if (
      (!expanded && !images.length) ||
      (!canSend && !extensionSend) ||
      (useStore.getState().modelPending && !extensionSend) ||
      imageBlocked ||
      reading ||
      submitting ||
      uncertain ||
      draft.conflict
    )
      return;
    void sends.send(address).catch(showError);
  }
  async function attach(files: File[]) {
    // Capture the address, not whichever session happens to be active at FileReader completion.
    for (const file of files) {
      if (!imageTypes.has(file.type)) {
        showError(t["Only PNG, JPEG, GIF, and WebP images are supported."]);
        continue;
      }
      if (
        drafts.read(address).content.images.length +
          (pendingReads.get(key) ?? 0) >=
        8
      ) {
        showError(t["You can attach up to 8 images."]);
        continue;
      }
      if (4 * Math.ceil(file.size / 3) > maxBase64) {
        showError(t["Each image must be at most 4.5 MiB of base64 data."]);
        continue;
      }
      changeReads(key, 1);
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).replace(/^data:[^,]*;base64,/, ""));
          reader.onerror = reader.onabort = () =>
            reject(new Error(t["Could not read image."]));
          reader.readAsDataURL(file);
        });
        if (data.length > maxBase64)
          throw new Error(
            t["Each image must be at most 4.5 MiB of base64 data."],
          );
        drafts.edit(address, (content) => ({
          ...content,
          images: [
            ...content.images,
            {
              id: crypto.randomUUID(),
              image: { type: "image", data, mimeType: file.type },
            },
          ],
        }));
      } catch (error) {
        showError(error);
      } finally {
        changeReads(key, -1);
      }
    }
  }
  return (
    <div className="composer-dock" ref={dockRef}>
      <ExtensionWidgets address={address} placement="aboveEditor" />
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
        {images.length > 0 && (
          <div className="composer-attachments">
            {images.map(({ id, image }) => (
              <div className="composer-attachment" key={id}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                />
                <button
                  type="button"
                  aria-label={t["Remove attachment"]}
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
          </div>
        )}
        {options.length > 0 && (
          <div
            className="slash-options"
            id={listId}
            role="listbox"
            aria-label={t.slashSuggestions}
          >
            {options.map((option, index) => (
              <div
                key={`${option.category ?? "argument"}-${option.value}-${option.label}`}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
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
        <textarea
          ref={textareaRef}
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
          rows={2}
          value={text}
          onChange={(event) => {
            const target = event.currentTarget;
            updateSelection(target);
            drafts.edit(address, (content) => ({
              ...content,
              text: target.value,
            }));
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void attach(files);
              return;
            }
            const pasted = event.clipboardData
              .getData("text/plain")
              .replace(/\r\n/g, "\n");
            if (!shouldCollapse(pasted)) return;
            event.preventDefault();
            let id = nextPaste.current++;
            while (
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
            drafts.edit(address, (content) => ({
              ...content,
              text: value.slice(0, start) + marker + value.slice(end),
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
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot.contextUsage} />
            <ModelPicker snapshot={snapshot} />
          </div>
          <div className="send-controls">
            <ComposerSubmit
              busy={transcript.running || submitting}
              hasContent={!!expanded || images.length > 0}
              onStop={() => void rpc.request.abort(address).catch(showError)}
              disabled={
                (!expanded && !images.length) ||
                (!canSend && !extensionSend) ||
                (modelPending && !extensionSend) ||
                imageBlocked ||
                reading > 0 ||
                submitting ||
                uncertain ||
                !!draft.conflict
              }
            />
          </div>
        </div>
      </form>
      <ExtensionWidgets address={address} placement="belowEditor" />
      {sendState?.message && (
        <p className="composer-hint" role="status">
          {sendState.message}
        </p>
      )}
      {uncertain && (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "This send may already have executed. Have you inspected history and do you want to enable a NEW send?",
              )
            )
              sends.confirmNewSend(address);
          }}
        >
          I inspected history — enable a new send
        </button>
      )}
      {sendState?.state === "sending" && (
        <p className="composer-hint" role="status">
          {t["Sending…"]}
        </p>
      )}
      {mirrorError && (
        <p className="composer-hint" role="alert">
          {mirrorError}
        </p>
      )}
      {imageBlocked && (
        <p className="composer-hint">
          {
            t[
              "The current model can't read images. Switch to a vision model or remove the images."
            ]
          }
        </p>
      )}
      {!canSend && !extensionSend && (
        <p className="composer-hint">
          {t["Choose an enabled model to send a message."]}{" "}
          <button type="button" onClick={() => navigate("providers")}>
            {t["Manage models"]}
          </button>
        </p>
      )}
    </div>
  );
}
