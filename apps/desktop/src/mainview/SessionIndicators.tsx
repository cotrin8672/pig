import { AppWindow, type LucideIcon, Tag } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ExtensionStatus } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { useT } from "./i18n";
import { useStore } from "./store";
import "./session-indicators.css";

type Section = "status" | "widgets";
const icons: Record<Section, LucideIcon> = { status: Tag, widgets: AppWindow };
const count = (status: ExtensionStatus | undefined, section: Section) =>
  (section === "status" ? status?.statuses : status?.widgets)?.length ?? 0;

function PanelIcon({ section }: { section: Section }) {
  const Icon = icons[section];
  return <Icon size={13} aria-hidden="true" />;
}

/** Places the panel above the composer with matching left/right edges. */
function place(popup: HTMLElement, trigger: HTMLElement) {
  const composer = trigger.closest(".composer") ?? trigger;
  const rect = composer.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.width = `${rect.width}px`;
  popup.style.bottom = `${innerHeight - rect.top + 8}px`;
  popup.style.maxHeight = `${Math.max(120, Math.min(360, rect.top - 16))}px`;
}

/**
 * Session-wide extension state (`setStatus` / `setWidget`) as counters in the
 * composer toolbar. Contents open in one shared top-layer panel above the
 * composer, so their presence never moves the composer or the conversation.
 */
export function SessionIndicators({ address }: { address: SessionAddress }) {
  const t = useT();
  const id = useId();
  const status = useStore((s) => s.extensionStatuses[addressKey(address)]);
  const panel = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<Section, HTMLButtonElement | null>>>(
    {},
  );
  const [open, setOpen] = useState<Section | null>(null);
  const sections = (["status", "widgets"] as const).filter(
    (key) => count(status, key) > 0,
  );
  const shown = open && count(status, open) ? open : null;
  useEffect(() => {
    // The last entry of the open section disappeared.
    if (open && !shown && panel.current?.matches(":popover-open"))
      panel.current.hidePopover();
  }, [open, shown]);
  useEffect(() => {
    const popup = panel.current;
    const trigger = open && buttons.current[open];
    if (!popup || !trigger) return;
    const composer = trigger.closest(".composer");
    const update = () => place(popup, trigger);
    // Pane dividers resize the composer without a window resize.
    const observer = new ResizeObserver(update);
    if (composer) observer.observe(composer);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);
  if (!sections.length) return null;
  const labels: Record<Section, string> = {
    status: t.sessionStatuses,
    widgets: t.sessionWidgets,
  };
  return (
    <div className="session-indicators">
      {sections.map((key) => {
        const Glyph = icons[key];
        const label = t.sessionIndicator(labels[key], count(status, key));
        return (
          <button
            type="button"
            key={key}
            ref={(element) => {
              buttons.current[key] = element;
            }}
            className="session-indicator"
            popoverTarget={id}
            popoverTargetAction="show"
            aria-expanded={open === key}
            aria-controls={id}
            aria-label={label}
            title={label}
            onClick={(event) => {
              if (open === key) {
                // Cancels the native show so the same counter closes the panel.
                event.preventDefault();
                panel.current?.hidePopover();
                return;
              }
              if (panel.current) place(panel.current, event.currentTarget);
              setOpen(key);
            }}
          >
            <Glyph size={13} aria-hidden="true" />
            <span>{count(status, key)}</span>
          </button>
        );
      })}
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="session-indicator-panel"
        role="dialog"
        aria-label={labels[shown ?? sections[0]]}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long widgets.
        tabIndex={0}
        onToggle={(event) => {
          if ((event.nativeEvent as ToggleEvent).newState === "closed")
            setOpen(null);
        }}
      >
        {shown && (
          <section>
            <h3>
              <PanelIcon section={shown} />
              {labels[shown]}
              <span>{count(status, shown)}</span>
            </h3>
            {shown === "status" ? (
              <dl className="session-indicator-statuses">
                {status?.statuses.map((item) => (
                  <div key={item.key}>
                    <dt>{item.key}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              status?.widgets.map((widget) => (
                <figure key={widget.key} className="session-indicator-widget">
                  <figcaption>{widget.key}</figcaption>
                  <pre>{widget.lines.join("\n")}</pre>
                </figure>
              ))
            )}
          </section>
        )}
      </div>
    </div>
  );
}
