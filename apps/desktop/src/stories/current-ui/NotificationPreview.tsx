import { NotificationCenter } from "../../mainview/NotificationCenter";

export default function NotificationPreview() {
  return (
    <section className="current-ui-unit">
      <header>
        <h1>通知センター</h1>
        <p>本番の通知一覧です。絞り込み・既読化・消去を確認できます。</p>
        <code>mainview/NotificationCenter.tsx</code>
      </header>
      <aside className="sidebar current-ui-notification-anchor">
        <div className="sidebar-footer">
          <NotificationCenter />
        </div>
      </aside>
    </section>
  );
}
