// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed rows keep their order and may repeat.
import {
  Aperture,
  ArrowRight,
  Brackets,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CircleX,
  CornerDownRight,
  Crosshair,
  FileCog,
  FileText,
  Flame,
  Folder,
  Ghost,
  Info,
  Lightbulb,
  LogIn,
  type LucideIcon,
  Network,
  RefreshCw,
  Replace,
  TriangleAlert,
} from "lucide-react";
import { CodeText } from "../../mainview/HighlightedCode";
import { DisclosureScope } from "../../mainview/LazyDetails";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import { ToolRow } from "../../mainview/ToolBlock";
import type { Proposal, ToolProps } from "./kit";
import {
  crumb,
  type Item,
  kindName,
  type LensView,
  lensView,
  type Tone,
} from "./lens-family-model";
import { Badge, Code, KindIcon, Path, Phased } from "./lens-kit";
import { baseName } from "./lens-model";
import "./lens-family.css";

/*
 * Five ways to present the same pi-lens theme. Every variant keeps:
 * one lens mark for all 13 tools, a human verb, a "file › subject" crumb,
 * and four body types (code / list / facts / change) built from one view model.
 */

const glyphs: Record<string, LucideIcon> = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
  hint: Lightbulb,
  ref: CornerDownRight,
  origin: Crosshair,
  match: Brackets,
  change: Replace,
  file: FileText,
  next: ArrowRight,
  on: CircleCheck,
  off: CircleMinus,
  added: CirclePlus,
  config: FileCog,
  HUBS: Network,
  "ENTRY POINTS": LogIn,
  DIRECTORIES: Folder,
  cycle: RefreshCw,
  "RISK HOTSPOTS": Flame,
  "DEAD WEIGHT": Ghost,
};
export function Glyph({ item }: { item: Item }) {
  if (item.glyph in kindName) return <KindIcon kind={item.glyph} size={13} />;
  const Icon = glyphs[item.glyph] ?? FileText;
  return (
    <Icon
      size={13}
      className={`lf-glyph lf-tone-${item.tone ?? "plain"} lf-g-${item.glyph.replace(/\s/g, "-")}`}
      aria-hidden="true"
    />
  );
}

type ListStyle = "panel" | "grid" | "code";

/** The navigator's left column; a file already shown as the content keeps only its line. */
function where(item: Item) {
  if (item.file && item.text !== item.file)
    return `${baseName(item.file)}${item.loc ? `:${item.loc}` : ""}`;
  if (item.file && item.loc) return `L${item.loc}`;
  return item.loc ?? "";
}

function Change({ item, lang }: { item: Item; lang?: string }) {
  const show = (text = "") =>
    lang ? <CodeText text={text} language={languageFromPath(lang)} /> : text;
  return (
    <span className="lf-change">
      <del>{show(item.before)}</del>
      <ArrowRight size={11} aria-label="→" />
      <ins>{show(item.after)}</ins>
    </span>
  );
}

/** The item's main text: highlighted source in the code-first style, a label otherwise. */
function Primary({
  item,
  style,
  lang,
}: {
  item: Item;
  style: ListStyle;
  lang?: string;
}) {
  if (item.before !== undefined)
    return <Change item={item} lang={style === "code" ? lang : undefined} />;
  if (style === "code" && item.code && lang)
    return (
      <code className="lf-text lf-source">
        <CodeText text={item.code} language={languageFromPath(lang)} />
      </code>
    );
  if (item.file && item.text === item.file) return <Path path={item.file} />;
  return <span className="lf-text">{item.text}</span>;
}

