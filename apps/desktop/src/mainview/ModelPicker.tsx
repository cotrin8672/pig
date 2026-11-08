import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { ProviderIcon } from "./ProviderIcon";
import { rpc } from "./rpc";
import { showError, useStore } from "./store";

export function ModelPicker({ snapshot }: { snapshot: Snapshot }) {
  const models = useStore((s) => s.bootstrap.models);
  const [busy, setBusy] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape" || !details.current?.open) return;
        details.current.querySelector("summary")?.focus();
      } else if (details.current?.contains(event.target as Node)) return;
      if (details.current) details.current.open = false;
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const disabled = snapshot.transcript.running || busy;
  return (
    <details className="model-picker" ref={details}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary is keyboard-interactive; prevent opening only while the model is locked. */}
      <summary
        aria-label="Choose model"
        aria-disabled={disabled}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        {snapshot.model && (
          <ProviderIcon provider={snapshot.model.provider} size={20} />
        )}
        <span>{snapshot.model?.name || "Select a model"}</span>
        {busy ? (
          <LoaderCircle size={14} className="spinner" />
        ) : (
          <ChevronDown size={14} />
        )}
      </summary>
      <div className="model-options">
        {!models.length && (
          <p className="muted">Connect a provider to choose a model.</p>
        )}
        {models.map((model) => {
          const selected =
            model.provider === snapshot.model?.provider &&
            model.id === snapshot.model.id;
          return (
            <button
              type="button"
              key={`${model.provider}/${model.id}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                if (details.current) {
                  details.current.open = false;
                  details.current.querySelector("summary")?.focus();
                }
                setBusy(true);
                void rpc.request
                  .setModel({
                    sessionId: snapshot.info.id,
                    provider: model.provider,
                    id: model.id,
                  })
                  .then((next) =>
                    useStore.setState((s) => ({
                      snapshots: {
                        ...s.snapshots,
                        [snapshot.info.id]: {
                          ...s.snapshots[snapshot.info.id],
                          model: next,
                        },
                      },
                    })),
                  )
                  .catch(showError)
                  .finally(() => setBusy(false));
              }}
            >
              <ProviderIcon provider={model.provider} size={20} />
              <span>{model.name}</span>
              {selected && <Check size={14} />}
            </button>
          );
        })}
      </div>
    </details>
  );
}
