import type { ChatRenderer, ChatRendererProps } from "@pig/chat-renderers";
import {
  ArrowRight,
  FileDiff,
  FileMinus,
  FilePen,
  FilePlus,
} from "lucide-react";
import { type PatchFile, parsePatch } from "../shared/apply-patch";
import { CodeText, HighlightedDiff } from "./HighlightedCode";
import { useT } from "./i18n";
import { ToolResultContent } from "./MessageContent";
import { languageFromPath } from "./syntax-highlighting";
import { ToolRow, toolTone } from "./ToolBlock";
import "./apply-patch.css";

const kinds = {
  add: { Icon: FilePlus, tone: "add", label: "patchAdded" },
  update: { Icon: FilePen, tone: "update", label: "patchUpdated" },
  move: { Icon: ArrowRight, tone: "move", label: "patchMoved" },
  delete: { Icon: FileMinus, tone: "delete", label: "patchDeleted" },
} as const;
const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function FileCard({ file }: { file: PatchFile }) {
  const t = useT();
  const kind = kinds[file.moveTo ? "move" : file.kind];
  const path = file.moveTo ?? file.path;
  return (
    <article className={`patch-file-card ${kind.tone}`}>
      <header>
        <kind.Icon size={13} />
        <code
          aria-description={
            file.moveTo ? `${file.path} → ${file.moveTo}` : path
          }
        >
          {file.moveTo && (
            <>
              <span className="patch-file-from">{file.path}</span> →{" "}
            </>
          )}
          {path}
        </code>
        <span className="patch-file-kind">{t[kind.label]}</span>
      </header>
      {file.kind === "add" && file.hunks.length > 0 && (
        <pre className="tool-code">
          <CodeText
            text={file.hunks.join("\n")}
            language={languageFromPath(path)}
          />
        </pre>
      )}
      {file.kind === "update" && file.hunks.length > 0 && (
        <HighlightedDiff text={file.hunks.join("\n ...\n")} path={path} />
      )}
    </article>
  );
}

/** Codex apply_patch: one card per file; the patch argument streams, so files appear while it runs. */
export function ApplyPatchRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT();
  const args = data.call.arguments as { patch?: unknown } | undefined;
  const files = parsePatch(typeof args?.patch === "string" ? args.patch : "");
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const status = toolTone(data.state, data.live);
  return (
    <ToolRow
      defaultOpen
      icon={<FileDiff size={14} />}
      verb={t.Patch}
      target={
        files.length === 1
          ? (files[0].moveTo ?? files[0].path)
          : `${t.patchFiles(files.length)} · ${files.map((file) => baseName(file.moveTo ?? file.path)).join(", ")}`
      }
      meta={
        <>
          <span className="tool-add">+{added}</span>
          <span className="tool-del">−{removed}</span>
        </>
      }
      state={data.state}
      status={status}
    >
      {status === "error" && <ToolResultContent result={data.state?.result} />}
      <div className="patch-files">
        {files.map((file, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: A patch may touch the same path twice.
          <FileCard key={index} file={file} />
        ))}
      </div>
    </ToolRow>
  );
}

export const applyPatchRenderer: ChatRenderer<"tool"> = {
  id: "builtin:apply-patch",
  kind: "tool",
  match: (data) => !data.card && data.call.name === "apply_patch",
  component: ApplyPatchRenderer,
};
