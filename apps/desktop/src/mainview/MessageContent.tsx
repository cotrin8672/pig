import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ChatRendererProps } from "@pig/chat-renderers";
import type { Root } from "hast";
import { Check, Copy, Pencil } from "lucide-react";
import {
  createContext,
  Fragment,
  memo,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseAnnotations, withAnnotations } from "../shared/annotations";
import { splitAttachmentPaths } from "../shared/attachments";
import { isFileLink } from "../shared/file-links";
import { composerAction } from "../shared/keymap";
import { normalizeMath } from "../shared/math";
import { sessionIdFromLink } from "../shared/session-links";
import type { Message } from "../shared/transcript";
import { editUserMessage } from "../shared/user-message";
import { AnnotationCard } from "./AnnotationCards";
import { ChatContent } from "./ChatContent";
import { insertEditorNewline } from "./ComposerEditor";
import { dataText } from "./custom-data";
import { CodeText } from "./HighlightedCode";
import { ImageGallery } from "./ImageGallery";
import { useT } from "./i18n";
import { MarkdownBlockquote, MarkdownPre } from "./MarkdownBlocks";
import { markdownExtensions } from "./markdown-extensions";
import {
  browserMarkdown,
  cachedMarkdown,
  plainMarkdown,
  prepareMarkdown,
  retainedMarkdown,
} from "./markdown-processing";
import { markdownUrl } from "./markdown-url";
import { editKey, messageEdits } from "./message-edits";
import { positionedKatex } from "./positioned-katex";
import { openChatLink, regenerate, rpc } from "./rpc";
import { SentAttachments } from "./SentAttachments";
import { showError, useStore } from "./store";
import { createTextSampler } from "./streaming-text";
import { clipTooltipText, type TooltipAnchor, useTooltip } from "./Tooltip";

const MarkdownStreaming = createContext(false);
export const MarkdownCwd = createContext<string | undefined>(undefined);
const InsideMarkdownLink = createContext(false);

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [sample, setSample] = useState(text);
  const sampler = useMemo(() => createTextSampler(setSample), []);
  useEffect(() => {
    sampler.update(text, streaming);
  }, [sampler, text, streaming]);
  useEffect(() => () => sampler.dispose(), [sampler]);
  return (
    <RenderedMarkdown text={streaming ? sample : text} streaming={streaming} />
  );
});

const RenderedMarkdown = memo(function RenderedMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <MarkdownStreaming.Provider value={streaming}>
      <ChatContent kind="markdown" data={{ text }} builtin={BuiltinMarkdown} />
    </MarkdownStreaming.Provider>
  );
});

// Stable component types preserve code/image DOM, highlight work and selection
// while streaming. Inline component functions remount every Markdown update.
// Inline code holding an absolute Windows path (drive or UNC). Fenced blocks
// always end with a newline, so they never match.
const LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^<>"|?*\n]*$/;

