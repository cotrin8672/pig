import { Bell, CheckCheck, CircleAlert, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { sessionLink } from "../shared/session-links";
import { useT } from "./i18n";
import { usePicker } from "./Picker";
import { openChatLink } from "./rpc";
import {
  clearNotices,
  dismissNotice,
  markNoticeRead,
  showError,
  useStore,
} from "./store";
import "./notifications.css";

export function NotificationCenter() {
  const t = useT();
  const { ref, close } = usePicker();
  const titleId = useId();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const history = useStore((s) => s.noticeHistory);
  const snapshots = useStore((s) => s.snapshots);
  const language = useStore((s) => s.settings.language);
  const unread = history.filter((notice) => !notice.read).length;
  const visible = history
    .filter((notice) => !unreadOnly || !notice.read)
    .reverse();
  return (
    <details
      ref={ref}
      className="notification-center electrobun-webkit-app-region-no-drag"
    >
      <summary
        className="picker-trigger notification-bell"
        aria-label={`${t.Notifications} (${unread})`}
        title={t.Notifications}
      >
        <Bell size={16} aria-hidden="true" />
        {unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </summary>
      <section className="notification-panel" aria-labelledby={titleId}>
        <div className="notification-heading">
          <strong id={titleId}>{t.Notifications}</strong>
          <button
            type="button"
            title={t["Mark all as read"]}
            aria-label={t["Mark all as read"]}
            disabled={!unread}
            onClick={() => markNoticeRead()}
          >
            <CheckCheck size={15} />
          </button>
          <button
            type="button"
            title={t["Clear notifications"]}
            aria-label={t["Clear notifications"]}
            disabled={!history.length}
            onClick={clearNotices}
          >
            <Trash2 size={15} />
          </button>
        </div>
        <fieldset
          className="notification-filters"
          aria-label={t["Notification filter"]}
        >
          <button
            type="button"
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            {t.All}
          </button>
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            {t.Unread}
            {unread > 0 ? ` (${unread})` : ""}
          </button>
        </fieldset>
        <div className="notification-history">
          {visible.length ? (
            visible.map((notice) => (
              <button
                type="button"
                key={notice.id}
                className={`notification-entry ${notice.read ? "read" : "unread"}`}
                onClick={() => {
                  markNoticeRead(notice.id);
                  dismissNotice(notice.id);
                  if (notice.session) {
                    close();
                    void openChatLink(sessionLink(notice.session.id)).catch(
                      showError,
                    );
                  }
                }}
              >
                {notice.level === "error" || notice.level === "warning" ? (
                  <CircleAlert
                    size={15}
                    className={notice.level}
                    aria-hidden="true"
                  />
                ) : (
                  <Bell size={15} aria-hidden="true" />
                )}
                <span className="notification-entry-content">
                  <span className="notification-entry-message">
                    {notice.message}
                  </span>
                  {notice.session && (
                    <span className="notification-entry-title">
                      {snapshots[notice.session.id]?.info.title ||
                        notice.title ||
                        t["Back to chat"]}
                    </span>
                  )}
                  <time dateTime={new Date(notice.createdAt).toISOString()}>
                    {new Date(notice.createdAt).toLocaleString(language, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                {!notice.read && (
                  <span
                    className="notification-unread-dot"
                    role="img"
                    aria-label={t.Unread}
                  />
                )}
              </button>
            ))
          ) : (
            <div className="notification-empty">
              <Bell size={22} aria-hidden="true" />
              <strong>
                {unreadOnly
                  ? t["No unread notifications"]
                  : t["No notifications"]}
              </strong>
              <span>
                {t["Chat activity and app notifications appear here."]}
              </span>
            </div>
          )}
        </div>
      </section>
    </details>
  );
}
