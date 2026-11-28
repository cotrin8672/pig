import type { FormEventHandler, ReactNode } from "react";
import "./composer-form.css";

export function ComposerForm({
  children,
  toolbar,
  submit,
  onSubmit,
}: {
  children: ReactNode;
  toolbar?: ReactNode;
  submit: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      {children}
      <div className="composer-toolbar">
        {toolbar}
        <div className="send-controls">{submit}</div>
      </div>
    </form>
  );
}
