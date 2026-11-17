import { renderMermaidSVG } from "beautiful-mermaid";
import { serveRenderWorker } from "./render-worker-server";

// elkjs (beautiful-mermaid's layout engine) loads its inner module on the
// first layout. If it sees a worker scope (no `document`, a `self`), it takes
// over this worker's message handler and omits the in-thread FakeWorker that
// beautiful-mermaid needs. beautiful-mermaid's own guard (deleting `self`)
// cannot work here: `self` is inherited, and restoring it assigns to a
// getter-only accessor, which throws in strict mode. So present a non-worker
// scope and make `self` an ordinary own property. No other code runs here.
(globalThis as { document?: unknown }).document ??= {};
Object.defineProperty(globalThis, "self", {
  value: globalThis,
  writable: true,
  configurable: true,
});

// DOM-free layout off the UI thread. Colors stay CSS variables so theme
// changes repaint the mounted SVG without re-rendering it.
// `click` interactions are not supported (and must not run); beautiful-mermaid
// would otherwise draw them as a node named "click".
serveRenderWorker((source: string) =>
  renderMermaidSVG(source.replace(/^[ \t]*click[ \t].*$/gm, ""), {
    bg: "var(--ds-bg-secondary)",
    fg: "var(--ds-text-primary)",
    accent: "var(--ds-accent)",
    font: "Segoe UI",
    transparent: true,
  }).replace(/@import[^;]*;/g, ""),
);
