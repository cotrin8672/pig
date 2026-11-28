import {
  ChevronDown,
  Folder,
  Laptop,
  MessageSquare,
  Monitor,
  Plus,
} from "lucide-react";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";
import { IndicatorDot } from "./IndicatorDot";
import { useT } from "./i18n";
import { usePicker } from "./Picker";
import { PickerOption } from "./patterns/PickerOption";
import { SearchField } from "./primitives/SearchField";
import "./chat-target.css";

type TargetOption = {
  id: string;
  name: string;
  detail?: string;
  icon: ReactNode;
  disabled?: boolean;
};
type TargetGroup = { title?: string; options: TargetOption[] };

/**
 * One chip of the tray: the shared picker (details + panel + inline search),
 * laid out like the model picker's result list.
 */
function TargetPicker({
  label,
  description,
  trigger,
  groups,
  value,
  onSelect,
  action,
}: {
  label: string;
  description?: string;
  trigger: ReactNode;
  groups: TargetGroup[];
  value: string;
  onSelect: (id: string) => void;
  action?: { label: string; onClick: () => void };
}) {
  const t = useT();
  const { ref, close } = usePicker();
  const results = useRef<HTMLDivElement>(null);
  const focusSearch = useCallback(
    (input: HTMLInputElement | null) => input?.focus(),
    [],
  );
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const visible = (open ? groups : [])
    .map((group) => ({
      ...group,
      options: group.options.filter((o) => o.name.toLowerCase().includes(q)),
    }))
    .filter((group) => group.options.length);
  const flat = visible
    .flatMap((group) => group.options)
    .filter((o) => !o.disabled);
  const positions = new Map(flat.map((option, i) => [option, i]));
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
              groups
                .flatMap((g) => g.options)
                .filter((o) => !o.disabled)
                .findIndex((o) => o.id === value),
            ),
          );
        }
      }}
    >
      <summary
        className="picker-trigger"
        aria-label={label}
        aria-description={description}
      >
        {trigger}
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      {open && (
        <div className="picker-panel model-panel chat-target-panel">
          <SearchField
            variant="inline"
            className="model-search"
            ref={focusSearch}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              flat[active] ? `${listId}-${active}` : undefined
            }
            aria-label={`${t.Search}: ${label}`}
            placeholder={t.Search}
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
                const next =
                  (Math.max(active, 0) + step + flat.length) %
                  Math.max(1, flat.length);
                setActive(next);
                results.current
                  ?.querySelectorAll('[role="option"]:not(:disabled)')
                  [next]?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(flat[active]);
              }
            }}
          />
          <div
            id={listId}
            ref={results}
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
                  <PickerOption
                    key={option.id}
                    id={
                      !option.disabled
                        ? `${listId}-${positions.get(option)}`
                        : undefined
                    }
                    label={option.name}
                    icon={option.icon}
                    detail={option.detail && <small>{option.detail}</small>}
                    selected={option.id === value}
                    disabled={option.disabled}
                    highlighted={flat[active]?.id === option.id}
                    onMouseEnter={() => {
                      setActive(positions.get(option) ?? active);
                    }}
                    onClick={() => choose(option)}
                  />
                ))}
              </fieldset>
            ))}
            {!visible.length && (
              <p className="picker-empty">{t.chatTargetNoMatches}</p>
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
  busy,
}: {
  pcs: ChatPC[];
  /** Project paths per PC; a missing project means "chat without a project". */
  projects: Record<string, { id: string; name: string; detail?: string }[]>;
  value: ChatTarget;
  onChange: (target: ChatTarget) => void;
  onConnect?: () => void;
  onAddProject: (pc: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const pc = pcs.find((item) => item.id === value.pc) ?? pcs[0];
  const list = projects[pc.id] ?? [];
  const project = list.find((item) => item.id === value.project);
  const projectName =
    project?.name ??
    (pc.local ? t.chatTargetNoProject : t.chatTargetChooseProject);
  const pcIcon = (item: ChatPC) =>
    item.local ? (
      <Laptop size={13} aria-hidden="true" />
    ) : (
      <Monitor size={13} aria-hidden="true" />
    );
  return (
    <fieldset
      className="message-queue chat-target"
      aria-label={t.chatTargetLabel}
      inert={busy}
    >
      <TargetPicker
        label={`PC: ${pc.name}`}
        description={pc.online ? t.Connected : t.chatTargetOffline}
        trigger={
          <>
            <span className="chat-target-pc">
              {pcIcon(pc)}
              <IndicatorDot
                state={pc.online ? "connected" : "offline"}
                className="chat-target-status"
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
              })),
          },
          {
            title: t.chatTargetRemotePcs,
            options: pcs
              .filter((item) => !item.local)
              .map((item) => ({
                ...item,
                icon: pcIcon(item),
                detail: item.online ? t.Connected : t.chatTargetOffline,
                disabled: !item.online,
              })),
          },
        ]}
        onSelect={(id) => {
          if (id !== pc.id)
            onChange({ pc: id, project: projects[id]?.[0]?.id });
        }}
        action={onConnect && { label: t.chatTargetConnect, onClick: onConnect }}
      />
      <span className="chat-target-sep" aria-hidden="true" />
      <TargetPicker
        label={`Project: ${projectName}`}
        trigger={
          <span key={`${pc.id}:${value.project}`} className="chat-target-swap">
            {project ? (
              <Folder size={13} aria-hidden="true" />
            ) : (
              <MessageSquare size={13} aria-hidden="true" />
            )}
            <span className="chat-target-label">{projectName}</span>
          </span>
        }
        value={value.project ?? ""}
        groups={[
          ...(pc.local
            ? [
                {
                  options: [
                    {
                      id: "",
                      name: t.chatTargetNoProject,
                      icon: <MessageSquare size={13} aria-hidden="true" />,
                    },
                  ],
                },
              ]
            : []),
          {
            title: t.chatTargetProjects(pc.name),
            options: list.map((item) => ({
              ...item,
              icon: <Folder size={13} aria-hidden="true" />,
            })),
          },
        ]}
        onSelect={(id) => onChange({ pc: pc.id, project: id || undefined })}
        action={
          pc.online
            ? {
                label: t.chatTargetAddProject(pc.name),
                onClick: () => onAddProject(pc.id),
              }
            : undefined
        }
      />
    </fieldset>
  );
}