/** Hover summary of where a link goes and what clicking does. */
function linkTip(
  t: ReturnType<typeof useT>,
  href: string,
  kind: "file" | "chat" | "web",
): TooltipAnchor {
  let label = href;
  if (kind === "web")
    try {
      label = new URL(href).host || href;
    } catch {}
  else if (kind === "file") {
    let path = href.split(/[?#]/, 1)[0];
    try {
      path = decodeURIComponent(path);
    } catch {}
    label = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }
  return {
    tier: "detail",
    side: "top",
    label: clipTooltipText(label),
    description:
      kind === "file"
        ? t["Show in Explorer"]
        : kind === "chat"
          ? t["Open chat"]
          : t["Open in browser"],
    code: href.length > 400 ? `${href.slice(0, 399)}…` : href,
  };
}

export const markdownComponents: Components = {
  pre: MarkdownPre,
  blockquote: MarkdownBlockquote,
  table: ({ children }) => (
    <div className="markdown-table-scroll">
      <table>{children}</table>
    </div>
  ),
  code: function MarkdownCode({ className, children }) {
    const linked = useContext(InsideMarkdownLink);
    const t = useT();
    const tooltip = useTooltip();
    if (
      !linked &&
      !className &&
      typeof children === "string" &&
      LOCAL_PATH.test(children)
    )
      return (
        // biome-ignore lint/a11y/useValidAnchor: Keyboard-accessible native link; the WebView must not navigate to the file URL.
        <a
          href="#"
          {...tooltip(() => linkTip(t, children, "file"))}
          onClick={(e) => {
            e.preventDefault();
            rpc.send.revealPath({ path: children });
          }}
        >
          <code>{children}</code>
        </a>
      );
    return (
      <code className={className}>
        {typeof children === "string" ? (
          <CodeText
            text={children}
            language={/(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1]}
          />
        ) : (
          children
        )}
      </code>
    );
  },
  a: function MarkdownLink({ href, children, id, ...props }) {
    const cwd = useContext(MarkdownCwd);
    const t = useT();
    const tooltip = useTooltip();
    const file = href !== undefined && isFileLink(href);
    const kind = file
      ? "file"
      : href && sessionIdFromLink(href)
        ? "chat"
        : "web";
    const tip =
      href && !href.startsWith("#")
        ? tooltip(() => linkTip(t, href, kind))
        : {};
    return (
      <a
        href={file ? "#" : href || undefined}
        {...tip}
        // Footnote anchors: jump targets and their accessible relations.
        id={id}
        aria-describedby={props["aria-describedby"]}
        aria-label={props["aria-label"]}
        data-footnote-ref={
          (props as Record<string, unknown>)["data-footnote-ref"] as string
        }
        data-footnote-backref={
          (props as Record<string, unknown>)["data-footnote-backref"] as string
        }
        onClick={(e) => {
          e.preventDefault();
          if (!href) return;
          // Footnote ids repeat; resolve within this Markdown body.
          if (href.startsWith("#")) {
            const id = decodeURIComponent(href.slice(1));
            (e.currentTarget.closest(".prose") ?? document)
              .querySelector(`#${CSS.escape(id)}`)
              ?.scrollIntoView({ block: "center" });
          } else if (file) rpc.send.revealPath({ href, cwd });
          else if (sessionIdFromLink(href)) void openChatLink(href);
          else rpc.send.openExternal({ url: href });
        }}
      >
        <InsideMarkdownLink.Provider value={true}>
          {children}
        </InsideMarkdownLink.Provider>
      </a>
    );
  },
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <ImageGallery sources={[src]} alt={alt} />
    ) : null,
};

// Reuse post-processing only for the same parsed tree in this mounted instance.
// No shared JSX/DOM cache: child state, context and renderer changes still apply.
const MarkdownTree = memo(function MarkdownTree({ tree }: { tree: Root }) {
  // Feed the worker's HAST through react-markdown's own safe post-processing
  // and existing React components, rather than replacing DOM with HTML strings.
  const plugins = useMemo(() => [() => () => tree], [tree]);
  return (
    <ReactMarkdown
      rehypePlugins={plugins}
      components={markdownComponents}
      urlTransform={markdownUrl}
    >
      {""}
    </ReactMarkdown>
  );
});

export function BuiltinMarkdown({
  data: { text },
}: ChatRendererProps<"markdown">) {
  const streaming = useContext(MarkdownStreaming);
  const source = useMemo(() => normalizeMath(text), [text]);
  const plain = useMemo(() => plainMarkdown(source), [source]);
  const [result, setResult] = useState<
    { text: string; streaming: boolean; tree: Root } | undefined
  >(() => {
    const cached = cachedMarkdown(source, streaming);
    return cached ? { text: source, streaming, tree: cached.tree } : undefined;
  });
  const [error, setError] = useState<unknown>();
  const committed = useRef<{ text: string; tree: Root } | undefined>(undefined);
  useEffect(() => {
    if (!browserMarkdown() || plain) return;
    const controller = new AbortController();
    void prepareMarkdown(source, controller.signal, streaming).then(
      (parsed) => {
        if (parsed && !controller.signal.aborted)
          startTransition(() =>
            setResult({ text: source, streaming, tree: parsed.tree }),
          );
      },
      (failure) => {
        if (!controller.signal.aborted) setError(failure);
      },
    );
    return () => controller.abort();
  }, [source, plain, streaming]);
  const exact =
    plain ??
    cachedMarkdown(source, streaming)?.tree ??
    (result?.text === source && result.streaming === streaming
      ? result.tree
      : undefined);
  useLayoutEffect(() => {
    if (exact) committed.current = { text: source, tree: exact };
  }, [source, exact]);
  if (error) throw error;
  if (exact)
    return (
      <Fragment key="markdown-body">
        <MarkdownTree tree={exact} />
      </Fragment>
    );
  if (browserMarkdown()) {
    const retained = retainedMarkdown(source, committed.current ?? result);
    const tailTree = retained.tail ? plainMarkdown(retained.tail) : undefined;
    return (
      <Fragment key="markdown-body">
        {retained.tree && <MarkdownTree tree={retained.tree} />}
        {retained.tail &&
          (tailTree ? (
            <MarkdownTree tree={tailTree} />
          ) : (
            <span className="markdown-pending-source">{retained.tail}</span>
          ))}
      </Fragment>
    );
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      // Invalid TeX renders as red source text instead of throwing.
      rehypePlugins={[
        [positionedKatex, { streaming }],
        [markdownExtensions, { streaming }],
      ]}
      urlTransform={markdownUrl}
      components={markdownComponents}
    >
      {source}
    </ReactMarkdown>
  );
}

type Content = string | (TextContent | ImageContent)[];

const isImage = (block: unknown): block is ImageContent =>
  !!block &&
  typeof block === "object" &&
  "type" in block &&
  block.type === "image" &&
  "data" in block &&
  typeof block.data === "string" &&
  "mimeType" in block &&
  typeof block.mimeType === "string";
const imageSources = (content: Content) =>
  typeof content === "string"
    ? []
    : content
        .filter(isImage)
        .map((image) => `data:${image.mimeType};base64,${image.data}`);

/** User turns: images above a plain-text bubble, like ChatGPT. */
export const UserMessage = memo(function UserMessage({
  message,
  sessionId,
  entryId,
  disabled,
}: {
  message: Extract<Message, { role: "user" }>;
  sessionId: string;
  entryId?: string;
  disabled: boolean;
}) {
  const { content } = message;
  const t = useT();
  const key = entryId ? editKey(sessionId, entryId) : "";
  const readEdit = () => (key ? messageEdits.read(key) : undefined);
  const edit = useSyncExternalStore(messageEdits.subscribe, readEdit, readEdit);
  const editing = edit?.state === "editing";
  const draft = edit?.text ?? "";
  const setDraft = (text: string) =>
    messageEdits.set(key, { text, state: "editing" });
  const [copied, setCopied] = useState(false);
  const focusEditor = useCallback((element: HTMLTextAreaElement | null) => {
    element?.focus();
  }, []);
  const sources = useMemo(() => imageSources(content), [content]);
  const original =
    typeof content === "string"
      ? content
      : content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  // A resend in progress shows its edited text in place until the rewind lands.
  const text = edit?.state === "sending" ? edit.text : original;
  // Editing touches only the body; annotation blocks ride along unchanged.
  const parsed = parseAnnotations(original);
  const shown = parseAnnotations(text);
  const attachments = splitAttachmentPaths(shown.body);
  return (
    <div className="user-turn">
      {sources.length > 0 && <ImageGallery sources={sources} />}
      {!editing && attachments.paths.length > 0 && (
        <SentAttachments paths={attachments.paths} />
      )}
      {shown.annotations.length > 0 && (
        <ul className="user-annotations">
          {shown.annotations.map((annotation, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: annotations are fixed once sent.
            <AnnotationCard key={index} {...annotation} />
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="user-edit user-bubble"
          onSubmit={(event) => {
            event.preventDefault();
            if (!entryId || disabled || (!draft.trim() && !sources.length))
              return;
            const text = withAnnotations(draft, parsed.annotations);
            messageEdits.set(key, { text, state: "sending" });
            void regenerate(sessionId, editUserMessage(message, text), entryId)
              .then(() => {
                if (messageEdits.read(key)?.state === "sending")
                  messageEdits.set(key, undefined);
              })
              .catch((error) => {
                messageEdits.set(key, { text: draft, state: "editing" });
                showError(error);
              });
          }}
        >
          <textarea
            aria-label={t["Edit message"]}
            value={draft}
            ref={focusEditor}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              const action = composerAction(
                event,
                useStore.getState().settings.keybindings,
              );
              if (!action) return;
              event.preventDefault();
              if (action === "composer.newline")
                insertEditorNewline(event.currentTarget, setDraft);
              else if (!event.repeat) event.currentTarget.form?.requestSubmit();
            }}
            rows={Math.min(12, Math.max(3, draft.split("\n").length))}
          />
          <div className="user-edit-actions">
            <button
              type="button"
              onClick={() => messageEdits.set(key, undefined)}
            >
              {t.Cancel}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={disabled || (!draft.trim() && !sources.length)}
            >
              {t["Save and resend"]}
            </button>
          </div>
        </form>
      ) : (
        attachments.body && (
          <div className="user-bubble">{attachments.body}</div>
        )
      )}
      <div className="response-actions user-actions">
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </time>
        <button
          type="button"
          aria-label={copied ? t.Copied : t["Copy message"]}
          disabled={!text}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch (error) {
              showError(error);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          aria-label={t["Edit message"]}
          disabled={!entryId || disabled || !!edit}
          onClick={() => setDraft(parsed.body)}
        >
          <Pencil size={14} />
        </button>
      </div>
    </div>
  );
});

export const MessageContent = memo(function MessageContent({
  content,
  markdown = true,
  language,
}: {
  content: Content;
  markdown?: boolean;
  language?: string;
}) {
  const blocks =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  const sources = useMemo(() => imageSources(content), [content]);
  const firstImage = blocks.findIndex(isImage);
  return (
    <div className={`message-content ${markdown ? "prose" : "literal"}`}>
      {blocks.map((block, index) => {
        if (!block || typeof block !== "object") return null;
        if (
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string"
        )
          return markdown ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: SDK content blocks retain their indexes.
            <Markdown key={index} text={block.text} />
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: SDK content blocks retain their indexes.
            <pre key={index}>
              {language ? (
                <CodeText text={block.text} language={language} />
              ) : (
                block.text
              )}
            </pre>
          );
        // All images of a message share one gallery, placed at the first image.
        if (index === firstImage)
          return <ImageGallery key="images" sources={sources} />;
        return null;
      })}
    </div>
  );
});

export const ToolResultContent = memo(function ToolResultContent({
  result,
}: {
  result: unknown;
}) {
  if (!result || typeof result !== "object")
    return result === undefined ? null : <pre>{dataText(result)}</pre>;
  return (
    <>
      {"content" in result && Array.isArray(result.content) && (
        <MessageContent content={result.content} markdown={false} />
      )}
      {"isError" in result && result.isError === true && (
        <p className="error">Tool failed</p>
      )}
      {!("content" in result) && !("details" in result) && (
        <pre>{dataText(result)}</pre>
      )}
    </>
  );
});
