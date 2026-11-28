import { AppWindow, type LucideIcon, Tag } from "lucide-react";
import type { ExtensionStatus } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { ComposerCountButton } from "./ComposerCountButton";
import { addressKey } from "./chat-snapshot";
import { useT } from "./i18n";
import { useStore } from "./store";
import { useComposerPopover } from "./useComposerPopover";
import "./session-indicators.css";

type Section = "status" | "widgets";
const icons: Record<Section, LucideIcon> = { status: Tag, widgets: AppWindow };
const count = (status: ExtensionStatus | undefined, section: Section) =>
  (section === "status" ? status?.statuses : status?.widgets)?.length ?? 0;

/**
 * Session-wide extension state (`setStatus` / `setWidget`) as counters in the
 * composer toolbar. Contents open in one shared top-layer panel above the
 * composer, so their presence never moves the composer or the conversation.
 */
export function SessionIndicators({ address }: { address: SessionAddress }) {
  const t = useT();
  const status = useStore((s) => s.extensionStatuses[addressKey(address)]);
  const sections = (["status", "widgets"] as const).filter(
    (key) => count(status, key) > 0,
  );
  const { shown, trigger, panel } = useComposerPopover(sections, 360);
  const ActiveIcon = shown ? icons[shown] : null;
  if (!sections.length) return null;
  const labels: Record<Section, string> = {
    status: t.sessionStatuses,
    widgets: t.sessionWidgets,
  };
  return (
    <div className="session-indicators">
      {sections.map((key) => (
        <ComposerCountButton
          {...trigger(key)}
          key={key}
          icon={icons[key]}
          count={count(status, key)}
          aria-label={t.sessionIndicator(labels[key], count(status, key))}
        />
      ))}
      <div
        {...panel}
        className="session-indicator-panel"
        role="dialog"
        aria-label={labels[shown ?? sections[0]]}
      >
        {shown && (
          <section>
            <h3>
              {ActiveIcon && <ActiveIcon size={13} aria-hidden="true" />}
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
