import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import "./error-alert.css";

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="error-alert" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      {children}
    </div>
  );
}
