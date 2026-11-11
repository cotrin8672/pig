import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ChatRendererProps } from "@pig/chat-renderers";
import { Check, Copy, Pencil } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseAnnotations, withAnnotations } from "../shared/annotations";
import { normalizeMath } from "../shared/math";
import { sessionIdFromLink } from "../shared/session-links";
import type { Message } from "../shared/transcript";
import { editUserMessage } from "../shared/user-message";
import { AnnotationCard } from "./AnnotationCards";
import { ChatContent } from "./ChatContent";
import { dataText } from "./custom-data";
import { CodeText } from "./HighlightedCode";
import { ImageGallery } from "./ImageGallery";
import { useT } from "./i18n";
import { editKey, messageEdits } from "./message-edits";
import { openChatLink, regenerate, rpc } from "./rpc";
import { showError } from "./store";
import { createTextSampler } from "./streaming-text";

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
  return <RenderedMarkdown text={streaming ? sample : text} />;
});

const RenderedMarkdown = memo(function RenderedMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <ChatContent kind="markdown" data={{ text }} builtin={BuiltinMarkdown} />
  );
});

export function BuiltinMarkdown({
  data: { text },
}: ChatRendererProps<"markdown">) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      // Invalid TeX renders as red source text instead of throwing.
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      urlTransform={(url) =>
        sessionIdFromLink(url) ? url : defaultUrlTransform(url)
      }
      components={{
        code: ({ className, children }) => (
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
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) {
                if (sessionIdFromLink(href)) void openChatLink(href);
                else rpc.send.openExternal({ url: href });
              }
            }}
          >
            {children}
          </a>
        ),
        img: ({ src, alt }) =>
          typeof src === "string" && src ? (
            <ImageGallery sources={[src]} alt={alt} />
          ) : null,
      }}
    >
      {normalizeMath(text)}
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
  const sources = imageSources(content);
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
  return (
    <div className="user-turn">
      {sources.length > 0 && <ImageGallery sources={sources} />}
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
        shown.body && <div className="user-bubble">{shown.body}</div>
      )}
      <div className="response-actions user-actions">
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </time>
        <button
          type="button"
          title={copied ? t.Copied : t["Copy message"]}
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
          title={t["Edit message"]}
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
}: {
  content: Content;
  markdown?: boolean;
}) {
  const blocks =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  const sources = imageSources(content);
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
            <pre key={index}>{block.text}</pre>
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
