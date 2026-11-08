import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Check, Copy, Pencil } from "lucide-react";
import { memo, useCallback, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { sessionIdFromLink } from "../shared/session-links";
import type { Message } from "../shared/transcript";
import { editUserMessage } from "../shared/user-message";
import { ImageGallery } from "./ImageGallery";
import { useT } from "./i18n";
import { openChatLink, regenerate, rpc } from "./rpc";
import { showError } from "./store";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
        img: ({ src }) =>
          typeof src === "string" && src ? (
            <ImageGallery sources={[src]} />
          ) : null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

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
  disabled,
}: {
  message: Extract<Message, { role: "user" }>;
  sessionId: string;
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
          className="user-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || busy || (!draft.trim() && !sources.length)) return;
            setBusy(true);
            void regenerate(sessionId, editUserMessage(message, draft))
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
            rows={4}
          />
          <p className="muted">
            {
              t[
                "Resending replaces the following conversation in this view. Files are not reverted."
              ]
            }
          </p>
          <div className="inline-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {t.Cancel}
            </button>
            <button
              type="submit"
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
          disabled={disabled || busy || editing}
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
  if (!result || typeof result !== "object") return null;
  if ("content" in result && Array.isArray(result.content))
    return <MessageContent content={result.content} markdown={false} />;
  if (!("details" in result)) return null;
  // Malformed tool results must never dump embedded image payloads into the UI.
  let fallback: string | undefined;
  try {
    fallback = JSON.stringify(result.details, (key, value) =>
      key === "data" ? undefined : value,
    );
  } catch {
    return null;
  }
  return fallback ? <pre>{fallback}</pre> : null;
});
