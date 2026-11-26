import { Laptop, Monitor } from "lucide-react";
import { useState } from "react";
import { ContentPage } from "./ContentPage";
import { Presence, RemoveButton } from "./PairingDialogs";
import { SettingsCard } from "./patterns/SettingsCard";
import { Button } from "./primitives/Button";
import { SearchField } from "./primitives/SearchField";
import { SegmentedControl } from "./primitives/SegmentedControl";
import { Switch } from "./primitives/Switch";
import "./remote-pairing-table.css";
const LABEL = "他のPCからの接続を許可";
interface Row {
  id: string;
  name: string;
  out: boolean;
  online?: boolean;
  seen?: string;
  sidebar?: string;
}

/** Adopted layout: one table for both directions. */
export function PairingTable(p: {
  rows: Row[];
  allow: boolean;
  disabled?: boolean;
  notice?: string;
  description?: string;
  leaving?: string[];
  setAllow: (allow: boolean) => void;
  openConnect: () => void;
  openInvite: () => void;
  addProjects?: (id: string) => void;
  removeHost: (id: string) => void;
  removeDevice: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "out" | "in">("all");
  const rows = p.rows.filter(
    (row) =>
      (filter === "all" || row.out === (filter === "out")) &&
      row.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={
        p.description ??
        "招待コードで自分のPC同士を接続し、登録済みのPCを管理します。"
      }
      actions={
        <label className="layout-switch">
          <span>{LABEL}</span>
          <Switch
            aria-label={LABEL}
            checked={p.allow}
            disabled={p.disabled}
            onChange={(event) => p.setAllow(event.target.checked)}
          />
        </label>
      }
    >
      <div className="table-toolbar">
        <SearchField
          className="table-search"
          placeholder="PCを検索"
          aria-label="PCを検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          clearLabel="検索を消去"
        />
        <SegmentedControl
          aria-label="向き"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "すべて" },
            { value: "out", label: "接続先" },
            { value: "in", label: "接続元" },
          ]}
        />
        <span className="table-spacer" />
        <Button disabled={p.disabled} onClick={p.openConnect}>
          PCに接続…
        </Button>
        <Button
          variant="primary"
          disabled={!p.allow || p.disabled}
          onClick={p.openInvite}
        >
          PCを追加…
        </Button>
      </div>
      <SettingsCard className="table-card">
        <table className="pairing-table">
          <thead>
            <tr>
              <th>PC</th>
              <th>向き</th>
              <th>状態</th>
              <th>最終接続</th>
              <th>サイドバー</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.out}:${row.id}`}
                data-leaving={p.leaving?.includes(row.id) || undefined}
              >
                <td>
                  <span className="table-name">
                    {row.out ? (
                      <Monitor size={14} aria-hidden="true" />
                    ) : (
                      <Laptop size={14} aria-hidden="true" />
                    )}
                    {row.name}
                  </span>
                </td>
                <td>
                  <span className="table-dir" data-out={row.out || undefined}>
                    {row.out ? "接続先" : "接続元"}
                  </span>
                </td>
                <td>
                  <span className="mac-row-detail">
                    {row.online === undefined ? (
                      "登録済み"
                    ) : (
                      <Presence online={row.online} />
                    )}
                  </span>
                </td>
                <td className="table-muted">{row.seen || "—"}</td>
                <td className="table-muted">{row.sidebar ?? "—"}</td>
                <td>
                  <span className="mac-row-actions">
                    {row.out && p.addProjects && (
                      <Button
                        disabled={row.online === false}
                        onClick={() => p.addProjects?.(row.id)}
                      >
                        Project…
                      </Button>
                    )}
                    <RemoveButton
                      name={row.name}
                      onRemove={() =>
                        row.out ? p.removeHost(row.id) : p.removeDevice(row.id)
                      }
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="settings-empty" role="status">
            {p.notice ?? "該当するPCはありません。"}
          </p>
        )}
      </SettingsCard>
    </ContentPage>
  );
}
