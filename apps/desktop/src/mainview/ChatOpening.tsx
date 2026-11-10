import { useSyncExternalStore } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ComposerEditor } from "./ComposerEditor";
import { ComposerFrame } from "./ComposerFrame";
import { ComposerSubmit } from "./ComposerSubmit";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { drafts } from "./draft-store";
import { useT } from "./i18n";
import { ModelPicker } from "./ModelPicker";
import { useStore } from "./store";
import "./composer.css";

export function OpeningComposer({ preview }: { preview?: Snapshot }) {
  const t = useT();
  const target = useStore((s) => s.openingTarget);
  const stored = useStore((s) =>
    target?.id ? s.snapshots[target.id] : undefined,
  );
  const snapshot = preview ?? stored;
  const newText = useStore((s) =>
    target ? (s.newChatDrafts[target.cwd] ?? "") : "",
  );
  const readText = () =>
    snapshot ? drafts.read(snapshot.address).content.text : "";
  const existingText = useSyncExternalStore(
    drafts.subscribe,
    readText,
    readText,
  );
  const existing = !!preview || !!target?.id;
  const text = existing ? existingText : newText;
  const viewKey = snapshot
    ? addressKey(snapshot.address)
    : target?.id
      ? `opening:${target.id}`
      : `new:${target?.cwd}`;
  return (
    <ComposerFrame>
      <form className="composer" onSubmit={(event) => event.preventDefault()}>
        <ComposerEditor
          viewKey={viewKey}
          aria-label={t.Message}
          placeholder={t["Ask anything, or describe what to build…"]}
          value={text}
          readOnly={
            existing && (!snapshot || drafts.read(snapshot.address).retired)
          }
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (existing) {
              if (snapshot)
                drafts.edit(snapshot.address, (content) => ({
                  ...content,
                  text: value,
                }));
            } else if (target)
              useStore.setState((s) => ({
                newChatDrafts: { ...s.newChatDrafts, [target.cwd]: value },
              }));
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            )
              event.preventDefault();
          }}
        />
        <div className="composer-toolbar">
          <span className="sr-only" role="status">
            {t["Opening chat…"]}
          </span>
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot?.contextUsage} />
            <ModelPicker selection={target?.selection ?? snapshot} />
          </div>
          <div className="send-controls">
            <ComposerSubmit
              busy={false}
              hasContent={!!text}
              disabled
              onStop={() => {}}
            />
          </div>
        </div>
      </form>
    </ComposerFrame>
  );
}

export function ChatOpening() {
  const target = useStore((s) => s.openingTarget);
  const message = useStore((s) => s.openMessage);
  return (
    <ChatLayout loading composer={<OpeningComposer />}>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {!target?.id && <ChatEmpty cwd={target?.cwd} />}
    </ChatLayout>
  );
}
