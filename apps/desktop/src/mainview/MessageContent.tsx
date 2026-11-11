import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ChatRendererProps } from "@pig/chat-renderers";
import { Check, Copy, Pencil } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMath } from "../shared/math";
import { sessionIdFromLink } from "../shared/session-links";
import type { Message } from "../shared/transcript";
import { editUserMessage } from "../shared/user-message";
import { ChatContent } from "./ChatContent";
import { dataText } from "./custom-data";
import { ImageGallery } from "./ImageGallery";
import { useT } from "./i18n";
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const focusEditor = useCallback((element: HTMLTextAreaElement | null) => {
    element?.focus();
  }, []);
  const sources = imageSources(content);
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  return (
    <div className="user-turn">
      {sources.length > 0 && <ImageGallery sources={sources} />}
      {editing ? (
        <form
          className="user-edit user-bubble"
          aria-busy={busy || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !entryId ||
              disabled ||
              busy ||
              (!draft.trim() && !sources.length)
            )
              return;
            setBusy(true);
            void regenerate(sessionId, editUserMessage(message, draft), entryId)
              .then(() => setEditing(false))
              .catch(showError)
              .finally(() => setBusy(false));
          }}
        >
          <textarea
            aria-label={t["Edit message"]}
            value={draft}
            ref={focusEditor}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            rows={Math.min(12, Math.max(3, draft.split("\n").length))}
          />
          <div className="user-edit-actions">
            <button type="button" onClick={() => setEditing(false)}>
              {t.Cancel}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={disabled || busy || (!draft.trim() && !sources.length)}
            >
              {t["Save and resend"]}
            </button>
          </div>
        </form>
      ) : (
        text && <div className="user-bubble">{text}</div>
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
          disabled={!entryId || disabled || busy || editing}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
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
