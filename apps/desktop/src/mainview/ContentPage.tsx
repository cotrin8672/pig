import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import "./content-page.css";

export function ContentPage({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={`content-page ${className}`}>
      <div className="content-page-shell">
        <header className="content-page-header">
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("chat")}
          >
            <ArrowLeft size={14} aria-hidden="true" /> {t["Back to chat"]}
          </button>
          <h1>{title}</h1>
          {description && (
            <p className="muted page-description">{description}</p>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
