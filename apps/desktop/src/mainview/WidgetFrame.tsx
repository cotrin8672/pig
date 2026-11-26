import {
  memo,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WIDGET_MAX_BYTES, type WidgetBlock } from "../shared/widget";
import {
  InteractiveWidgetFrame,
  type McpWidgetData,
} from "./InteractiveWidgetFrame";
import { useT } from "./i18n";
import {
  measureFrame,
  SIZE_MESSAGE,
  tauriWidgets,
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
  mcp,
}: {
  block: WidgetBlock;
  streaming?: boolean;
  /** Lazy source, acquired only while this frame owns a visible slot. */
  load?: (
    interactive: boolean,
  ) => Promise<{ html: string; interactive?: true } | undefined>;
  mcp?: McpWidgetData;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const mounted = useLiveSlot(box);
  const [failedShell, setFailedShell] = useState(false);
  const interactive = tauriWidgets() && !failedShell;
  const scripts = useWidgetScripts(
    !interactive && block.origin !== "mcp" && !load,
  );
  const throttled = useThrottled(block, streaming);
  const [loaded, setLoaded] = useState<{
    id: string;
    loader: typeof load;
    source?: string;
    interactive?: true;
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
        return load(interactive);
      })
      .then(
        (result) => {
          if (!controller.signal.aborted)
            setLoaded({
              id: block.id,
              loader: load,
              source: result?.html,
              interactive: result?.interactive,
              failed: result === undefined,
            });
        },
        () => {
          if (!controller.signal.aborted)
            setLoaded({ id: block.id, loader: load, failed: true });
        },
      );
    return () => controller.abort();
  }, [mounted, load, block.id, attempt, interactive]);
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
  const isolated =
    interactive &&
    (load ? loaded?.interactive === true : shown.interactive && !streaming);
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
      mounted && available && !tooLarge && (isolated || !loaded?.interactive)
        ? widgetDocument(shown, {
            scripts: isolated || scripts,
            ...(isolated && { isolated: true }),
            theme: widgetTheme(getComputedStyle(document.documentElement)),
          })
        : "",
    [
      mounted,
      available,
      tooLarge,
      shown,
      scripts,
      isolated,
      loaded?.interactive,
    ],
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

  let content: ReactNode;
  if (tooLarge)
    content = <p className="widget-frame-note">{t.widgetTooLarge}</p>;
  else if (mounted) {
    if (isolated && srcDoc)
      content = (
        <InteractiveWidgetFrame
          key={shown.id}
          html={srcDoc}
          label={shown.title ?? t.Visualize}
          onHeight={remember}
          onUnavailable={() => setFailedShell(true)}
          mcp={mcp}
        />
      );
    else if (available && !loaded?.interactive)
      content = (
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
      );
    else
      content = (
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
      );
  }
  return (
    <div
      ref={box}
      className={`widget-frame${shown.width === "wide" ? " wide" : ""}${preview ? " preview" : ""}`}
      style={tooLarge || preview ? undefined : { height }}
      data-widget-id={shown.id}
    >
      {content}
      {preview &&
        failedShell &&
        mounted &&
        available &&
        !tooLarge &&
        !isolated && <span className="sr-only">{t.mcpAppStatic}</span>}
    </div>
  );
});
