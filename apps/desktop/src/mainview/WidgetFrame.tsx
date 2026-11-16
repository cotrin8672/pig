import {
  memo,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WIDGET_MAX_BYTES, type WidgetBlock } from "../shared/widget";
import { useT } from "./i18n";
import {
  measureFrame,
  SIZE_MESSAGE,
  widgetDocument,
  widgetIsolation,
  widgetSandbox,
  widgetScriptPolicy,
  widgetTheme,
} from "./widget-frame";

/** Frames that may exist at once; each costs a few MB, off-screen ones are dropped. */
export const MAX_LIVE_WIDGETS = 8;
const DEFAULT_HEIGHT = 240;
const STREAM_INTERVAL = 250;

/** Last measured height per block, so remounted frames reserve the same space. */
const heights = new Map<string, number>();

const live = new Set<object>();
const waiting = new Set<() => void>();
function acquire(owner: object) {
  if (live.size >= MAX_LIVE_WIDGETS && !live.has(owner)) return false;
  live.add(owner);
  return true;
}
function release(owner: object) {
  if (!live.delete(owner)) return;
  for (const wake of waiting) wake();
}

function useWidgetScripts() {
  const [scripts, setScripts] = useState(false);
  useEffect(() => {
    if (!widgetScriptPolicy.requested) return;
    let alive = true;
    void widgetIsolation().then((isolated) => alive && setScripts(isolated));
    return () => {
      alive = false;
    };
  }, []);
  return scripts;
}

/** While a tool call streams, update the frame at most every STREAM_INTERVAL ms. */
function useThrottled<T>(value: T, active: boolean) {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  latest.current = value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new value schedules a flush.
  useEffect(() => {
    if (!active || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setShown(latest.current);
    }, STREAM_INTERVAL);
  }, [value, active]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return active ? shown : value;
}

/** Mount only near the viewport and within MAX_LIVE_WIDGETS. */
function useLiveSlot(target: RefObject<HTMLElement | null>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const owner = {};
    let near = false;
    const update = () => {
      const ok = near && acquire(owner);
      if (!near) release(owner);
      setMounted(ok);
    };
    waiting.add(update);
    const observer = new IntersectionObserver(
      ([entry]) => {
        near = entry.isIntersecting;
        update();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      waiting.delete(update);
      release(owner);
    };
  }, [target]);
  return mounted;
}

export const WidgetFrame = memo(function WidgetFrame({
  block,
  streaming = false,
}: {
  block: WidgetBlock;
  streaming?: boolean;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const mounted = useLiveSlot(box);
  const scripts = useWidgetScripts();
  const shown = useThrottled(block, streaming);
  const [height, setHeight] = useState(
    () => heights.get(block.id) ?? DEFAULT_HEIGHT,
  );
  const tooLarge = shown.source.length > WIDGET_MAX_BYTES;
  const srcDoc = useMemo(
    () =>
      widgetDocument(shown, {
        scripts,
        theme: widgetTheme(getComputedStyle(document.documentElement)),
      }),
    [shown, scripts],
  );
  const remember = (value: number) => {
    if (value <= 0) return;
    heights.set(shown.id, value);
    setHeight(value);
  };

  // Scripted frames report their size; script-free ones are measured from here when visible.
  useEffect(() => {
    if (!mounted || !scripts) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === SIZE_MESSAGE &&
        typeof event.data.height === "number"
      )
        remember(Math.min(event.data.height, 20_000));
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  });

  const onLoad = () => {
    if (scripts || !frame.current) return;
    const measured = measureFrame(frame.current);
    if (measured !== undefined) remember(measured);
  };

  return (
    <div
      ref={box}
      className={`widget-frame${shown.width === "wide" ? " wide" : ""}`}
      style={tooLarge ? undefined : { height }}
      data-widget-id={shown.id}
    >
      {tooLarge ? (
        <p className="widget-frame-note">{t.widgetTooLarge}</p>
      ) : (
        mounted && (
          // biome-ignore lint/a11y/useIframeTitle: named via aria-label; native title tooltips are banned (lint:ui).
          <iframe
            // Sandbox flags apply per navigation; a new frame avoids mixing them.
            key={scripts ? "scripts" : "static"}
            ref={frame}
            aria-label={shown.title ?? t.Visualize}
            sandbox={widgetSandbox(scripts)}
            srcDoc={srcDoc}
            onLoad={onLoad}
          />
        )
      )}
    </div>
  );
});
