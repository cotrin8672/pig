import { ChevronDown, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { defaultThemeColor, normalizeThemeColor } from "../shared/theme-color";
import { colorAtPoint, type Hsv, hexToHsv, hsvToHex } from "./color-space";
import { useT } from "./i18n";
import "./color-picker.css";

export const colorPresets = [
  defaultThemeColor,
  "#b39be8",
  "#dc91b6",
  "#e89c89",
  "#d9ba76",
  "#93b99b",
  "#7dbfbd",
  "#a8a8a8",
];

export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const emitted = useRef(value);
  const frame = useRef<number | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  const change = useRef(onChange);
  change.current = onChange;

  useLayoutEffect(() => {
    setDraft(value);
    if (value !== emitted.current) {
      emitted.current = value;
      setHsv((previous) => hexToHsv(value, previous.h));
    }
  }, [value]);
  // At most one preview/store update per painted frame while dragging.
  function emit(color: string) {
    emitted.current = color;
    pending.current = color;
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      if (pending.current) change.current(pending.current);
      pending.current = undefined;
    });
  }
  function flush() {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (pending.current) change.current(pending.current);
    pending.current = undefined;
  }
  useLayoutEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      // A navigation/close between pointer frames must not lose the final choice.
      if (pending.current) change.current(pending.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) return;
    function position() {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !element) return;
      const margin = 12;
      const width = element.getBoundingClientRect().width;
      const height = element.getBoundingClientRect().height;
      const below = anchor.bottom + 8;
      element.style.left = `${Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin))}px`;
      element.style.top = `${Math.max(margin, Math.min(below + height <= window.innerHeight - margin ? below : anchor.top - height - 8, window.innerHeight - height - margin))}px`;
    }
    position();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [open]);

  function update(next: Hsv) {
    setHsv(next);
    const color = hsvToHex(next);
    setDraft(color);
    emit(color);
  }
  function select(color: string) {
    setHsv((previous) => hexToHsv(color, previous.h));
    setDraft(color);
    emit(color);
    flush();
  }
  function commitHex() {
    const normalized = normalizeThemeColor(draft);
    if (normalized) select(normalized);
    else setDraft(value);
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    update({
      ...hsv,
      ...colorAtPoint(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        bounds.width,
        bounds.height,
      ),
    });
  }
  const paint = {
    "--picker-color": value,
    "--picker-hue": `hsl(${hsv.h} 100% 50%)`,
    "--picker-x": `${hsv.s}%`,
    "--picker-y": `${100 - hsv.v}%`,
  } as CSSProperties;
  return (
    <div className="color-picker" style={paint}>
      <button
        ref={trigger}
        type="button"
        className="color-picker-trigger"
        aria-label={`${label}: ${value.toUpperCase()}`}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        popoverTarget={id}
      >
        <i className="color-picker-swatch" aria-hidden="true" />
        <span>{value.toUpperCase()}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="color-picker-panel"
        onToggle={() => {
          const visible = !!panel.current?.matches(":popover-open");
          setOpen(visible);
          if (!visible) {
            flush();
            if (
              document.activeElement === document.body ||
              panel.current?.contains(document.activeElement)
            )
              trigger.current?.focus();
          }
        }}
      >
        {open && (
          <>
            <div className="color-picker-heading">
              <span>{label}</span>
              <button
                type="button"
                className="color-picker-reset"
                aria-label={t["Reset to default"]}
                title={t["Reset to default"]}
                onClick={() => select(defaultThemeColor)}
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            </div>
            {/* Pointer enhancement; both dimensions also have native keyboard-accessible sliders. */}
            <div
              className="color-picker-plane"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget
                  .querySelector("input")
                  ?.focus({ preventScroll: true });
                point(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  point(event);
              }}
              onPointerUp={flush}
              onPointerCancel={flush}
            >
              <input
                className="color-picker-plane-input"
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label={t.colorSaturation}
                value={hsv.s}
                onChange={(event) =>
                  update({ ...hsv, s: Number(event.target.value) })
                }
              />
              <input
                className="color-picker-plane-input"
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label={t.colorBrightness}
                value={hsv.v}
                onChange={(event) =>
                  update({ ...hsv, v: Number(event.target.value) })
                }
              />
              <i className="color-picker-cursor" aria-hidden="true" />
            </div>
            <input
              className="color-picker-hue"
              type="range"
              min="0"
              max="360"
              step="1"
              aria-label={t.colorHue}
              value={hsv.h}
              onChange={(event) =>
                update({ ...hsv, h: Number(event.target.value) })
              }
            />
            <fieldset
              className="color-picker-presets"
              aria-label={t.colorPresets}
            >
              {colorPresets.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="color-picker-preset"
                  aria-label={color.toUpperCase()}
                  aria-pressed={value === color}
                  style={{ "--swatch": color } as CSSProperties}
                  onClick={() => select(color)}
                />
              ))}
            </fieldset>
            <div className="color-picker-hex">
              <label htmlFor={`${id}-hex`}>HEX</label>
              <input
                id={`${id}-hex`}
                type="text"
                value={draft}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                aria-label={t.colorHex}
                aria-invalid={!normalizeThemeColor(draft)}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft(text);
                  if (/^#?[\da-f]{6}$/i.test(text)) {
                    const normalized = normalizeThemeColor(text);
                    if (normalized) {
                      setHsv((previous) => hexToHsv(normalized, previous.h));
                      emit(normalized);
                    }
                  }
                }}
                onBlur={commitHex}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    commitHex();
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
