import { useEffect, useRef } from "react";
import type { ModelSelection } from "../shared/rpc-schema";
import { showError, useStore } from "./store";

export function usePicker() {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (!ref.current?.open) return;
    ref.current.open = false;
    ref.current.querySelector("summary")?.focus();
  };
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      } else if (ref.current && !ref.current.contains(event.target as Node)) {
        ref.current.open = false;
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  return { ref, close };
}

export async function changeSelection(
  sessionId: string,
  request: () => Promise<ModelSelection>,
) {
  if (useStore.getState().modelPending) return;
  useStore.setState({ modelPending: true });
  try {
    const selection = await request();
    useStore.setState((state) => {
      const snapshot = state.snapshots[sessionId];
      return snapshot
        ? {
            snapshots: {
              ...state.snapshots,
              [sessionId]: { ...snapshot, ...selection },
            },
          }
        : {};
    });
  } catch (error) {
    showError(error);
  } finally {
    useStore.setState({ modelPending: false });
  }
}
