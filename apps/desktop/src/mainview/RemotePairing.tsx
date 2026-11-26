import { useCallback, useEffect, useRef, useState } from "react";
import type { PairingStatus } from "../shared/pairing";
import { ConnectBody, InviteBody, Sheet } from "./PairingDialogs";
import { PairingTable } from "./PairingTable";
import { ConfirmButton } from "./patterns/ConfirmButton";
import { Button } from "./primitives/Button";
import { RemoteProjectPicker } from "./RemoteProjectPicker";
import { refreshRemoteSidebar } from "./remote-workspace";
import { rpc } from "./rpc";
import { showError } from "./store";

const errors = {
  invalid: "招待コードを最後まで貼り付けてください。",
  self: "このPCのコードです。別のPCで発行したコードを使ってください。",
  unreachable:
    "接続先に届きません。相手のPCで接続を許可しているか確認してください。",
  rejected: "コードが無効か期限切れです。新しいコードを作ってください。",
};

export function RemotePairing() {
  const [status, setStatus] = useState<PairingStatus>();
  const [dialog, setDialog] = useState<"connect" | "invite">();
  const [picker, setPicker] = useState<string>();
  const [value, setValue] = useState("");
  const [jobId, setJobId] = useState<number>();
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++revision.current;
    const next = await rpc.request.pairingStatus();
    if (ticket === revision.current) {
      setStatus(next);
      setFailed(false);
    }
    return next;
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        if (!(await refresh()).available) return;
      } catch {
        if (alive) setFailed(true);
      }
      if (alive) timer = setTimeout(update, dialog ? 600 : 5000);
    }
    void update();
    return () => {
      alive = false;
      ++revision.current;
      clearTimeout(timer);
    };
  }, [refresh, dialog]);
  async function act(f: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await f();
      await refresh();
      refreshRemoteSidebar();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  const close = () => setDialog(undefined);
  const invite = status?.invite;
  const job = status?.connect?.id === jobId ? status?.connect : undefined;
  const seen = (time?: number) =>
    time ? new Date(time).toLocaleString() : undefined;
  return (
    <div className="pairing-motion">
      <PairingTable
        addProjects={setPicker}
        disabled={busy || !status?.available || failed}
        allow={!!status?.allow}
        notice={
          failed
            ? "接続情報を読み込めませんでした。"
            : !status
              ? "読み込み中…"
              : !status.available
                ? "PCのペアリングは Windows Tauri 版で利用できます。"
                : undefined
        }
        rows={[
          ...(status?.hosts ?? []).map((h) => ({
            ...h,
            out: true,
            seen: seen(h.lastSeen),
            sidebar: `${h.projects?.length ?? 0} 件`,
          })),
          ...(status?.devices ?? []).map((d) => ({
            ...d,
            out: false,
            seen: seen(d.lastSeen),
          })),
        ]}
        setAllow={(allow) =>
          void act(() => rpc.request.pairingSetAllow({ allow }))
        }
        removeHost={(id) =>
          void act(() => rpc.request.pairingRemoveHost({ id }))
        }
        removeDevice={(id) => void act(() => rpc.request.pairingRevoke({ id }))}
        openInvite={() =>
          void act(async () => {
            const result = await rpc.request.pairingInvite();
            setStatus((old) => old && { ...old, invite: result });
            setDialog("invite");
          })
        }
        openConnect={() => {
          setJobId(
            status?.connect?.state === "connecting"
              ? status.connect.id
              : undefined,
          );
          setValue("");
          setDialog("connect");
        }}
      />
      <Sheet
        open={dialog === "invite"}
        title="PCを追加"
        onClose={close}
        footer={
          invite && !invite.pairedWith ? (
            <ConfirmButton
              disabled={busy}
              onConfirm={() =>
                void act(async () => {
                  await rpc.request.pairingCancelInvite();
                  close();
                })
              }
            >
              コードを取り消す
            </ConfirmButton>
          ) : (
            <Button variant="primary" onClick={close}>
              完了
            </Button>
          )
        }
      >
        {invite ? (
          <InviteBody
            code={invite.code}
            peer={invite.pairedWith}
            stage={
              invite.pairedWith
                ? "paired"
                : copied === invite.code
                  ? "waiting"
                  : "idle"
            }
            left={Math.max(0, Math.ceil((invite.expires - Date.now()) / 1000))}
            onCopy={() => setCopied(invite.code)}
          />
        ) : (
          <p role="status">
            招待が終了しました。新しいコードを作成してください。
          </p>
        )}
      </Sheet>
      <Sheet
        open={dialog === "connect"}
        title="PCに接続"
        onClose={close}
        footer={
          job?.state === "connected" && (
            <>
              <Button onClick={close}>あとで</Button>
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  setPicker(job.hostId);
                }}
              >
                Projectを選ぶ…
              </Button>
            </>
          )
        }
      >
        <ConnectBody
          c={{
            value,
            setValue: (next) => {
              setJobId(undefined);
              setValue(next);
            },
            state: job?.state ?? "input",
            step: job?.step ?? -1,
            host: job?.host,
            errorText: job?.error && errors[job.error],
          }}
          submit={() =>
            void act(async () => {
              const { id } = await rpc.request.pairingConnect({ code: value });
              setJobId(id);
            })
          }
        />
      </Sheet>
      {status?.hosts
        .filter((h) => h.id === picker)
        .map((host) => (
          <RemoteProjectPicker
            key={host.id}
            host={host}
            close={() => {
              setPicker(undefined);
              void refresh().catch(showError);
            }}
          />
        ))}
    </div>
  );
}
