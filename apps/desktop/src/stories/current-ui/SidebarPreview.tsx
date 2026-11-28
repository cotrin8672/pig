import { ChartColumn, Puzzle, Settings, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import appIcon from "../../../assets/icon.svg";
import { useT } from "../../mainview/i18n";
import { MainViewport } from "../../mainview/MainViewport";
import { NotificationCenter } from "../../mainview/NotificationCenter";
import { Notifications } from "../../mainview/Notifications";
import { navigate } from "../../mainview/navigation";
import { ProviderUsage } from "../../mainview/ProviderUsage";
import { SidebarSessions } from "../../mainview/SidebarSessions";
import { useStore } from "../../mainview/store";

/** App's sidebar is inline today: compose its real children without moving production code. */
export default function SidebarPreview({
  extraIcon,
  afterStatistics,
  sessionsAfter,
  main,
}: {
  extraIcon?: ReactNode;
  afterStatistics?: ReactNode;
  sessionsAfter?: ReactNode;
  main?: ReactNode;
} = {}) {
  const t = useT();
  const page = useStore((state) => state.page);
  const connected = useStore((state) => state.bootstrap.models.length > 0);
  return (
    <div className="app-shell current-ui-screen">
      <aside id="app-sidebar" className="sidebar">
        <header className="window-drag-region">
          <strong className="sidebar-brand">
            <img src={appIcon} alt="" width={20} height={20} />
            pig
          </strong>
        </header>
        <SidebarSessions after={sessionsAfter} />
        <ProviderUsage />
        <div className="sidebar-footer">
          <button
            type="button"
            className={`sidebar-icon ${page === "settings" ? "active" : ""}`}
            aria-label={t.Settings}
            title={t.Settings}
            onClick={() => navigate(page === "settings" ? "chat" : "settings")}
          >
            <Settings size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sidebar-icon ${page === "providers" ? "active" : ""}`}
            aria-label={`${t.Providers}: ${connected ? t.Connected : t["Not connected"]}`}
            title={`${t.Providers}: ${connected ? t.Connected : t["Not connected"]}`}
            onClick={() =>
              navigate(page === "providers" ? "chat" : "providers")
            }
          >
            <Settings2 size={16} aria-hidden="true" />
            <span
              className={`sidebar-provider-dot ${connected ? "connected" : ""}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className={`sidebar-icon ${page === "extensions" ? "active" : ""}`}
            aria-label={t.Extensions}
            title={t.Extensions}
            onClick={() =>
              navigate(page === "extensions" ? "chat" : "extensions")
            }
          >
            <Puzzle size={16} aria-hidden="true" />
          </button>
          {extraIcon ?? (
            <button
              type="button"
              className={`sidebar-icon ${page === "statistics" ? "active" : ""}`}
              aria-label={t.Statistics}
              title={t.Statistics}
              onClick={() =>
                navigate(page === "statistics" ? "chat" : "statistics")
              }
            >
              <ChartColumn size={16} aria-hidden="true" />
            </button>
          )}
          {afterStatistics}
          <NotificationCenter />
        </div>
      </aside>
      {main && <MainViewport>{main}</MainViewport>}
      <Notifications />
    </div>
  );
}
