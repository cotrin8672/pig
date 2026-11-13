import {
  BookOpen,
  FileCode2,
  type LucideIcon,
  MessageSquareText,
  Settings2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { UIRequest } from "../shared/extension-ui";
import { useT } from "./i18n";

type Resource = Extract<
  UIRequest,
  { kind: "project-trust" }
>["resources"][number];

const kindIcons: Record<Resource["kind"], LucideIcon> = {
  code: FileCode2,
  settings: Settings2,
  instructions: BookOpen,
  skill: Sparkles,
  prompt: MessageSquareText,
};

/** Shows a resource relative to the project folder; other paths stay absolute. */
export function projectRelative(cwd: string, path: string) {
  const root = cwd.replace(/[\\/]+$/, "");
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(root);
  const same = windows
    ? path.slice(0, root.length).toLowerCase() === root.toLowerCase()
    : path.startsWith(root);
  return same && /^[\\/]/.test(path.slice(root.length))
    ? path.slice(root.length + 1)
    : path;
}

export function projectName(cwd: string) {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}

/** Body of the project trust dialog: who asks, what runs, and the choices. */
export function ProjectTrustPrompt({
  cwd,
  resources,
  remember,
  onRemember,
  submitting,
  error,
  onCancel,
  onSafe,
  onAccept,
}: {
  cwd: string;
  resources: Resource[];
  remember: boolean;
  onRemember: (remember: boolean) => void;
  submitting: boolean;
  error?: ReactNode;
  onCancel: () => void;
  onSafe: () => void;
  onAccept: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="trust-head">
        <span className="trust-badge" aria-hidden="true">
          <ShieldAlert size={18} />
        </span>
        <div className="trust-head-text">
          <h2>{t.trustProjectTitle(projectName(cwd))}</h2>
          <code>{cwd}</code>
        </div>
      </div>
      <p className="trust-body">{t.trustBody}</p>
      {resources.length > 0 && (
        <ul className="trust-files" aria-label={t.trustFiles(resources.length)}>
          {resources.map((resource) => {
            const Icon = kindIcons[resource.kind];
            return (
              <li
                key={`${resource.kind}:${resource.path}`}
                title={resource.path}
              >
                <Icon size={14} aria-hidden="true" />
                <code>{projectRelative(cwd, resource.path)}</code>
                <span className="trust-kind">{t.trustKind[resource.kind]}</span>
              </li>
            );
          })}
        </ul>
      )}
      {error}
      <div className="dialog-actions trust-actions">
        <label className="trust-remember">
          <input
            type="checkbox"
            role="switch"
            checked={remember}
            aria-checked={remember}
            onChange={(event) => onRemember(event.target.checked)}
          />
          <span className="model-switch" aria-hidden="true" />
          {t.trustRemember}
        </label>
        <button type="button" onClick={onCancel}>
          {t.cancel}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={submitting}
          onClick={onSafe}
        >
          {t.trustOpenSafe}
        </button>
        <button
          type="button"
          className="primary"
          disabled={submitting}
          onClick={onAccept}
        >
          {t.trustAccept}
        </button>
      </div>
    </>
  );
}
