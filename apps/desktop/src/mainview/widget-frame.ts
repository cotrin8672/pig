import type { WidgetBlock } from "../shared/widget";

/**
 * Script execution for widgets. Off until Electrobun stops starting WebView2 with
 * `--disable-web-security` (blackboardsh/electrobun#611): with it, even a
 * `sandbox="allow-scripts"` frame reaches the parent document and its RPC key.
 * Turning this on is safe either way: scripts still only run once `widgetIsolation()`
 * proves a sandboxed frame cannot reach this document.
 */
export const widgetScriptPolicy = { requested: false };

/** Script-capable origins a widget may load from (no network access otherwise). */
const CDN =
  "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";
const FONTS = "https://fonts.googleapis.com https://fonts.bunny.net";
const FONT_FILES = "https://fonts.gstatic.com https://fonts.bunny.net";

export const widgetSandbox = (scripts: boolean) =>
  scripts ? "allow-scripts" : "";

const csp = (scripts: boolean) =>
  scripts
    ? `default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline' ${CDN} ${FONTS}; img-src data: blob:; font-src data: ${FONT_FILES}; connect-src 'none'; form-action 'none'; base-uri 'none'`
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/** Theme tokens a widget can use, resolved from the app's design tokens. */
const THEME: [string, string][] = [
  ["--foreground", "--ds-text-primary"],
  ["--muted-foreground", "--ds-text-muted"],
  ["--border", "--ds-border-strong"],
  ["--accent", "--ds-accent"],
  ["--destructive", "--ds-error"],
  ["--success", "--ds-success"],
  ["--warning", "--ds-warning"],
  ["--font-sans", "--font-sans"],
  ["--font-mono", "--font-mono"],
];

export function widgetTheme(style: CSSStyleDeclaration) {
  // A frame whose color scheme differs from its embedder gets an opaque backdrop.
  const scheme = `color-scheme:${style.colorScheme || "normal"};`;
  return (
    scheme +
    THEME.map(([name, token]) => {
      const value = style.getPropertyValue(token).trim();
      return value ? `${name}:${value};` : "";
    }).join("")
  );
}

export const SIZE_MESSAGE = "piris:widget-size";

/** Reports the content height to the host; only present when scripts run. */
const runtime = (id: string) =>
  `<script>(()=>{let last=-1;const send=()=>{const h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:${JSON.stringify(SIZE_MESSAGE)},id:${JSON.stringify(id)},height:h},"*")}};new ResizeObserver(send).observe(document.documentElement);addEventListener("load",send)})()</script>`;

/** The whole frame document; the fragment itself is inserted unchanged. */
export function widgetDocument(
  block: WidgetBlock,
  options: { scripts: boolean; theme: string },
) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(options.scripts)}"><style>:root{${options.theme}}html,body{margin:0;background:transparent}body{color:var(--foreground);font:14px/1.5 var(--font-sans,system-ui)${options.scripts ? ";overflow:hidden" : ""}}svg{max-width:100%;height:auto}</style>${options.scripts ? runtime(block.id) : ""}</head><body>${block.source}</body></html>`;
}

let isolation: Promise<boolean> | undefined;

/** Whether a `sandbox="allow-scripts"` frame is cut off from this document. Checked once. */
export function widgetIsolation(): Promise<boolean> {
  isolation ??= new Promise<boolean>((resolve) => {
    const frame = document.createElement("iframe");
    frame.sandbox.value = "allow-scripts";
    frame.hidden = true;
    frame.srcdoc =
      '<script>let reached=true;try{parent.document.body}catch{reached=false}parent.postMessage({type:"piris:widget-isolation",reached},"*")</script>';
    const done = (isolated: boolean) => {
      removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(isolated);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === frame.contentWindow &&
        event.data?.type === "piris:widget-isolation"
      )
        done(event.data.reached === false);
    };
    const timer = setTimeout(() => done(false), 3000);
    addEventListener("message", onMessage);
    document.body.append(frame);
  });
  return isolation;
}

/** Content height of a script-free frame, when the host can see into it. */
export function measureFrame(frame: HTMLIFrameElement): number | undefined {
  try {
    const root = frame.contentDocument?.documentElement;
    return root ? Math.ceil(root.getBoundingClientRect().height) : undefined;
  } catch {
    return undefined;
  }
}
