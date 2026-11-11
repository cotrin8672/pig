import {
  type ComponentProps,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

import { frameTask } from "./thread-scroll";

type EditorView = {
  text: string;
  start: number;
  end: number;
  scrollTop: number;
  focused: boolean;
  restoreFocus?: boolean;
};
const views = new Map<string, EditorView>();
const mounted = new Map<string, HTMLTextAreaElement>();
function editorView(input: HTMLTextAreaElement): EditorView {
  return {
    text: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
    scrollTop: input.scrollTop,
    focused: input.ownerDocument.activeElement === input,
  };
}

export function transferEditorView(from: string, to: string, prefix = "") {
  const input = mounted.get(from);
  const view = input ? editorView(input) : views.get(from);
  if (view)
    views.set(to, {
      ...view,
      text: prefix + view.text,
      start: view.start + prefix.length,
      end: view.end + prefix.length,
      restoreFocus: !!input && view.focused,
    });
  views.delete(from);
}

export function insertEditorNewline(
  input: HTMLTextAreaElement,
  change: (value: string) => void,
) {
  const { value, selectionStart: start, selectionEnd: end } = input;
  change(`${value.slice(0, start)}\n${value.slice(end)}`);
  requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
}

export function sizeEditor(input: HTMLTextAreaElement) {
  const scrollTop = input.scrollTop;
  input.style.height = "32px";
  input.style.height = `${Math.max(32, Math.min(220, input.scrollHeight))}px`;
  input.scrollTop = input.scrollHeight > input.clientHeight ? scrollTop : 0;
}

export function ComposerEditor({
  viewKey,
  inputRef,
  value,
  onChange,
  onSelect,
  onFocus,
  onBlur,
  onScroll,
  ...props
}: Omit<ComponentProps<"textarea">, "ref" | "value"> & {
  viewKey: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  function remember(input: HTMLTextAreaElement) {
    views.set(viewKey, editorView(input));
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restore only when changing draft ownership, not on each keystroke.
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    mounted.set(viewKey, input);
    sizeEditor(input);
    const view = views.get(viewKey);
    if (view?.text === input.value) {
      if (view.restoreFocus) input.focus({ preventScroll: true });
      input.setSelectionRange(view.start, view.end);
      input.scrollTop = view.scrollTop;
      view.restoreFocus = false;
    }
    const resize = frameTask(() => sizeEditor(input));
    const observer = new ResizeObserver(() => {
      if (width === input.clientWidth) return;
      width = input.clientWidth;
      resize.schedule();
    });
    let width = input.clientWidth;
    observer.observe(input);
    return () => {
      remember(input);
      if (mounted.get(viewKey) === input) mounted.delete(viewKey);
      observer.disconnect();
      resize.dispose();
    };
  }, [viewKey, ref]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The controlled value changes the DOM's scrollHeight.
  useLayoutEffect(() => {
    if (ref.current) sizeEditor(ref.current);
  }, [value, ref]);
  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => {
        remember(event.currentTarget);
        onChange?.(event);
      }}
      onSelect={(event) => {
        remember(event.currentTarget);
        onSelect?.(event);
      }}
      onFocus={(event) => {
        remember(event.currentTarget);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        remember(event.currentTarget);
        onBlur?.(event);
      }}
      onScroll={(event) => {
        remember(event.currentTarget);
        onScroll?.(event);
      }}
    />
  );
}
