import {
  type ComponentProps,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import {
  ComposerInputHistory,
  type EditGroup,
  type EditorEdit,
  type EditorText,
} from "./composer-input-history";
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
const histories = new Map<string, ComposerInputHistory>();
// Recorded from scroll events: reading scrollTop while a pane unmounts forces a
// synchronous layout of the whole remaining document.
const scrollTops = new Map<string, number>();
// Retired owners still on screen are released when their editor unmounts.
const releasing = new Set<string>();
const noPastes: EditorText["pastes"] = [];
function editorView(input: HTMLTextAreaElement, key: string): EditorView {
  return {
    text: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
    scrollTop: scrollTops.get(key) ?? 0,
    focused: input.ownerDocument.activeElement === input,
  };
}

export function transferEditorView(from: string, to: string, prefix = "") {
  const input = mounted.get(from);
  const view = input ? editorView(input, from) : views.get(from);
  scrollTops.delete(from);
  if (view)
    views.set(to, {
      ...view,
      text: prefix + view.text,
      start: view.start + prefix.length,
      end: view.end + prefix.length,
      restoreFocus: !!input && view.focused,
    });
  views.delete(from);
  const history = histories.get(from);
  if (history && !prefix) histories.set(to, history);
  histories.delete(from);
}

/** A retired owner's editor can never be shown again; drop its text and Undo history. */
export function forgetEditorView(key: string) {
  if (mounted.has(key)) {
    releasing.add(key);
    return;
  }
  views.delete(key);
  histories.delete(key);
  scrollTops.delete(key);
}

/** Number of retained editor states, for lifetime tests. */
export const editorViewCount = () =>
  new Set([...views.keys(), ...histories.keys(), ...scrollTops.keys()]).size;

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
  // CSS owns the one-line minimum, including the current font size and padding.
  input.style.height = "0px";
  input.style.height = `${Math.min(220, input.scrollHeight)}px`;
  input.scrollTop = input.scrollHeight > input.clientHeight ? scrollTop : 0;
}

export function ComposerEditor({
  viewKey,
  inputRef,
  value,
  pastes = noPastes,
  onRestore,
  messageHistory,
  onChange,
  onBeforeInput,
  onPaste,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onSelect,
  onFocus,
  onBlur,
  onScroll,
  ...props
}: Omit<ComponentProps<"textarea">, "ref" | "value"> & {
  viewKey: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
  pastes?: EditorText["pastes"];
  onRestore: (edit: EditorText) => void;
  messageHistory?: () => string[];
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Editing history belongs to the draft, not a render/value.
  const history = useMemo(() => {
    let history = histories.get(viewKey);
    if (!history) {
      history = new ComposerInputHistory({
        text: value,
        pastes,
        start: value.length,
        end: value.length,
      });
      histories.set(viewKey, history);
    }
    return history;
  }, [viewKey]);
  const pendingGroup = useRef<EditGroup | undefined>(undefined);
  const restoring = useRef<EditorEdit | undefined>(undefined);
  const composing = useRef(false);
  function remember(input: HTMLTextAreaElement) {
    views.set(viewKey, editorView(input, viewKey));
  }
  function restore(edit: EditorEdit) {
    const input = ref.current;
    if (input?.value === edit.text) {
      input.setSelectionRange(edit.start, edit.end);
      restoring.current = undefined;
    } else restoring.current = edit;
    onRestore({ text: edit.text, pastes: edit.pastes });
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restore only when changing draft ownership, not on each keystroke.
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    pendingGroup.current = undefined;
    restoring.current = undefined;
    composing.current = false;
    mounted.set(viewKey, input);
    sizeEditor(input);
    const view = views.get(viewKey);
    if (view?.text === input.value) {
      if (view.restoreFocus) input.focus({ preventScroll: true });
      input.setSelectionRange(view.start, view.end);
      input.scrollTop = view.scrollTop;
      view.restoreFocus = false;
    }
    // Layout is already clean after sizeEditor, so this read is free.
    scrollTops.set(viewKey, input.scrollTop);
    const resize = frameTask(() => sizeEditor(input));
    const observer = new ResizeObserver(() => {
      if (width === input.clientWidth) return;
      width = input.clientWidth;
      resize.schedule();
    });
    let width = input.clientWidth;
    observer.observe(input);
    return () => {
      if (mounted.get(viewKey) === input) mounted.delete(viewKey);
      if (releasing.delete(viewKey)) {
        forgetEditorView(viewKey);
      } else remember(input);
      observer.disconnect();
      resize.dispose();
    };
  }, [viewKey, ref]);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    if (restoring.current) {
      input.setSelectionRange(restoring.current.start, restoring.current.end);
      restoring.current = undefined;
    }
    history.record(
      {
        text: value,
        pastes,
        start: input.selectionStart,
        end: input.selectionEnd,
      },
      pendingGroup.current,
    );
    pendingGroup.current = undefined;
    sizeEditor(input);
  }, [value, pastes, ref, history]);
  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      value={value}
      onBeforeInput={(event) => {
        history.select(
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        );
        onBeforeInput?.(event);
      }}
      onChange={(event) => {
        const input = event.nativeEvent as InputEvent;
        pendingGroup.current =
          input.isComposing ||
          composing.current ||
          input.inputType === "insertCompositionText"
            ? "composition"
            : input.inputType === "insertText"
              ? "typing"
              : "edit";
        remember(event.currentTarget);
        onChange?.(event);
      }}
      onPaste={(event) => {
        history.select(
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        );
        onPaste?.(event);
      }}
      onKeyDown={(event) => {
        if (!composing.current && !event.nativeEvent.isComposing)
          history.select(
            event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd,
          );
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          composing.current
        )
          return;
        const input = event.currentTarget;
        const key = event.key.toLowerCase();
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          (key === "z" || (key === "y" && !event.shiftKey))
        ) {
          event.preventDefault();
          const edit = history.undo(key === "y" || event.shiftKey);
          if (edit) restore(edit);
          return;
        }
        if (
          !messageHistory ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          input.selectionStart !== input.selectionEnd
        )
          return;
        const direction =
          event.key === "ArrowUp" && input.selectionStart === 0
            ? -1
            : event.key === "ArrowDown" &&
                (input.selectionEnd === input.value.length ||
                  input.selectionEnd === 0)
              ? 1
              : undefined;
        if (!direction) return;
        const edit = history.recall(direction, messageHistory);
        if (edit) {
          event.preventDefault();
          restore(edit);
        }
      }}
      onCompositionStart={(event) => {
        history.breakGroup();
        composing.current = true;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        onCompositionEnd?.(event);
      }}
      onSelect={(event) => {
        if (!composing.current)
          history.select(
            event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd,
          );
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
        scrollTops.set(viewKey, event.currentTarget.scrollTop);
        remember(event.currentTarget);
        onScroll?.(event);
      }}
    />
  );
}
