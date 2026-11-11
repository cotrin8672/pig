import { memo, useSyncExternalStore } from "react";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { dataText } from "./custom-data";
import { drafts, type EditorDraft, expandedDraft } from "./draft-store";
import { ImageGallery } from "./ImageGallery";
import { useT } from "./i18n";
import { LazyDetails as Disclosure } from "./LazyDetails";
import { rpc, sends } from "./rpc";
import type { SendState } from "./send-controller";
import { showError, useStore } from "./store";

function currentAddress() {
  const state = useStore.getState();
  const active = state.active ? state.snapshots[state.active] : undefined;
  return active?.ready === false ? undefined : active?.address;
}
const RecoveryContent = memo(function RecoveryContent({
  content,
}: {
  content: EditorDraft["content"];
}) {
  const t = useT();
  return (
    <>
      <pre>{expandedDraft(content)}</pre>
      <ImageGallery
        sources={content.images.map(
          ({ image }) => `data:${image.mimeType};base64,${image.data}`,
        )}
      />
      <Disclosure summary={t.recoveryRaw}>
        {() => <pre>{dataText(content)}</pre>}
      </Disclosure>
    </>
  );
});
const SendItem = memo(function SendItem({
  send,
  activeKey,
}: {
  send: SendState;
  activeKey?: string;
}) {
  const t = useT();
  return (
    <Disclosure
      summary={
        <>
          {send.key.sessionId}:{" "}
          {send.recoveredQueue
            ? t.recoveryQueued
            : send.state === "checking"
              ? t.recoveryPending
              : t.recoveryUnknown}
        </>
      }
    >
      {() => (
        <>
          <p role="status">
            {send.message ??
              (send.recoveryReason === "prepared"
                ? t.recoveryPrepared
                : send.recoveryReason === "lookup-timeout"
                  ? t.recoveryLookupTimeout
                  : t.recoveryInspect)}
          </p>
          <p>{t.recoveryRequest(send.key.requestId)}</p>
          {send.owner && (
            <p>
              {t.recoveryOwner(send.owner.cwd, send.owner.branchId ?? "root")}
            </p>
          )}
          {send.content && <RecoveryContent content={send.content} />}
          <button
            type="button"
            onClick={() => void sends.lookup(send.key, send.key)}
          >
            {t.recoveryCheck}
          </button>
          {send.content && (
            <button
              type="button"
              disabled={!activeKey}
              onClick={() => {
                const active = currentAddress();
                const content = send.content;
                if (active && content && window.confirm(t.recoveryCopyConfirm))
                  drafts.edit(active, () => content);
              }}
            >
              {t.recoveryCopy}
            </button>
          )}
        </>
      )}
    </Disclosure>
  );
});
const DraftItem = memo(function DraftItem({
  address,
  draft,
  activeKey,
}: {
  address: SessionAddress;
  draft: EditorDraft;
  activeKey?: string;
}) {
  const t = useT();
  return (
    <Disclosure
      summary={
        <>
          {address.sessionId} · epoch {address.epoch}
        </>
      }
    >
      {() => (
        <>
          {draft.owner && (
            <p>
              {t.recoveryOwner(draft.owner.cwd, draft.owner.branchId ?? "root")}
            </p>
          )}
          <RecoveryContent content={draft.content} />
          <button
            type="button"
            disabled={!activeKey}
            onClick={() => {
              const active = currentAddress();
              if (active && window.confirm(t.recoveryCopyConfirm))
                drafts.edit(active, () => draft.content);
            }}
          >
            {t.recoveryCopy}
          </button>
          <button
            type="button"
            disabled={!activeKey}
            onClick={() => {
              const active = currentAddress();
              if (active && window.confirm(t.recoveryDiscardConfirm))
                void rpc.request
                  .discardRecovery({ current: active, retained: address })
                  .then(() => {
                    drafts.discard(address);
                    sends.discard(address);
                  })
                  .catch(showError);
            }}
          >
            {t.recoveryDiscard}
          </button>
        </>
      )}
    </Disclosure>
  );
});
/** Old operations retain their original identities; closed details do no payload work. */
export function DraftRecovery() {
  const t = useT();
  useSyncExternalStore(drafts.subscribe, drafts.getTick, drafts.getTick);
  useSyncExternalStore(sends.subscribe, sends.getTick, sends.getTick);
  const activeKey = useStore((state) => {
    const active = state.active ? state.snapshots[state.active] : undefined;
    return active && active.ready !== false
      ? addressKey(active.address)
      : undefined;
  });
  const retained = drafts.retained();
  const unconfirmed = sends.retained();
  if (!retained.length && !unconfirmed.length) return null;
  return (
    <Disclosure
      className="draft-recovery"
      summary={t.sendRecovery(unconfirmed.length, retained.length)}
    >
      {() => (
        <>
          {unconfirmed.map((send) => (
            <SendItem
              key={JSON.stringify(send.key)}
              send={send}
              activeKey={activeKey}
            />
          ))}
          {retained.length > 0 && <p>{t.recoveryRetainedInfo}</p>}
          {retained.map(({ address, draft }) => (
            <DraftItem
              key={addressKey(address)}
              address={address}
              draft={draft}
              activeKey={activeKey}
            />
          ))}
        </>
      )}
    </Disclosure>
  );
}
