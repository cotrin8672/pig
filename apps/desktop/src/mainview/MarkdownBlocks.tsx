import type { Element, ElementContent } from "hast";
import {
  Check,
  Copy,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ExtraProps } from "react-markdown";
import { useT } from "./i18n";
import type { AlertKind } from "./markdown-extensions";
import {
  cachedMermaid,
  officialMermaid,
  sanitizeSvg,
  workerMermaid,
} from "./mermaid-render";
import { showError } from "./store";
import "./markdown-blocks.css";

const textOf = (node: ElementContent): string =>
  node.type === "text"
    ? node.value
    : node.type === "element"
      ? node.children.map(textOf).join("")
      : "";

/** Fenced code: language label and copy button above the unchanged `pre`. */
export function MarkdownPre({
  node,
  children,
}: ComponentProps<"pre"> & ExtraProps) {
  const code = node?.children[0];
  if (code?.type !== "element" || code.tagName !== "code")
    return <pre>{children}</pre>;
  const language = (
    Array.isArray(code.properties.className) ? code.properties.className : []
  )
    .map(String)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  // Set only on closed fences (see markdown-extensions), never mid-stream.
  const mermaid =
    language === "mermaid" && "dataMermaid" in code.properties
      ? textOf(code).replace(/\n$/, "")
      : undefined;
  return (
    <CodeBlock language={language} mermaid={mermaid}>
      {children}
    </CodeBlock>
  );
}

function CodeBlock({
  language,
  mermaid,
  children,
}: {
  language?: string;
  mermaid?: string;
  children: ReactNode;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const diagram = useMermaid(mermaid, host);
  return (
    <div className="markdown-code" ref={host}>
      <div className="markdown-code-header">
        <span className="markdown-code-language">
          {language}
          {diagram && "error" in diagram && (
            <span
              className="markdown-code-note"
              aria-description={diagram.error}
            >
              {t["Diagram could not be rendered"]}
            </span>
          )}
        </span>
        <CopyButton
          text={() =>
            mermaid ?? pre.current?.textContent?.replace(/\n$/, "") ?? ""
          }
        />
      </div>
      {diagram && "svg" in diagram ? (
        <MermaidSvg svg={diagram.svg} />
      ) : (
        <pre ref={pre}>{children}</pre>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: () => string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="markdown-code-copy"
      aria-label={copied ? t.Copied : t["Copy code block"]}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setCopied(true);
        } catch (error) {
          showError(error);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

type Diagram = ReturnType<typeof cachedMermaid>;

/** Worker-rendered SVG as soon as the fence closes; diagrams needing official
 * Mermaid (UI thread) wait until they come near the viewport. */
function useMermaid(
  source: string | undefined,
  host: RefObject<HTMLElement | null>,
): Diagram {
  const [state, setState] = useState<{ source: string; diagram: Diagram }>();
  useEffect(() => {
    if (!source || cachedMermaid(source)) return;
    let live = true;
    let observer: IntersectionObserver | undefined;
    const done = (diagram: Diagram) => {
      if (live) setState({ source, diagram });
    };
    void workerMermaid(source).then((diagram) => {
      if (!live) return;
      if (diagram) return done(diagram);
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          void officialMermaid(source).then(done);
        },
        { rootMargin: "800px 0px" },
      );
      if (host.current) observer.observe(host.current);
    });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [source, host]);
  if (!source) return undefined;
  return state?.source === source ? state.diagram : cachedMermaid(source);
}

const shadowStyle =
  ":host{display:block}svg{display:block;max-width:100%;height:auto;margin:0 auto}";

/** Shadow root: the SVG's own <style>, ids and markers stay isolated per
 * diagram while theme variables still inherit for live recoloring. */
function MermaidSvg({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    // DOMParser documents are inert (no script execution); sanitize, then adopt.
    const parsed = new DOMParser().parseFromString(svg, "text/html").body;
    const style = document.createElement("style");
    style.textContent = shadowStyle;
    root.replaceChildren(
      style,
      ...[...sanitizeSvg(parsed).children].map((child) =>
        document.importNode(child, true),
      ),
    );
  }, [svg]);
  return <div ref={ref} className="markdown-mermaid" role="img" />;
}

const alertIcons: Record<AlertKind, typeof Info> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};
const alertLabels = {
  note: "Alert note",
  tip: "Alert tip",
  important: "Alert important",
  warning: "Alert warning",
  caution: "Alert caution",
} as const;

/** GitHub alerts (`> [!NOTE]` …), marked by markdown-extensions. */
export function MarkdownBlockquote({
  node,
  children,
}: ComponentProps<"blockquote"> & ExtraProps) {
  const t = useT();
  const kind = (node as Element | undefined)?.properties.dataAlert;
  if (typeof kind !== "string" || !(kind in alertIcons))
    return <blockquote>{children}</blockquote>;
  const Icon = alertIcons[kind as AlertKind];
  return (
    <blockquote className="markdown-alert" data-alert={kind}>
      <p className="markdown-alert-title">
        <Icon size={16} aria-hidden />
        {t[alertLabels[kind as AlertKind]]}
      </p>
      {children}
    </blockquote>
  );
}
