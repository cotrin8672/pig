import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import type { PairingHost } from "../shared/pairing";
import type { RemoteProject } from "../shared/remote-workspace";
import { Sheet } from "./PairingDialogs";
import { Button } from "./primitives/Button";
import { Checkbox } from "./primitives/Checkbox";
import { IconButton } from "./primitives/IconButton";
import { SegmentedControl } from "./primitives/SegmentedControl";
import { refreshRemoteSidebar, remote } from "./remote-workspace";
import { rpc } from "./rpc";

export function RemoteProjectPicker({
  host,
  close,
}: {
  host: PairingHost;
  close: () => void;
}) {
  const [tab, setTab] = useState<"projects" | "folders">("projects");
  const [trail, setTrail] = useState<RemoteProject[]>([]);
  const [items, setItems] = useState<RemoteProject[]>();
  const [selected, setSelected] = useState(host.projects ?? []);
  const [folder, setFolder] = useState<RemoteProject>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parent = trail.at(-1);
  useEffect(() => {
    let active = true;
    setItems(undefined);
    setError("");
    setFolder(undefined);
    remote(
      host.id,
      tab === "projects"
        ? { op: "projects" }
        : { op: "folders", parent: parent?.id },
    ).then(
      (result) => {
        if (active) setItems(result);
      },
      () => {
        if (active)
          setError("一覧を取得できませんでした。接続先を確認してください。");
      },
    );
    return () => {
      active = false;
    };
  }, [tab, parent, host.id]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const project =
        tab === "folders" && folder
          ? await remote(host.id, { op: "addFolder", folder: folder.id })
          : undefined;
      const projects = project
        ? [...selected.filter((p) => p.id !== project.id), project]
        : selected;
      await rpc.request.remoteProjectsSave({ id: host.id, projects });
      refreshRemoteSidebar();
      close();
    } catch {
      setError("保存できませんでした。接続先を確認してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      wide
      title={`${host.name}から追加`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>キャンセル</Button>
          <Button
            variant="primary"
            disabled={busy || !items || (tab === "folders" && !folder)}
            onClick={() => void save()}
          >
            {tab === "folders" ? "このフォルダーを追加" : "選択を保存"}
          </Button>
        </>
      }
    >
      <SegmentedControl
        aria-label="追加するもの"
        value={tab}
        onChange={setTab}
        options={[
          { value: "projects", label: "既存のProject" },
          { value: "folders", label: "フォルダーを選択" },
        ]}
      />
      {tab === "folders" && (
        <div className="input-row">
          <IconButton
            aria-label="上のフォルダーへ"
            disabled={!parent}
            onClick={() => setTrail(trail.slice(0, -1))}
          >
            <ChevronLeft size={14} />
          </IconButton>
          {parent?.name ?? "接続先で登録済みのProject"}
        </div>
      )}
      <div className="remote-project-options">
        {items?.map((p) =>
          tab === "projects" ? (
            <label key={p.id}>
              <Checkbox
                checked={selected.some((s) => s.id === p.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, p]
                      : selected.filter((s) => s.id !== p.id),
                  )
                }
              />
              {p.name}
            </label>
          ) : (
            <div key={p.id} className="input-row">
              <Button
                aria-pressed={folder?.id === p.id}
                onClick={() => setFolder(p)}
              >
                <Folder size={14} />
                {p.name}
              </Button>
              <IconButton
                aria-label={`${p.name}を開く`}
                onClick={() => setTrail([...trail, p])}
              >
                <ChevronRight size={14} />
              </IconButton>
            </div>
          ),
        )}
      </div>
      <p className="mac-note" role="status">
        {error ||
          (!items
            ? "読み込み中…"
            : !items.length
              ? "選択できる項目はありません。"
              : "ファイルと実行は接続先のPCに残ります。")}
      </p>
    </Sheet>
  );
}
