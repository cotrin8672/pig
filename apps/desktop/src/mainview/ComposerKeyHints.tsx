import { resolveBindings } from "../shared/keymap";
import { useT } from "./i18n";
import { useStore } from "./store";

export function ComposerKeyHints() {
  const t = useT();
  const overrides = useStore((s) => s.settings.keybindings);
  const bindings = resolveBindings(overrides);
  const labels = {
    "composer.send": t.Send,
    "composer.queue": t["Queue follow-up"],
    "composer.steer": t["Steer response"],
    "composer.newline": t["Insert newline"],
  } as const;
  return (
    <p className="composer-key-hints">
      {(Object.keys(labels) as (keyof typeof labels)[]).map(
        (action) =>
          bindings[action] && (
            <span key={action}>
              <kbd>{bindings[action]}</kbd> {labels[action]}
            </span>
          ),
      )}
    </p>
  );
}
