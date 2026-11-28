import type { WidgetBlock } from "../shared/widget";

/** Browser fixtures can request script execution only after the isolation probe passes. */
export const widgetScriptPolicy = { requested: false };

// Only the Tauri Windows app serves the separate widget origin.
export const tauriWidgets = () =>
  location.origin === "http://tauri.localhost" ||
  location.origin === "https://tauri.localhost";

/** Script-capable origins a widget may load from (no network access otherwise). */
const CDN =
  "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";
const FONTS = "https://fonts.googleapis.com https://fonts.bunny.net";
const FONT_FILES = "https://fonts.gstatic.com https://fonts.bunny.net";

export const widgetSandbox = (scripts: boolean) =>
  scripts ? "allow-scripts" : "";

const csp = (scripts: boolean, preview: boolean) =>
  preview
    ? "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
    : scripts
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
  ["--ds-scrollbar-thumb", "--ds-scrollbar-thumb"],
  ["--ds-scrollbar-thumb-hover", "--ds-scrollbar-thumb-hover"],
  ["--radius-full", "--radius-full"],
];

export function widgetTheme(style: CSSStyleDeclaration) {
  // A frame whose color scheme differs from its embedder gets an opaque backdrop.
  const scheme = `color-scheme:${style.colorScheme || "normal"};font-size:${style.fontSize || "14px"};line-height:${style.lineHeight || "1.5"};`;
  return (
    scheme +
    THEME.map(([name, token]) => {
      const value = style.getPropertyValue(token).trim();
      return value ? `${name}:${value};` : "";
    }).join("")
  );
}

let scrollbarCss = "";
/** The app's shared scrollbar rules, so scrolling inside a frame looks the same. */
function sharedScrollbarCss() {
  if (scrollbarCss || typeof document === "undefined") return scrollbarCss;
  const rules: string[] = [];
  const visit = (list: CSSRuleList) => {
    for (const rule of list)
      if (rule instanceof CSSImportRule && rule.styleSheet)
        visit(rule.styleSheet.cssRules);
      else if (rule instanceof CSSGroupingRule) visit(rule.cssRules);
      else if (
        rule instanceof CSSStyleRule &&
        /::-webkit-scrollbar|--scrollbar-/.test(rule.cssText)
      )
        rules.push(rule.cssText);
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Cross-origin sheets are unreadable; the app's own CSS is not.
    }
  }
  scrollbarCss = rules.join("");
  return scrollbarCss;
}

export const SIZE_MESSAGE = "piris:widget-size";

/** Reports the content height to the host; only present when scripts run. */
const runtime = (id: string) =>
  `<script>(()=>{let last=-1;const send=()=>{const h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:${JSON.stringify(SIZE_MESSAGE)},id:${JSON.stringify(id)},height:h},"*")}};new ResizeObserver(send).observe(document.documentElement);addEventListener("load",send)})()</script>`;

/** The whole frame document; the fragment itself is inserted unchanged. */
export function widgetDocument(
  block: WidgetBlock,
  options: { scripts: boolean; theme: string; isolated?: true },
) {
  const preview = block.origin === "mcp";
  const scripts = options.scripts && !preview;
  // The dedicated document already has a stricter response CSP and sandbox.
  const policy = options.isolated
    ? ""
    : `<meta http-equiv="Content-Security-Policy" content="${csp(scripts, preview)}">`;
  return `<!doctype html><html><head><meta charset="utf-8">${policy}<style>:root{font:14px/1.5 system-ui;${options.theme}}html,body{margin:0;background:transparent}body{color:var(--foreground);font-family:var(--font-sans,system-ui)${scripts ? ";overflow:hidden" : ""}}svg{max-width:100%;height:auto}${preview ? sharedScrollbarCss() : ""}</style>${scripts ? runtime(block.id) : ""}</head><body>${block.source}</body></html>`;
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
