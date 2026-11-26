import {
  Check,
  ChevronDown,
  Folder,
  Laptop,
  MessageSquare,
  Monitor,
  Plus,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { usePicker } from "../../mainview/Picker";
import { SearchField } from "../../mainview/primitives/SearchField";
import "../motion/snappy-motion.css";
import "./chat-target.css";

export type TargetOption = {
  id: string;
  name: string;
  detail?: string;
  icon: ReactNode;
  disabled?: boolean;
};
export type TargetGroup = { title?: string; options: TargetOption[] };

/**
 * One chip of the tray: the shared picker (details + panel + inline search),
 * laid out like the model picker's result list.
 */
function TargetPicker({
  label,
  trigger,
  groups,
  value,
  onSelect,
  action,
}: {
  label: string;
  trigger: ReactNode;
  groups: TargetGroup[];
  value: string;
  onSelect: (id: string) => void;
  action?: { label: string; onClick: () => void };
}) {
  const { ref, close } = usePicker();
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((o) => o.name.toLowerCase().includes(q)),
    }))
    .filter((group) => group.options.length);
  const flat = visible
    .flatMap((group) => group.options)
    .filter((o) => !o.disabled);
  function choose(option?: TargetOption) {
    if (!option || option.disabled) return;
    onSelect(option.id);
    close();
  }
  return (
    <details
      ref={ref}
      className="picker chat-target-picker"
      onToggle={() => {
        const isOpen = !!ref.current?.open;
        setOpen(isOpen);
        if (isOpen) {
          setQuery("");
          setActive(
            Math.max(
              0,
              flat.findIndex((o) => o.id === value),
            ),
          );
          search.current?.focus();
        }
      }}
    >
      <summary className="picker-trigger" aria-label={label}>
        {trigger}
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      {open && (
        <div className="picker-panel model-panel chat-target-panel">
          <SearchField
            variant="inline"
            className="model-search"
            ref={search}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${label}を検索`}
            placeholder="検索"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (i) => (i + step + flat.length) % Math.max(1, flat.length),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(flat[active]);
              }
            }}
          />
          <div
            id={listId}
            className="model-results chat-target-results"
            role="listbox"
            aria-label={label}
          >
            {visible.map((group) => (
              <fieldset
                key={group.title ?? "all"}
                className="chat-target-group"
                aria-label={group.title}
              >
                {group.title && (
                  <div className="picker-group-title">{group.title}</div>
                )}
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    className="model-option"
                    aria-selected={option.id === value}
                    aria-checked={option.id === value}
                    disabled={option.disabled}
                    data-highlighted={
                      flat[active]?.id === option.id || undefined
                    }
                    onMouseEnter={() => setActive(flat.indexOf(option))}
                    onClick={() => choose(option)}
                  >
                    {option.icon}
                    <span className="model-option-name">{option.name}</span>
                    {option.detail && (
                      <span className="model-capabilities">
                        <small>{option.detail}</small>
                      </span>
                    )}
                    <span className="model-selected-mark">
                      {option.id === value && (
                        <Check size={13} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                ))}
              </fieldset>
            ))}
            {!visible.length && (
              <p className="picker-empty">一致するものはありません</p>
            )}
          </div>
          {action && (
            <button
              type="button"
              className="model-option chat-target-action"
              onClick={() => {
                close();
                action.onClick();
              }}
            >
              <Plus size={13} aria-hidden="true" />
              {action.label}
            </button>
          )}
        </div>
      )}
    </details>
  );
}

export type ChatPC = {
  id: string;
  name: string;
  local?: boolean;
  online: boolean;
};
export type ChatTarget = { pc: string; project?: string };

/**
 * Shown on the composer of a new chat only: where it will run (PC) and in which
 * project. Once the first message is sent the chat is bound and the tray goes away.
 */
export function ChatTargetTray({
  pcs,
  projects,
  value,
  onChange,
  onConnect,
  onAddProject,
}: {
  pcs: ChatPC[];
  /** Project paths per PC; a missing project means "chat without a project". */
  projects: Record<string, { id: string; name: string; detail?: string }[]>;
  value: ChatTarget;
  onChange: (target: ChatTarget) => void;
  onConnect: () => void;
  onAddProject: (pc: string) => void;
}) {
  const pc = pcs.find((item) => item.id === value.pc) ?? pcs[0];
  const list = projects[pc.id] ?? [];
  const project = list.find((item) => item.id === value.project);
  const pcIcon = (item: ChatPC) =>
    item.local ? (
      <Laptop size={13} aria-hidden="true" />
    ) : (
      <Monitor size={13} aria-hidden="true" />
    );
  return (
    <fieldset
      className="message-queue chat-target"
      aria-label="新しいチャットの実行先"
    >
      <TargetPicker
        label={`PC: ${pc.name}`}
        trigger={
          <>
            <span className="chat-target-pc">
              {pcIcon(pc)}
              <span
                className="chat-target-dot"
                data-online={pc.online || undefined}
              />
            </span>
            <span className="chat-target-label">{pc.name}</span>
          </>
        }
        value={pc.id}
        groups={[
          {
            options: pcs
              .filter((item) => item.local)
              .map((item) => ({
                ...item,
                icon: pcIcon(item),
                detail: "このPC",
              })),
          },
          {
            title: "接続先のPC",
            options: pcs
              .filter((item) => !item.local)
              .map((item) => ({
                ...item,
                icon: pcIcon(item),
                detail: item.online ? "接続中" : "オフライン",
                disabled: !item.online,
              })),
          },
        ]}
        onSelect={(id) => onChange({ pc: id, project: projects[id]?.[0]?.id })}
        action={{ label: "PCに接続…", onClick: onConnect }}
      />
      <span className="chat-target-sep" aria-hidden="true" />
      <TargetPicker
        label={`Project: ${project?.name ?? "Projectなし"}`}
        trigger={
          <span key={`${pc.id}:${value.project}`} className="chat-target-swap">
            {project ? (
              <Folder size={13} aria-hidden="true" />
            ) : (
              <MessageSquare size={13} aria-hidden="true" />
            )}
            <span className="chat-target-label">
              {project?.name ?? "Projectなし"}
            </span>
          </span>
        }
        value={value.project ?? ""}
        groups={[
          {
            options: [
              {
                id: "",
                name: "Projectなし",
                icon: <MessageSquare size={13} aria-hidden="true" />,
              },
            ],
          },
          {
            title: `${pc.name}のProject`,
            options: list.map((item) => ({
              ...item,
              icon: <Folder size={13} aria-hidden="true" />,
            })),
          },
        ]}
        onSelect={(id) => onChange({ pc: pc.id, project: id || undefined })}
        action={{
          label: `${pc.name}のProjectを追加…`,
          onClick: () => onAddProject(pc.id),
        }}
      />
    </fieldset>
  );
}
