// biome-ignore-all lint/suspicious/noArrayIndexKey: Static fixture lines and evidence blocks retain their order and can repeat.
import type { ChatRenderData } from "@pig/chat-renderers";
import {
  Check,
  ChevronRight,
  FileCode,
  Folder,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { Markdown } from "../mainview/MessageContent";
import { resultText } from "../shared/tool-view";
import { revisionViews, searchRows } from "./design-model";

export type ProposalTool = ChatRenderData["tool"];
export type ProposalPhase = "done" | "running" | "error";
export type ProposalVariant = 0 | 1 | 2;
export const toolDesignNames: Record<string, [string, string, string]> = {
  read: ["Editor tab", "Range inspector", "Source manuscript"],
  edit: ["Before / After", "Patch review", "Revision switcher"],
  write: ["New file editor", "File delivery", "Creation patch"],
  grep: ["Search table", "File explorer", "Match cards"],
  find: ["Path index", "Folder explorer", "File tiles"],
  ls: ["Directory table", "Folder explorer", "File tiles"],
  lookup: ["Request / Response", "Call pipeline", "Protocol transcript"],
  review: ["Review dashboard", "Evidence notebook", "Review checklist"],
};
export function ProposalStatus({ phase }: { phase: ProposalPhase }) {
  const Icon =
    phase === "running" ? LoaderCircle : phase === "done" ? Check : X;
  return (
    <span className={`ux-status ux-${phase}`}>
      <Icon
        size={12}
        className={phase === "running" ? "spinner" : undefined}
        aria-hidden="true"
      />
      {phase === "running" ? "実行中" : phase === "done" ? "完了" : "失敗"}
    </span>
  );
}
function SourceLines({ text, start = 1 }: { text: string; start?: number }) {
  return (
    <div className="ux-source">
      {text.split("\n").map((line, i) => (
        <div className="ux-source-line" key={`${start + i}`}>
          <span aria-hidden="true">{start + i}</span>
          <code>{line || " "}</code>
        </div>
      ))}
    </div>
  );
}
function FileDesign({
  tool,
  variant,
}: {
  tool: ProposalTool;
  variant: ProposalVariant;
}) {
  const args = tool.call.arguments as Record<string, unknown>;
  const creating = tool.call.name === "write";
  const path = String(args.path);
  const text = creating ? String(args.content) : resultText(tool.state?.result);
  const start = Number(args.offset ?? 1);
  const count = text.split("\n").length;
  if (variant === 0)
    return (
      <div className="ux-editor">
        <div className="ux-tabs">
          <span>
            <FileCode size={14} />
            {path.split("/").at(-1)}
          </span>
          <small>{creating ? "NEW FILE" : "READ ONLY"}</small>
        </div>
        <SourceLines text={text} start={start} />
        <footer>
          <code>{path}</code>
          <span>
            {creating
              ? `${count} lines written`
              : `L${start}–${start + count - 1} · requested ${args.limit ?? "all"}`}
          </span>
        </footer>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-file-inspector">
        <aside>
          <FileCode size={32} strokeWidth={1} />
          <strong>{creating ? "作成したファイル" : "読んだ範囲"}</strong>
          <code>{path}</code>
          <div className="ux-big-number">
            {count}
            <small> lines</small>
          </div>
          <dl>
            <dt>{creating ? "Operation" : "Start"}</dt>
            <dd>{creating ? "write" : `L${start}`}</dd>
            {!creating && (
              <>
                <dt>Limit</dt>
                <dd>{String(args.limit ?? "all")}</dd>
              </>
            )}
          </dl>
        </aside>
        <SourceLines text={text} start={start} />
      </div>
    );
  if (creating)
    return (
      <div className="ux-creation">
        <div className="ux-change-banner">
          <span>＋ 新規ファイル</span>
          <code>{path}</code>
          <strong>+{count}</strong>
        </div>
        <pre>
          {text.split("\n").map((line, i) => (
            <span className="ux-added" key={`new-${i + 1}`}>
              + {line}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
    );
  return (
    <div className="ux-manuscript">
      <div>
        <span>READ</span>
        <code>{path}</code>
      </div>
      <blockquote>
        <pre>{text}</pre>
      </blockquote>
      <footer>
        <span>
          ↳ L{start}–{start + count - 1}
        </span>
        <span>取得上限 {String(args.limit ?? "all")} 行</span>
      </footer>
    </div>
  );
}
function DiffDesign({
  tool,
  variant,
}: {
  tool: ProposalTool;
  variant: ProposalVariant;
}) {
  const [revision, setRevision] = useState<"before" | "after">("after");
  const diff =
    (tool.state?.result as { details?: { diff?: string } })?.details?.diff ??
    "";
  const { lines, before, after, added, removed } = revisionViews(diff);
  const path = String((tool.call.arguments as Record<string, unknown>).path);
  if (variant === 0)
    return (
      <div className="ux-split-diff">
        <div className="ux-diff-path">
          <code>{path}</code>
          <span>
            −{removed} / +{added}
          </span>
        </div>
        <div className="ux-two-columns">
          <section>
            <h4>
              BEFORE <span>−{removed}</span>
            </h4>
            <SourceLines text={before} />
          </section>
          <section>
            <h4>
              AFTER <span>+{added}</span>
            </h4>
            <SourceLines text={after} />
          </section>
        </div>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-patch">
        <aside>
          <span className="ux-big-number">01</span>
          <small>CHANGE SET</small>
          <strong>+{added}</strong>
          <span>−{removed}</span>
        </aside>
        <div>
          <h4>{path}</h4>
          <pre>
            {lines.map((line, i) => (
              <span
                key={`patch-${i}`}
                className={
                  line.startsWith("+")
                    ? "ux-added"
                    : line.startsWith("-")
                      ? "ux-removed"
                      : ""
                }
              >
                {line}
                {"\n"}
              </span>
            ))}
          </pre>
          <p className="ux-note">差分を適用しました</p>
        </div>
      </div>
    );
  return (
    <div className="ux-revision">
      <div className="ux-revision-toolbar">
        <code>{path}</code>
        <fieldset aria-label="表示するリビジョン">
          {(["before", "after"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={revision === value}
              onClick={() => setRevision(value)}
            >
              {value === "before" ? "変更前" : "変更後"}
            </button>
          ))}
        </fieldset>
      </div>
      <SourceLines text={revision === "before" ? before : after} />
      <footer>
        <span>{revision === "before" ? "Original" : "Applied"}</span>
        <span>
          −{removed} / +{added} · 切り替えて比較
        </span>
      </footer>
    </div>
  );
}
function SearchDesign({
  tool,
  variant,
}: {
  tool: ProposalTool;
  variant: ProposalVariant;
}) {
  const args = tool.call.arguments as Record<string, unknown>;
  const rows = searchRows(tool);
  const [selected, setSelected] = useState(0);
  const active = rows[selected] ?? rows[0];
  const query = String(args.pattern ?? args.path);
  const isGrep = tool.call.name === "grep";
  const queryBar = (
    <div className="ux-query">
      <Search size={14} />
      <code>{query}</code>
      {args.pattern ? (
        <small>
          {String(args.path)}
          {args.glob ? ` · ${String(args.glob)}` : ""}
        </small>
      ) : null}
      <span>
        {rows.length} {isGrep ? "matches" : "files"}
      </span>
    </div>
  );
  if (variant === 0)
    return (
      <div className="ux-search-table">
        {queryBar}
        <div className="ux-table-scroll">
          <table>
            <thead>
              <tr>
                <th>ファイル</th>
                {isGrep ? (
                  <>
                    <th>行</th>
                    <th>一致したコード</th>
                  </>
                ) : (
                  <th>ディレクトリ</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.path}:${i}`}>
                  <td>
                    <FileCode size={13} />
                    {row.path.split("/").at(-1)}
                  </td>
                  {isGrep ? (
                    <>
                      <td>{row.line}</td>
                      <td>
                        <code>{row.text}</code>
                      </td>
                    </>
                  ) : (
                    <td>
                      <code>{row.path.split("/").slice(0, -1).join("/")}</code>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-explorer">
        {queryBar}
        <div className="ux-explorer-columns">
          <nav aria-label="検索結果">
            <div>
              <Folder size={13} />
              {String(args.path)}
            </div>
            {rows.map((row, i) => (
              <button
                type="button"
                key={`${row.path}:${i}`}
                aria-pressed={selected === i}
                onClick={() => setSelected(i)}
              >
                <FileCode size={13} />
                <span>{row.path}</span>
                {row.line && <small>L{row.line}</small>}
              </button>
            ))}
          </nav>
          <section>
            {active && (
              <>
                <h4>{active.path}</h4>
                {isGrep ? (
                  <SourceLines text={active.text} start={Number(active.line)} />
                ) : (
                  <div className="ux-file-identity">
                    <FileCode size={40} strokeWidth={1} />
                    <code>{active.path}</code>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    );
  return (
    <div className="ux-result-cards">
      {queryBar}
      <div className={isGrep ? "ux-match-stack" : "ux-file-tiles"}>
        {rows.map((row, i) => (
          <article key={`${row.path}:${i}`}>
            {!isGrep && <FileCode size={28} strokeWidth={1} />}
            <header>
              <code>{row.path}</code>
              {row.line && <span>L{row.line}</span>}
            </header>
            {isGrep && (
              <pre>
                {row.text.split(String(args.pattern)).map((part, index) => (
                  <span key={`match-${index}`}>
                    {index > 0 && <mark>{String(args.pattern)}</mark>}
                    {part}
                  </span>
                ))}
              </pre>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
function CardEvidence({ tool }: { tool: ProposalTool }) {
  return (
    <>
      {tool.card?.body?.map((block, i) => (
        <section key={`evidence-${i}`} className="ux-evidence">
          <small>{block.type}</small>
          {block.type === "facts" ? (
            <dl>
              {block.items.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : block.type === "list" ? (
            <ul>
              {block.items.map((item) => (
                <li key={item.title}>
                  {item.title} — {item.description}
                </li>
              ))}
            </ul>
          ) : block.type === "text" && block.format === "markdown" ? (
            <Markdown text={block.text} />
          ) : (
            <pre>{block.text}</pre>
          )}
        </section>
      ))}
    </>
  );
}
function ExtensionDesign({
  tool,
  variant,
}: {
  tool: ProposalTool;
  variant: ProposalVariant;
}) {
  const [tab, setTab] = useState<"request" | "result">("result");
  const args = JSON.stringify(tool.call.arguments, null, 2);
  const output = tool.card ? (
    <CardEvidence tool={tool} />
  ) : (
    <pre>{resultText(tool.state?.result)}</pre>
  );
  const card = tool.card;
  if (card && tool.card) {
    if (variant === 0)
      return (
        <div className="ux-review-dashboard">
          <aside>
            <Check size={32} />
            <h4>{tool.card.title}</h4>
            <code>{tool.card.target}</code>
            <p>{tool.card.meta}</p>
            <small>{tool.card.body?.length} evidence blocks</small>
          </aside>
          <div>{output}</div>
        </div>
      );
    if (variant === 1)
      return (
        <div className="ux-evidence-notebook">
          <div className="ux-notebook-title">
            <span>REVIEW NOTES</span>
            <strong>{tool.card.title}</strong>
            <code>
              {tool.card.target} · {tool.card.meta}
            </code>
          </div>
          <div>{output}</div>
        </div>
      );
    return (
      <div className="ux-review-checklist">
        <h4>
          {tool.card.title} · {tool.card.meta}
        </h4>
        <code>{tool.card.target}</code>
        {tool.card.body?.map((block, i) => (
          <details key={`review-${i}`} open={i === 0}>
            <summary>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {block.type}
              <ChevronRight size={12} />
            </summary>
            <CardEvidence
              tool={{ ...tool, card: { ...card, body: [block] } }}
            />
          </details>
        ))}
      </div>
    );
  }
  if (variant === 0)
    return (
      <div className="ux-protocol-split">
        <section>
          <h4>
            REQUEST <small>{tool.call.name}</small>
          </h4>
          <pre>{args}</pre>
        </section>
        <section>
          <h4>RESPONSE</h4>
          {output}
        </section>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-call-pipeline">
        <div>
          <span>01</span>
          <h4>入力</h4>
          <pre>{args}</pre>
        </div>
        <div className="ux-pipeline-arrow">
          →<code>{tool.call.name}</code>
        </div>
        <div>
          <span>02</span>
          <h4>結果</h4>
          {output}
        </div>
      </div>
    );
  return (
    <div className="ux-protocol-transcript">
      <fieldset aria-label="ツール通信の内容">
        {(["request", "result"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value === "request" ? "↑ Request" : "↓ Response"}
          </button>
        ))}
        <code>{tool.call.name}</code>
      </fieldset>
      {tab === "request" ? <pre>{args}</pre> : output}
    </div>
  );
}
export function ToolDesign({
  tool,
  variant,
  phase,
}: {
  tool: ProposalTool;
  variant: ProposalVariant;
  phase: ProposalPhase;
}) {
  return (
    <div className="ux-tool-design">
      <div className="ux-operation">
        <span>{tool.call.name}</span>
        <ProposalStatus phase={phase} />
      </div>
      {phase !== "done" ? (
        <div className={`ux-pending ux-${phase}`}>
          <code>{JSON.stringify(tool.call.arguments)}</code>
          <p>
            {phase === "running"
              ? "処理中です。まだ結果はありません。"
              : "処理に失敗しました。入力を確認してください。"}
          </p>
        </div>
      ) : tool.call.name === "read" || tool.call.name === "write" ? (
        <FileDesign tool={tool} variant={variant} />
      ) : tool.call.name === "edit" ? (
        <DiffDesign tool={tool} variant={variant} />
      ) : ["grep", "find", "ls"].includes(tool.call.name) ? (
        <SearchDesign tool={tool} variant={variant} />
      ) : (
        <ExtensionDesign tool={tool} variant={variant} />
      )}
    </div>
  );
}