function List({
  view,
  style,
  rail,
}: {
  view: LensView;
  style: ListStyle;
  rail: boolean;
}) {
  if (view.body.type !== "list") return null;
  const { groups, lang } = view.body;
  const frame = `lf-frame lf-list lf-${style}${rail ? " lf-rail" : ""}`;
  if (groups.every((g) => g.items.length === 0))
    return <p className={frame}>結果なし</p>;
  if (style === "grid")
    // Position first: a fixed left column says where, the rest says what.
    return (
      <div className={frame}>
        {groups.map((group, g) => [
          !group.isFile && (
            <span key={`h${g}`} className="lf-group lf-span">
              {group.title}
            </span>
          ),
          ...group.items.map((item, i) => (
            <div key={`${g}-${i}`} className="lf-row">
              <span className="lf-where">{where(item)}</span>
              <Glyph item={item} />
              <Primary item={item} style={style} lang={lang} />
              {/* Always present: display: contents rows rely on a fixed cell count. */}
              <small>{item.sub}</small>
            </div>
          )),
        ])}
      </div>
    );
  return (
    <div className={frame}>
      {groups.map((group, g) => (
        <section key={g}>
          <header className="lf-group">
            {group.isFile ? <Path path={group.title} /> : group.title}
            <small>{group.items.length}</small>
          </header>
          {group.items.map((item, i) => (
            <div key={i} className="lf-row">
              <Glyph item={item} />
              <Primary item={item} style={style} lang={lang} />
              {item.sub && style !== "code" && <small>{item.sub}</small>}
              {item.loc && <span className="lf-loc">{item.loc}</span>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function LensBody({
  view,
  style,
  rail,
}: {
  view: LensView;
  style: ListStyle;
  rail: boolean;
}) {
  const b = view.body;
  if (b.type === "code")
    return (
      <Code
        text={b.code}
        path={b.path}
        start={b.start}
        mark={b.mark}
        className={rail ? "lf-rail" : ""}
      />
    );
  if (b.type === "facts")
    return (
      <dl className={`lf-frame lf-facts${rail ? " lf-rail" : ""}`}>
        {b.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.tone ? `lf-tone-${row.tone}` : undefined}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  return <List view={view} style={style} rail={rail} />;
}

type Variant = {
  key: string;
  title: string;
  fit: string;
  /** Open by default, or trust the header. */
  open: boolean;
  /** Tint the mark and hang bodies from the extension's rail. */
  signed?: boolean;
  /** Replace the plain meta with toned verdict chips. */
  verdict?: boolean;
  list: ListStyle;
};

function LensFamily({ tool, phase, v }: ToolProps & { v: Variant }) {
  const view = lensView(tool);
  const meta = v.verdict ? (
    <span className="lf-verdict">
      {view.verdict.map((chip: { tone: Tone; text: string }) => (
        <Badge key={chip.text} tone={chip.tone}>
          {chip.text}
        </Badge>
      ))}
    </span>
  ) : (
    view.meta.join(" · ")
  );
  return (
    <DisclosureScope id={`story:${tool.call.id}:lf-${v.key}`}>
      <div className={`lf lf-v-${v.key}${v.signed ? " lf-signed" : ""}`}>
        <ToolRow
          icon={<Aperture size={14} className="lf-mark" aria-label="pi-lens" />}
          verb={view.verb}
          target={crumb(view)}
          meta={meta}
          state={tool.state}
          status={phase}
          defaultOpen={v.open}
        >
          <Phased tool={tool} phase={phase}>
            <LensBody view={view} style={v.list} rail={Boolean(v.signed)} />
          </Phased>
        </ToolRow>
      </div>
    </DisclosureScope>
  );
}

const variants: Variant[] = [
  {
    key: "quiet",
    title: "控えめ",
    fit: "組み込みツールと同じ重さで流す。拡張だとわかるのは共通のレンズマークだけで、本文は閉じたまま。頻繁に呼ばれても会話を占有しない。",
    open: false,
    list: "panel",
  },
  {
    key: "signed",
    title: "署名",
    fit: "どの拡張の仕事かを常に見せる。マークを拡張色で塗り、本文枠の左端に同じ色の線を引く。連続した呼び出しが1本の線でつながって見える。",
    open: true,
    signed: true,
    list: "panel",
  },
  {
    key: "verdict",
    title: "結論先行",
    fit: "開かなくても結果がわかる。件数の羅列ではなく、エラー数・未適用・循環の有無など判断に要る結論を状態色のチップで出す。本文は閉じる。",
    open: false,
    verdict: true,
    list: "panel",
  },
  {
    key: "navigator",
    title: "位置中心",
    fit: "次に開く場所を主役にする。全ての一覧を「file:line」の固定列＋内容の表にそろえ、診断・参照・一致を同じ目線で追える。",
    open: true,
    list: "grid",
  },
  {
    key: "code",
    title: "コード中心",
    fit: "結果をコードとして読ませる。シグネチャ・一致箇所・置換前後を構文ハイライトし、補足の文字は減らす。シンボル名で考える作業向け。",
    open: true,
    list: "code",
  },
];

export const familyProposals = Object.fromEntries(
  variants.map((v) => [
    v.key,
    {
      title: v.title,
      fit: v.fit,
      View: (props: ToolProps) => <LensFamily {...props} v={v} />,
    },
  ]),
) as Record<
  "quiet" | "signed" | "verdict" | "navigator" | "code",
  Proposal<ToolProps>
>;
