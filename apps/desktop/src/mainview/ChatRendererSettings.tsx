import { useState, useSyncExternalStore } from "react";
import { reloadChatRenderers } from "./chat-renderer-client";
import { rendererSnapshot, subscribeRenderers } from "./chat-renderer-registry";
import { useT } from "./i18n";
import { rpc } from "./rpc";

export function ChatRendererSettings() {
  const t = useT();
  const state = useSyncExternalStore(subscribeRenderers, rendererSnapshot);
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-card" aria-label={t["Chat renderers"]}>
      <div className="settings-row" data-setting="chat-renderers">
        <div className="settings-label">
          <strong>{t["Chat renderers"]}</strong>
          <p className="muted">
            {
              t[
                "Load trusted local TSX components. Changes only affect chat display."
              ]
            }
          </p>
          <code>{state.file || "~/.config/pig/chat-renderers.tsx"}</code>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await reloadChatRenderers(() =>
                rpc.request.getChatRendererBundle(),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {t["Reload chat renderers"]}
        </button>
      </div>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.diagnostics.length > 0 && (
        <details>
          <summary>{t["Renderer errors (built-in display retained)"]}</summary>
          <pre>{state.diagnostics.join("\n")}</pre>
        </details>
      )}
      <p className="muted">
        {
          t[
            "Arbitrary React code is not sandboxed. Only load components you trust."
          ]
        }
      </p>
    </section>
  );
}
