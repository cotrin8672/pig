import { useEffect, useRef } from "react";

export { changeSelection } from "./selections";

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
