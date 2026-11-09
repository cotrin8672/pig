import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { sessionLink } from "../shared/session-links";
import { useT } from "./i18n";
import { openChatLink } from "./rpc";
import { dismissNotice, markNoticeRead, showError, useStore } from "./store";

const icons = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function Notifications() {
  const t = useT();
  const notices = useStore((s) => s.notices);
  const snapshots = useStore((s) => s.snapshots);
  return (
    <section className="notifications" aria-label={t.Notifications}>
      {notices.map((notice) => {
        const Icon = icons[notice.level];
        const session = notice.session;
        return (
          <div
            key={notice.id}
            className={`toast ${notice.level}`}
            role={
              notice.level === "error" || notice.level === "warning"
                ? "alert"
                : "status"
            }
          >
            <Icon size={14} aria-hidden="true" />
            <div className="notification-content">
              <div title={notice.message}>{notice.message}</div>
              {session && (
                <button
                  type="button"
                  className="notification-session"
                  title={snapshots[session.id]?.info.title}
                  onClick={() => {
                    markNoticeRead(notice.id);
                    dismissNotice(notice.id);
                    void openChatLink(sessionLink(session.id)).catch(showError);
                  }}
                >
                  {snapshots[session.id]?.info.title || t["Back to chat"]}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label={t["Dismiss notification"]}
              onClick={() => dismissNotice(notice.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
