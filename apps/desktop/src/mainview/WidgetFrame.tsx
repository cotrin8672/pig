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
const MAX_HEIGHTS = 256;

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

function useWidgetScripts(allowed: boolean) {
  const [scripts, setScripts] = useState(false);
  useEffect(() => {
    if (!allowed || !widgetScriptPolicy.requested) return;
    let alive = true;
    void widgetIsolation().then((isolated) => alive && setScripts(isolated));
    return () => {
      alive = false;
    };
  }, [allowed]);
  return allowed && scripts;
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
  load,
}: {
  block: WidgetBlock;
  streaming?: boolean;
  /** Lazy static source, acquired only while this frame owns a visible slot. */
  load?: () => Promise<string | undefined>;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const mounted = useLiveSlot(box);
  const scripts = useWidgetScripts(block.origin !== "mcp" && !load);
  const throttled = useThrottled(block, streaming);
  const [loaded, setLoaded] = useState<{
    id: string;
    loader: typeof load;
    source?: string;
    failed: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry bumps `attempt` to load again.
  useEffect(() => {
    if (!mounted || !load) {
      setLoaded(undefined);
      return;
    }
    const controller = new AbortController();
    setLoaded(undefined);
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return load();
      })
      .then(
        (source) => {
          if (!controller.signal.aborted)
            setLoaded({
              id: block.id,
              loader: load,
              source,
              failed: source === undefined,
            });
        },
        () => {
          if (!controller.signal.aborted)
            setLoaded({ id: block.id, loader: load, failed: true });
        },
      );
    return () => controller.abort();
  }, [mounted, load, block.id, attempt]);
  const shown = useMemo(
    () =>
      load
        ? {
            ...throttled,
            source:
              loaded?.id === block.id && loaded.loader === load
                ? (loaded.source ?? "")
                : "",
          }
        : throttled,
    [load, throttled, loaded, block.id],
  );
  const available =
    !load ||
    (loaded?.id === block.id &&
      loaded.loader === load &&
      loaded.source !== undefined);
  const failed =
    load && loaded?.id === block.id && loaded.loader === load && loaded.failed;
  const preview = block.origin === "mcp";
  const [height, setHeight] = useState(
    () => heights.get(block.id) ?? DEFAULT_HEIGHT,
  );
  const tooLarge = useMemo(
    () =>
      shown.source.length > WIDGET_MAX_BYTES ||
      new TextEncoder().encode(shown.source).length > WIDGET_MAX_BYTES,
    [shown.source],
  );
  const srcDoc = useMemo(
    () =>
      mounted && available && !tooLarge
        ? widgetDocument(shown, {
            scripts,
            theme: widgetTheme(getComputedStyle(document.documentElement)),
          })
        : "",
    [mounted, available, tooLarge, shown, scripts],
  );
  const remember = (value: number) => {
    if (value <= 0) return;
    if (preview) return;
    heights.delete(shown.id);
    heights.set(shown.id, value);
    while (heights.size > MAX_HEIGHTS) {
      const oldest = heights.keys().next().value;
      if (oldest !== undefined) heights.delete(oldest);
    }
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
    if (preview || scripts || !frame.current) return;
    const measured = measureFrame(frame.current);
    if (measured !== undefined) remember(measured);
  };

  return (
    <div
      ref={box}
      className={`widget-frame${shown.width === "wide" ? " wide" : ""}${preview ? " preview" : ""}`}
      style={tooLarge || preview ? undefined : { height }}
      data-widget-id={shown.id}
    >
      {tooLarge ? (
        <p className="widget-frame-note">{t.widgetTooLarge}</p>
      ) : (
        mounted &&
        (available ? (
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
        ) : (
          <p className="widget-frame-note">
            {failed ? t.mcpAppUnavailable : t["Loading…"]}
            {failed && (
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t.Retry}
              </button>
            )}
          </p>
        ))
      )}
    </div>
  );
});
