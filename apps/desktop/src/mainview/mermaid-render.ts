type Result = { svg: string } | { error: string };

// Rendered SVG per source. Sources are immutable once their fence closes, so
// remounts, history reloads and the streaming → final reparse reuse the result.
const cache = new Map<string, Promise<Result>>();
const settled = new Map<string, Result>();
const LIMIT = 48;
const BUDGET = 8 * 1024 * 1024;
function remember(source: string, result: Result) {
  settled.delete(source);
  settled.set(source, result);
  let weight = 0;
  for (const [key, value] of settled)
    weight += key.length + ("svg" in value ? value.svg.length : 0);
  for (const [key, value] of settled) {
    if (settled.size <= LIMIT && weight <= BUDGET) break;
    settled.delete(key);
    cache.delete(key);
    weight -= key.length + ("svg" in value ? value.svg.length : 0);
  }
}
export const cachedMermaid = (source: string) => settled.get(source);

// Official Mermaid needs the DOM, so it runs on the UI thread: load it only
// for diagrams the worker renderer cannot handle, one diagram at a time.
let official: Promise<typeof import("mermaid").default> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let ids = 0;
function themeColor(name: string) {
  const context = document.createElement("canvas").getContext("2d");
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!context || !value) return undefined;
  context.fillStyle = value;
  return context.fillStyle; // normalized #rrggbb / rgba() that Mermaid parses
}
const pastels = [
  "#a8c6eb",
  "#c5b1e5",
  "#a6d6c5",
  "#edc19e",
  "#ddaebe",
  "#e2d39c",
];
async function renderOfficial(source: string) {
  official ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  const mermaid = await official;
  const color = (name: string) => themeColor(name) ?? "#888888";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: getComputedStyle(document.body).fontFamily,
    themeVariables: {
      darkMode: true,
      background: color("--ds-bg-secondary"),
      primaryColor: color("--ds-bg-tertiary"),
      primaryTextColor: color("--ds-text-primary"),
      primaryBorderColor: color("--ds-accent-soft"),
      secondaryColor: color("--ds-bg-secondary"),
      tertiaryColor: color("--ds-bg-secondary"),
      lineColor: color("--ds-text-muted"),
      textColor: color("--ds-text-primary"),
      // Categorical pastels shared with the statistics charts.
      ...Object.fromEntries(
        pastels.map((value, index) => [`pie${index + 1}`, value]),
      ),
      pieSectionTextColor: color("--ds-bg-secondary"),
      pieTitleTextColor: color("--ds-text-primary"),
      pieLegendTextColor: color("--ds-text-primary"),
      pieStrokeColor: color("--ds-bg-secondary"),
      pieOuterStrokeColor: color("--ds-border-strong"),
      pieOpacity: "1",
    },
  });
  const id = `pig-mermaid-${++ids}`;
  try {
    return (await mermaid.render(id, source)).svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

const workerTried = new Map<string, Promise<string | undefined>>();

/** beautiful-mermaid in a worker: flowchart, sequence, class, state, ER and
 * xychart. `undefined` means the official renderer is needed. */
export function workerMermaid(source: string): Promise<Result | undefined> {
  const hit = settled.get(source);
  if (hit) return Promise.resolve(hit);
  let pending = workerTried.get(source);
  if (!pending) {
    // Unsupported diagram type / syntax, or no worker: official Mermaid.
    pending = import("./mermaid-worker-client")
      .then(({ mermaidWorker }) => mermaidWorker.run(source))
      .catch(() => undefined)
      .finally(() => workerTried.delete(source));
    workerTried.set(source, pending);
  }
  return pending.then((svg) => {
    if (!svg) return undefined;
    remember(source, { svg });
    return { svg };
  });
}

/** Official Mermaid on the UI thread, one diagram at a time. Call it only for
 * visible diagrams the worker could not render. */
export function officialMermaid(source: string): Promise<Result> {
  const hit = settled.get(source);
  if (hit) return Promise.resolve(hit);
  let pending = cache.get(source);
  if (!pending) {
    const run = queue.then(() => renderOfficial(source));
    queue = run.catch(() => {});
    pending = run.then(
      (svg): Result => ({ svg }),
      (error): Result => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    pending.then((result) => remember(source, result));
    cache.set(source, pending);
  }
  return pending;
}

/** Inert, self-contained SVG: scripts, handlers and external links removed.
 * Inside a shadow root its <style> and ids cannot leak into the app. */
export function sanitizeSvg<T extends ParentNode>(fragment: T): T {
  for (const node of fragment.querySelectorAll(
    "script,iframe,object,embed,link,meta",
  ))
    node.remove();
  for (const element of fragment.querySelectorAll("*"))
    for (const { name, value } of [...element.attributes])
      if (
        /^on/i.test(name) ||
        (/(^|:)href$/i.test(name) && !value.trim().startsWith("#"))
      )
        element.removeAttribute(name);
  for (const style of fragment.querySelectorAll("style"))
    style.textContent = (style.textContent ?? "").replace(
      /@import[^;]*;?/g,
      "",
    );
  return fragment;
}
